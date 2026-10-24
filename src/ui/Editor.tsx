import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { Diagnostic, lintKeymap, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { ComposeDiagnostic, ComposeParseError, Finding, Severity } from '../core';
import { composeCompletionSource } from './composeCompletions';

export interface EditorHandle {
  jumpToLine: (line: number) => void;
}

export interface EditorMarker {
  line: number;
  severity: Severity | 'error';
  tooltip: string;
}

interface ComposeEditorProps {
  value: string;
  onChange: (nextValue: string) => void;
  errors?: ComposeParseError[];
  diagnostics?: ComposeDiagnostic[];
  findings?: Finding[];
  theme?: 'dark' | 'light';
}

const setMarkersEffect = StateEffect.define<EditorMarker[]>();
const setFlashLineEffect = StateEffect.define<number | null>();

const SEVERITY_GUTTER_COLORS: Record<Severity | 'error', string> = {
  error: 'var(--sev-critical-border)',
  critical: 'var(--sev-critical-border)',
  high: 'var(--sev-high-border)',
  medium: 'var(--sev-medium-border)',
  low: 'var(--sev-low-border)',
  info: 'var(--sev-info-border)',
};

const SEVERITY_PRIORITY: Record<Severity | 'error', number> = {
  error: 6,
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

class SeverityDotMarker extends GutterMarker {
  constructor(
    readonly severity: Severity | 'error',
    readonly tooltip: string,
  ) {
    super();
  }

  override eq(other: SeverityDotMarker): boolean {
    return this.severity === other.severity && this.tooltip === other.tooltip;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.style.display = 'inline-block';
    span.style.width = '6px';
    span.style.height = '6px';
    span.style.borderRadius = '9999px';
    span.style.backgroundColor = SEVERITY_GUTTER_COLORS[this.severity];
    span.style.marginLeft = '4px';
    span.title = this.tooltip;
    return span;
  }
}

const markersField = StateField.define<EditorMarker[]>({
  create() {
    return [];
  },
  update(markers, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMarkersEffect)) {
        return effect.value;
      }
    }
    return markers;
  },
});

const flashLineDeco = Decoration.line({
  attributes: { class: 'cm-flash-highlight-line' },
});

const errorLineDeco = Decoration.line({
  attributes: { class: 'cm-error-line' },
});

const flashLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFlashLineEffect)) {
        const lineNum = effect.value;
        if (!lineNum || lineNum < 1 || lineNum > tr.state.doc.lines) {
          return Decoration.none;
        }
        const lineInfo = tr.state.doc.line(lineNum);
        const builder = new RangeSetBuilder<Decoration>();
        builder.add(lineInfo.from, lineInfo.from, flashLineDeco);
        return builder.finish();
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const errorLineDecorations = EditorView.decorations.compute(
  [markersField],
  (state) => {
    const markers = state.field(markersField);
    const errorLines = new Set<number>();
    for (const m of markers) {
      if (m.severity === 'error' && m.line >= 1 && m.line <= state.doc.lines) {
        errorLines.add(m.line);
      }
    }
    const sorted = Array.from(errorLines).sort((a, b) => a - b);
    const builder = new RangeSetBuilder<Decoration>();
    for (const lineNum of sorted) {
      const lineInfo = state.doc.line(lineNum);
      builder.add(lineInfo.from, lineInfo.from, errorLineDeco);
    }
    return builder.finish();
  },
);

const findingsGutter = gutter({
  class: 'cm-findings-gutter',
  markers: (view) => {
    const markers = view.state.field(markersField);
    const byLine = new Map<number, EditorMarker>();

    for (const m of markers) {
      if (m.line < 1 || m.line > view.state.doc.lines) continue;
      const existing = byLine.get(m.line);
      if (!existing) {
        byLine.set(m.line, { ...m });
      } else {
        const nextSeverity =
          SEVERITY_PRIORITY[m.severity] > SEVERITY_PRIORITY[existing.severity]
            ? m.severity
            : existing.severity;
        byLine.set(m.line, {
          line: m.line,
          severity: nextSeverity,
          tooltip: `${existing.tooltip}\n${m.tooltip}`,
        });
      }
    }

    const sortedLines = Array.from(byLine.keys()).sort((a, b) => a - b);
    const builder = new RangeSetBuilder<GutterMarker>();
    for (const lineNum of sortedLines) {
      const m = byLine.get(lineNum)!;
      const lineInfo = view.state.doc.line(lineNum);
      builder.add(
        lineInfo.from,
        lineInfo.from,
        new SeverityDotMarker(m.severity, m.tooltip),
      );
    }
    return builder.finish();
  },
});

const yamlHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--syntax-key)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.bool, color: 'var(--accent)' },
  { tag: tags.null, color: 'var(--syntax-comment)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--syntax-anchor)' },
  { tag: tags.labelName, color: 'var(--syntax-anchor)' },
]);

