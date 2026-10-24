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
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  syntaxHighlighting,
} from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { tags } from '@lezer/highlight';
import { ComposeParseError, Finding, Severity } from '../core';

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
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
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
    { value, onChange, errors = [], findings = [], theme = 'dark' },
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
          yaml(),
          themeCompartmentRef.current.of(getThemeExtensions(theme)),
          markersField,
          flashLineField,
          errorLineDecorations,
          keymap.of([...defaultKeymap, ...historyKeymap]),
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
      if (currentDoc !== value) {
        view.dispatch({
          changes: {
            from: 0,
            to: currentDoc.length,
            insert: value,
          },
        });
      }
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

      view.dispatch({
        effects: setMarkersEffect.of(markers),
      });
    }, [errors, findings]);

    return <div ref={containerRef} className="w-full h-full overflow-hidden" />;
  },
);