function buildEditorTheme(isDark: boolean) {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        fontSize: '12.5px',
        fontFamily: 'var(--font-mono)',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'inherit',
        lineHeight: '1.6',
      },
      '.cm-content': {
        padding: '10px 0',
        caretColor: 'var(--accent)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-panel)',
        color: 'var(--text-muted)',
        borderRight: '1px solid var(--border-subtle)',
        userSelect: 'none',
      },
      '.cm-findings-gutter': {
        width: '14px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--bg-elevated)',
        color: 'var(--text-primary)',
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--bg-elevated)',
      },
      '.cm-error-line': {
        backgroundColor: 'var(--sev-critical-group-bg)',
      },
      '.cm-flash-highlight-line': {
        backgroundColor: 'var(--editor-line-highlight)',
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--editor-selection)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--accent)',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-strong)',
        borderRadius: '6px',
        boxShadow: 'var(--node-shadow)',
        fontFamily: 'var(--font-sans)',
        fontSize: '12px',
        maxWidth: '420px',
      },
      '.cm-tooltip-lint': { padding: '2px 0' },
      '.cm-diagnostic': { padding: '4px 8px', borderLeftWidth: '3px' },
      '.cm-diagnostic-error': { borderLeftColor: 'var(--sev-critical-border)' },
      '.cm-diagnostic-warning': { borderLeftColor: 'var(--sev-medium-border)' },
      '.cm-diagnostic-info': { borderLeftColor: 'var(--sev-low-border)' },
      '.cm-lintRange-error': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy var(--sev-critical-border)',
        textUnderlineOffset: '3px',
      },
      '.cm-lintRange-warning': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy var(--sev-medium-border)',
        textUnderlineOffset: '3px',
      },
      '.cm-lintRange-info': {
        backgroundImage: 'none',
        textDecoration: 'underline dotted var(--sev-low-border)',
        textUnderlineOffset: '3px',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--accent-bg)',
        color: 'var(--text-primary)',
      },
      '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', marginLeft: '8px' },
      '.cm-panels': {
        backgroundColor: 'var(--bg-elevated)',
        color: 'var(--text-primary)',
        borderTop: '1px solid var(--border-subtle)',
      },
      '.cm-panels input, .cm-panels button': { fontSize: '12px' },
      '.cm-textfield': {
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-strong)',
        color: 'var(--text-primary)',
        borderRadius: '4px',
      },
      '.cm-button': {
        backgroundImage: 'none',
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-strong)',
        color: 'var(--text-primary)',
        borderRadius: '4px',
      },
      '.cm-searchMatch': { backgroundColor: 'var(--sev-medium-chip-bg)' },
      '.cm-searchMatch-selected': { backgroundColor: 'var(--editor-selection)' },
      '.cm-selectionMatch': { backgroundColor: 'var(--editor-line-highlight)' },
    },
    { dark: isDark },
  );
}

function getThemeExtensions(theme: 'dark' | 'light') {
  return [
    syntaxHighlighting(yamlHighlight),
    buildEditorTheme(theme === 'dark'),
  ];
}

export const ComposeEditor = forwardRef<EditorHandle, ComposeEditorProps>(
  function ComposeEditor(
    { value, onChange, errors = [], diagnostics = [], findings = [], theme = 'dark' },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const themeCompartmentRef = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const flashTimerRef = useRef<number | null>(null);

    useImperativeHandle(ref, () => ({
      jumpToLine(line: number) {
        const view = viewRef.current;
        if (!view) return;
        const clampedLine = Math.max(1, Math.min(line, view.state.doc.lines));
        const lineInfo = view.state.doc.line(clampedLine);

        view.dispatch({
          selection: { anchor: lineInfo.from },
          effects: [
            EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
            setFlashLineEffect.of(clampedLine),
          ],
        });
        view.focus();

        if (flashTimerRef.current !== null) {
          window.clearTimeout(flashTimerRef.current);
        }
        flashTimerRef.current = window.setTimeout(() => {
          if (viewRef.current) {
            viewRef.current.dispatch({
              effects: setFlashLineEffect.of(null),
            });
          }
        }, 1800);
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const state = EditorState.create({
        doc: value,
        extensions: [
          findingsGutter,
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          bracketMatching(),
          indentOnInput(),
          yaml(),
          search({ top: true }),
          highlightSelectionMatches(),
          autocompletion({ override: [composeCompletionSource], icons: false }),
          EditorState.tabSize.of(2),
          themeCompartmentRef.current.of(getThemeExtensions(theme)),
          markersField,
          flashLineField,
          errorLineDecorations,
          keymap.of([
            ...completionKeymap,
            ...searchKeymap,
            ...lintKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });
      viewRef.current = view;

      return () => {
        if (flashTimerRef.current !== null) {
          window.clearTimeout(flashTimerRef.current);
        }
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeCompartmentRef.current.reconfigure(
          getThemeExtensions(theme),
        ),
      });
    }, [theme]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const currentDoc = view.state.doc.toString();
      if (currentDoc === value) return;
      // Replace only the changed middle part, so the cursor, scroll position
      // and undo history survive external edits such as applied fixes.
      let start = 0;
      const maxStart = Math.min(currentDoc.length, value.length);
      while (start < maxStart && currentDoc.charCodeAt(start) === value.charCodeAt(start)) {
        start++;
      }
      let endOld = currentDoc.length;
      let endNew = value.length;
      while (
        endOld > start &&
        endNew > start &&
        currentDoc.charCodeAt(endOld - 1) === value.charCodeAt(endNew - 1)
      ) {
        endOld--;
        endNew--;
      }
      view.dispatch({
        changes: { from: start, to: endOld, insert: value.slice(start, endNew) },
      });
    }, [value]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      const markers: EditorMarker[] = [
        ...errors.map((e) => ({
          line: e.line,
          severity: 'error' as const,
          tooltip: `Error (Line ${e.line}): ${e.message}`,
        })),
        ...findings.map((f) => ({
          line: f.line,
          severity: f.severity,
          tooltip: `[${f.ruleId}] ${f.title} (${f.severity}): ${f.message}`,
        })),
      ];

      const lintDiagnostics: Diagnostic[] = [];
      const doc = view.state.doc;
      const toRange = (line: number, column?: number) => {
        const lineInfo = doc.line(Math.max(1, Math.min(line, doc.lines)));
        const indent = lineInfo.text.length - lineInfo.text.trimStart().length;
        const from = column ? Math.min(lineInfo.to, lineInfo.from + column - 1) : lineInfo.from + indent;
        return { from, to: Math.max(from, lineInfo.to) };
      };
      for (const e of errors) {
        lintDiagnostics.push({ ...toRange(e.line, e.column), severity: 'error', message: e.message, source: 'YAML' });
      }
      for (const d of diagnostics) {
        lintDiagnostics.push({
          ...toRange(d.line, d.column),
          severity: d.severity,
          message: d.message.replace(/`/g, ''),
          source: `compose: ${d.code}`,
        });
      }

      markers.push(
        ...diagnostics
          .filter((d) => d.severity !== 'info')
          .map((d) => ({
            line: d.line,
            severity: d.severity === 'error' ? ('error' as const) : ('medium' as const),
            tooltip: `${d.severity === 'error' ? 'Error' : 'Warning'}: ${d.message.replace(/`/g, '')}`,
          })),
      );

      view.dispatch(setDiagnostics(view.state, lintDiagnostics));
      view.dispatch({
        effects: setMarkersEffect.of(markers),
      });
    }, [errors, diagnostics, findings]);

    return <div ref={containerRef} className="w-full h-full overflow-hidden" />;
  },
);
