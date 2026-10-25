import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_RULES,
  AnalysisResult,
  ComposeDiagnostic,
  ComposeParseError,
  DiagramNodeData,
  Finding,
  addSuppressionComment,
  analyzeCompose,
  applyFindingFix,
  buildComposeGraph,
  compressYamlToHash,
  decompressYamlFromHash,
  generateFindingsMarkdown,
} from '../core';
import { ComposeEditor, EditorHandle } from './Editor';
import { FindingsPanel } from './FindingsPanel';
import { FixAllDialog } from './FixAllDialog';
import { FixPreviewDialog } from './FixPreviewDialog';
import { ProblemsPanel } from './ProblemsPanel';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GitHubIcon,
  MoonIcon,
  SettingsGearIcon,
  SunIcon,
} from './Icons';
import { NodeDetailsPanel } from './NodeDetailsPanel';
import { ProjectOverview } from './ProjectOverview';
import { SettingsDialog } from './SettingsDialog';
import { Button, IconButton } from './primitives';
import { DEFAULT_COMPOSE_YAML } from './defaultCompose';
import { ComposeDiagram } from './diagram/ComposeDiagram';
import { COMPOSE_EXAMPLES } from './examples';
import { downloadTextFile, exportDiagramAsPng, exportDiagramAsSvg } from './exportDiagram';

type MobileTab = 'editor' | 'diagram' | 'findings';
type RightPanelTab = 'findings' | 'problems' | 'overview';
type OkAnalysis = Extract<AnalysisResult, { ok: true }>;

// Stable empty lists, so the editor does not re-render markers on every render
const EMPTY_FINDINGS: Finding[] = [];
const EMPTY_DIAGNOSTICS: ComposeDiagnostic[] = [];

const STORAGE_KEYS = {
  theme: 'composure-theme',
  draft: 'composure-draft',
  disabledRules: 'composure-disabled-rules',
} as const;

interface StoredDraft {
  yaml: string;
  fileName: string;
  exampleId: string;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked site data)
  }
}

function getInitialTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const saved = readStorage(STORAGE_KEYS.theme);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getInitialDraft(): StoredDraft {
  const fallback = {
    yaml: DEFAULT_COMPOSE_YAML,
    fileName: 'docker-compose.yml',
    exampleId: 'production-stack',
  };
  // A shared link wins over the saved draft; it is loaded asynchronously below
  if (typeof window === 'undefined' || window.location.hash.includes('compose=')) return fallback;
  try {
    const parsed = JSON.parse(readStorage(STORAGE_KEYS.draft) ?? 'null') as Partial<StoredDraft> | null;
    if (parsed && typeof parsed.yaml === 'string' && parsed.yaml.trim().length > 0) {
      return {
        yaml: parsed.yaml,
        fileName: typeof parsed.fileName === 'string' ? parsed.fileName : fallback.fileName,
        exampleId: typeof parsed.exampleId === 'string' ? parsed.exampleId : 'custom',
      };
    }
  } catch {
    // Corrupt draft: ignore
  }
  return fallback;
}

function getInitialDisabledRules(): Set<string> {
  try {
    const parsed = JSON.parse(readStorage(STORAGE_KEYS.disabledRules) ?? '[]') as unknown;
    if (Array.isArray(parsed)) {
      const known = new Set(ALL_RULES.map((r) => r.id));
      return new Set(parsed.filter((id): id is string => typeof id === 'string' && known.has(id)));
    }
  } catch {
    // ignore
  }
  return new Set();
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read')));
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsText(file);
  });
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function LogoMark({ className = '' }: { className?: string }) {
  // Two services joined by a link: a Compose file, drawn as its diagram
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="2.5" y="2.5" width="7" height="7" rx="2" fill="currentColor" />
      <rect x="10.5" y="10.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.5 6h2.5a2 2 0 0 1 2 2v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MenuItem({ onClick, children, hint }: { onClick: () => void; children: ReactNode; hint?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full px-3 h-8 flex items-center justify-between gap-4 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none"
    >
      <span>{children}</span>
      {hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}
    </button>
  );
}

function PanelTab({
  active,
  onClick,
  children,
  count,
  countTone = 'muted',
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  countTone?: 'muted' | 'error';
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative h-full inline-flex items-center gap-1.5 text-[13px] transition-colors ${
        active
          ? 'text-[var(--text-primary)] font-medium'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
      {count !== undefined && (
        <span
          className={`text-xs tabular ${
            countTone === 'error' ? 'text-[var(--sev-critical-fg)]' : 'text-[var(--text-muted)]'
          }`}
        >
          {count}
        </span>
      )}
      {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-[var(--accent)]" />}
    </button>
  );
}

export function App() {
  const [initialDraft] = useState(getInitialDraft);
  const [yamlText, setYamlText] = useState<string>(initialDraft.yaml);
  const [activeExampleId, setActiveExampleId] = useState<string>(initialDraft.exampleId);
  const [fileName, setFileName] = useState<string>(initialDraft.fileName);
  const [disabledRuleIds, setDisabledRuleIds] = useState<Set<string>>(getInitialDisabledRules);
  const [initialAnalysis] = useState(() => analyzeCompose(initialDraft.yaml, { disabledRuleIds }));
  const [analysis, setAnalysis] = useState<OkAnalysis | null>(initialAnalysis.ok ? initialAnalysis : null);
  const [parseErrors, setParseErrors] = useState<ComposeParseError[]>(
    initialAnalysis.ok ? [] : initialAnalysis.errors,
  );
  const [fixPreview, setFixPreview] = useState<{ finding: Finding; before: string; after: string } | null>(null);
  const [showFixAll, setShowFixAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightPanelTab>('findings');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('diagram');
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const editorRef = useRef<EditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    writeStorage(STORAGE_KEYS.theme, theme);
  }, [theme]);

  // Remember the muted rules and the current draft between visits
  useEffect(() => {
    writeStorage(STORAGE_KEYS.disabledRules, JSON.stringify(Array.from(disabledRuleIds)));
  }, [disabledRuleIds]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeStorage(STORAGE_KEYS.draft, JSON.stringify({ yaml: yamlText, fileName, exampleId: activeExampleId }));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [yamlText, fileName, activeExampleId]);

  const showToast = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!showExportMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [showExportMenu]);

  const dialogOpen = fixPreview !== null || showFixAll || showSettings;

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = /mac/i.test(navigator.userAgent);
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === 'Escape') {
        if (dialogOpen) return; // dialogs handle their own Escape
        if (showExportMenu) setShowExportMenu(false);
        else if (selectedNodeId) setSelectedNodeId(null);
        return;
      }
      if (dialogOpen) return;

      const key = e.key.toLowerCase();
      if (mod && key === 'o') {
        e.preventDefault();
        fileInputRef.current?.click();
      } else if (mod && key === 's') {
        e.preventDefault();
        setShowExportMenu((prev) => !prev);
      } else if (mod && key === 'b') {
        e.preventDefault();
        setLeftCollapsed((prev) => !prev);
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        setRightCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogOpen, showExportMenu, selectedNodeId]);

  // Load shared YAML from the URL hash (on start and when the hash changes)
  const sharedTextRef = useRef<string | null>(null);
  useEffect(() => {
    const loadFromHash = () => {
      const hash = window.location.hash;
      if (!hash.includes('compose=')) return;
      decompressYamlFromHash(hash).then((decoded) => {
        if (decoded) {
          sharedTextRef.current = decoded;
          setYamlText(decoded);
          setActiveExampleId('custom');
          setFileName('shared-compose.yml');
          setSelectedNodeId(null);
        } else {
          showToast('This share link is damaged or was made by a newer version.');
        }
      });
    };
    loadFromHash();
    window.addEventListener('hashchange', loadFromHash);
    return () => window.removeEventListener('hashchange', loadFromHash);
  }, [showToast]);

  // Once the shared text is edited, the link in the address bar is stale
  useEffect(() => {
    if (
      sharedTextRef.current !== null &&
      yamlText !== sharedTextRef.current &&
      window.location.hash.includes('compose=')
    ) {
      sharedTextRef.current = null;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [yamlText]);

  // Once an example is edited it is the user's own file
  useEffect(() => {
    if (activeExampleId === 'custom') return;
    const example = COMPOSE_EXAMPLES.find((e) => e.id === activeExampleId);
    if (example && example.yaml !== yamlText) setActiveExampleId('custom');
  }, [yamlText, activeExampleId]);

  // Debounced live analysis while typing
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (yamlText.trim().length === 0) {
        setParseErrors([]);
        setAnalysis(null);
        return;
      }
      const result = analyzeCompose(yamlText, { disabledRuleIds });
      if (result.ok) {
        setParseErrors([]);
        setAnalysis(result);
      } else {
        setParseErrors(result.errors);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [yamlText, disabledRuleIds]);

  const findings: Finding[] = analysis?.findings ?? EMPTY_FINDINGS;
  const diagnostics = analysis?.diagnostics ?? EMPTY_DIAGNOSTICS;
  const errorCount = parseErrors.length + diagnostics.filter((d) => d.severity === 'error').length;
  const problemCount = parseErrors.length + diagnostics.filter((d) => d.severity !== 'info').length;
  const isEmpty = yamlText.trim().length === 0;

  const graph = useMemo(() => {
    if (!analysis || isEmpty) return { nodes: [], edges: [] };
    return buildComposeGraph(analysis.model, analysis.findings);
  }, [analysis, isEmpty]);

  const selectedNodeData: DiagramNodeData | null = useMemo(() => {
    if (!selectedNodeId) return null;
    return graph.nodes.find((n) => n.id === selectedNodeId)?.data ?? null;
  }, [graph, selectedNodeId]);

  const layoutTrigger = (leftCollapsed ? 1 : 0) + (rightCollapsed ? 2 : 0);

  const handleJumpToLine = (line: number) => {
    if (window.innerWidth < 1024) setMobileTab('editor');
    else if (leftCollapsed) setLeftCollapsed(false);
    window.requestAnimationFrame(() => editorRef.current?.jumpToLine(line));
  };

  const handleSelectDiagramNode = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) {
      setRightTab('overview');
      if (rightCollapsed) setRightCollapsed(false);
      if (window.innerWidth < 1024) setMobileTab('findings');
    }
  };

  const handleToggleRule = (ruleId: string) => {
    setDisabledRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  const handleSelectFinding = (finding: Finding) => {
    setSelectedNodeId(`service:${finding.service}`);
    handleJumpToLine(finding.line);
  };

  const handleRequestFix = (finding: Finding) => {
    const after = applyFindingFix(yamlText, finding);
    if (after === null) {
      showToast('This one cannot be fixed automatically here (the value comes from a YAML anchor). Use the example instead.');
      return;
    }
    if (after === yamlText) {
      showToast('Nothing to change: the file already contains this fix.');
      return;
    }
    setFixPreview({ finding, before: yamlText, after });
  };

  const handleConfirmFix = () => {
    if (!fixPreview) return;
    if (yamlText === fixPreview.before) {
      setYamlText(fixPreview.after);
    } else {
      const fresh = applyFindingFix(yamlText, fixPreview.finding);
      if (fresh) setYamlText(fresh);
    }
    setFixPreview(null);
  };

  const handleSuppressFinding = (finding: Finding) => {
    const updated = addSuppressionComment(yamlText, finding.line, finding.ruleId, 'accepted risk');
    if (updated === yamlText) {
      showToast(`${finding.ruleId} is already accepted on this line.`);
      return;
    }
    setYamlText(updated);
    showToast(`Added "# composure-ignore ${finding.ruleId}" above line ${finding.line}. Write your reason after "--".`);
  };

  const handleSelectExample = (exampleId: string) => {
    const ex = COMPOSE_EXAMPLES.find((e) => e.id === exampleId);
    if (!ex) return;
    setActiveExampleId(ex.id);
    setFileName(`${ex.id}.yml`);
    setYamlText(ex.yaml);
    setSelectedNodeId(null);
    setRightTab('findings');
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showToast('That file is larger than 2 MB, which is unusual for a Compose file. Pick another file.');
      return;
    }
    try {
      const content = await readFile(file);
      setFileName(file.name);
      setActiveExampleId('custom');
      setYamlText(content);
      setSelectedNodeId(null);
      setRightTab('findings');
    } catch {
      showToast(`Could not read ${file.name}.`);
    }
  };

  const handleShareUrl = async () => {
    try {
      const encoded = await compressYamlToHash(yamlText);
      const newHash = `#compose=${encoded}`;
      sharedTextRef.current = yamlText;
      window.history.replaceState(null, '', newHash);
      const fullUrl = `${window.location.origin}${window.location.pathname}${newHash}`;
      await navigator.clipboard.writeText(fullUrl);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
      if (fullUrl.length > 32000) showToast('Link copied. It is very long, so some chat apps may cut it off.');
    } catch {
      showToast('Could not copy to the clipboard. The link is in the address bar.');
    }
  };

  const runExport = (action: () => void) => {
    setShowExportMenu(false);
    action();
  };

  const downloadName = /\.ya?ml$/i.test(fileName) ? fileName : 'docker-compose.yml';

  const handleExportMarkdown = () => {
    if (!analysis) return;
    const md = generateFindingsMarkdown(analysis.model, analysis.findings, {
      diagnostics: analysis.diagnostics,
      suppressed: analysis.suppressed,
      score: analysis.score,
      fileName,
    });
    downloadTextFile(md, 'composure-report.md');
  };

  const handleCopyYaml = async () => {
    try {
      await navigator.clipboard.writeText(yamlText);
      showToast('YAML copied to the clipboard.');
    } catch {
      showToast('Could not copy to the clipboard.');
    }
  };

  const emptyState = (
    <div className="max-w-sm text-center space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Check a Compose file</h2>
        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
          Paste YAML into the editor, drop a file anywhere, or start from an example. Nothing leaves your browser.
        </p>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button variant="primary" size="md" onClick={() => fileInputRef.current?.click()}>
          Open file
        </Button>
        <Button size="md" onClick={() => handleSelectExample('production-stack')}>
          Load an example
        </Button>
      </div>
    </div>
  );

  const fileStatus =
    errorCount > 0 ? (
      <span className="text-xs text-[var(--sev-critical-fg)] tabular shrink-0">
        {errorCount} error{errorCount > 1 ? 's' : ''}
      </span>
    ) : null;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDraggingFile) setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        void handleFile(e.dataTransfer.files?.[0]);
      }}
      className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)]"
    >
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-[var(--overlay)] flex items-center justify-center p-8 pointer-events-none">
          <div className="max-w-sm w-full rounded-lg border-2 border-dashed border-[var(--border-hover)] bg-[var(--bg-panel)] px-8 py-10 text-center space-y-1">
            <div className="text-[15px] font-semibold text-[var(--text-primary)]">Drop to check this file</div>
            <p className="text-xs text-[var(--text-secondary)]">It is read locally and never uploaded.</p>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".yml,.yaml,text/yaml,application/x-yaml"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Header */}
      <header className="h-12 border-b border-[var(--border-subtle)] px-3 sm:px-4 flex items-center justify-between gap-3 shrink-0 bg-[var(--bg-panel)] select-none">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 text-[var(--text-primary)]">
            <LogoMark className="w-5 h-5" />
            <span className="hidden sm:inline text-[15px] font-semibold tracking-tight">Composure</span>
          </div>
          <span className="hidden sm:block w-px h-5 bg-[var(--border-subtle)]" />
          <div className="relative hidden sm:block">
            <select
              aria-label="Preset Compose Stack"
              value={activeExampleId}
              onChange={(e) => handleSelectExample(e.target.value)}
              className="appearance-none h-7 pl-2.5 pr-7 text-[13px] rounded-md bg-transparent text-[var(--text-primary)] border border-transparent hover:bg-[var(--bg-elevated)] hover:border-[var(--border-subtle)] cursor-pointer transition-colors max-w-[220px] truncate"
            >
              {COMPOSE_EXAMPLES.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.label}
                </option>
              ))}
              {activeExampleId === 'custom' && <option value="custom">{fileName}</option>}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button onClick={() => fileInputRef.current?.click()} title="Open a Compose file (Ctrl/Cmd+O)">
            Open
          </Button>
          <Button onClick={handleShareUrl} title="Copy a link that contains the compressed file">
            {shareCopied ? 'Link copied' : 'Share'}
          </Button>
          <div ref={exportMenuRef} className="relative">
            <Button
              onClick={() => setShowExportMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showExportMenu}
              title="Export (Ctrl/Cmd+S)"
            >
              Export
              <ChevronDownIcon className="w-3 h-3 -mr-0.5" />
            </Button>
            {showExportMenu && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-56 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-[0_8px_24px_rgb(0_0_0/0.18)] py-1 z-30"
              >
                <MenuItem onClick={() => runExport(() => downloadTextFile(yamlText, downloadName, 'application/x-yaml;charset=utf-8'))} hint=".yml">
                  Download YAML
                </MenuItem>
                <MenuItem onClick={() => runExport(() => void handleCopyYaml())}>Copy YAML</MenuItem>
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <MenuItem onClick={() => runExport(handleExportMarkdown)} hint=".md">
                  Report
                </MenuItem>
                <MenuItem onClick={() => runExport(() => void exportDiagramAsSvg(graph, theme))} hint=".svg">
                  Diagram
                </MenuItem>
                <MenuItem onClick={() => runExport(() => void exportDiagramAsPng(graph, theme))} hint=".png">
                  Diagram image
                </MenuItem>
              </div>
            )}
          </div>
          <span className="hidden sm:block w-px h-5 mx-1 bg-[var(--border-subtle)]" />
          <IconButton label="Settings" onClick={() => setShowSettings(true)}>
            <SettingsGearIcon className="w-4 h-4" />
          </IconButton>
          <IconButton
            label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
          </IconButton>
          <a
            href="https://github.com/VR0EM/composure"
            target="_blank"
            rel="noreferrer"
            aria-label="Composure on GitHub"
            title="Composure on GitHub"
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <GitHubIcon className="w-4 h-4" />
          </a>
        </div>
      </header>

      {/* Mobile tab switcher */}
      <nav className="lg:hidden h-10 px-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] flex items-center shrink-0">
        <div className="flex w-full items-center rounded-md bg-[var(--bg-subtle)] p-0.5 text-xs" role="tablist">
          {(
            [
              ['editor', 'Editor'],
              ['diagram', 'Diagram'],
              ['findings', 'Findings'],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={mobileTab === tab}
              onClick={() => setMobileTab(tab)}
              className={`flex-1 h-7 rounded-[5px] transition-colors ${
                mobileTab === tab
                  ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] font-medium shadow-[0_1px_2px_rgb(0_0_0/0.12)]'
                  : 'text-[var(--text-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* Editor */}
        {leftCollapsed ? (
          <button
            type="button"
            onClick={() => setLeftCollapsed(false)}
            title="Show editor (Ctrl/Cmd+B)"
            aria-label="Show editor"
            className="hidden lg:flex w-10 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)] flex-col items-center py-3 gap-3 shrink-0 transition-colors"
          >
            <ChevronRightIcon className="w-4 h-4 text-[var(--text-secondary)]" />
            <span className="text-xs font-mono text-[var(--text-secondary)] [writing-mode:vertical-rl] rotate-180">
              {fileName}
            </span>
          </button>
        ) : (
          <section
            className={`${mobileTab === 'editor' ? 'flex w-full' : 'hidden'} lg:flex lg:w-[360px] xl:w-[400px] border-r border-[var(--border-subtle)] flex-col h-full bg-[var(--bg-panel)] shrink-0`}
          >
            <div className="h-10 pl-4 pr-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-mono text-xs text-[var(--text-primary)] truncate">{fileName}</span>
                {fileStatus}
              </div>
              <IconButton label="Hide editor (Ctrl/Cmd+B)" onClick={() => setLeftCollapsed(true)} className="hidden lg:inline-flex">
                <ChevronLeftIcon className="w-4 h-4" />
              </IconButton>
            </div>

            <div className="flex-1 min-h-0">
              <ComposeEditor
                ref={editorRef}
                value={yamlText}
                onChange={setYamlText}
                errors={parseErrors}
                diagnostics={diagnostics}
                findings={findings}
                theme={theme}
              />
            </div>

            {parseErrors.length > 0 && (
              <div role="alert" className="border-t border-[var(--border-subtle)] bg-[var(--sev-critical-group-bg)] max-h-32 overflow-y-auto shrink-0">
                {parseErrors.map((err, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleJumpToLine(err.line)}
                    className="w-full px-4 py-2 text-left flex items-start justify-between gap-3 text-xs hover:bg-[var(--sev-critical-chip-bg)]"
                  >
                    <span className="text-[var(--text-primary)]">{err.message}</span>
                    <span className="shrink-0 tabular text-[var(--sev-critical-fg)]">L{err.line}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Diagram */}
        <section
          className={`${mobileTab === 'diagram' ? 'flex w-full' : 'hidden'} lg:flex flex-1 min-w-0 h-full relative`}
        >
          <ComposeDiagram
            graph={graph}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectDiagramNode}
            isStale={parseErrors.length > 0}
            theme={theme}
            layoutTrigger={layoutTrigger}
            emptyContent={emptyState}
          />
        </section>

        {/* Side panel */}
        {rightCollapsed ? (
          <button
            type="button"
            onClick={() => setRightCollapsed(false)}
            title="Show side panel (Ctrl/Cmd+\)"
            aria-label="Show side panel"
            className="hidden lg:flex w-10 border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)] flex-col items-center py-3 gap-3 shrink-0 transition-colors"
          >
            <ChevronLeftIcon className="w-4 h-4 text-[var(--text-secondary)]" />
            <span className="text-xs text-[var(--text-secondary)] [writing-mode:vertical-rl] tabular">
              {findings.length} findings
            </span>
          </button>
        ) : (
          <section
            className={`${mobileTab === 'findings' ? 'flex w-full' : 'hidden'} lg:flex lg:w-[400px] border-l border-[var(--border-subtle)] flex-col h-full bg-[var(--bg-panel)] shrink-0`}
          >
            <div className="h-10 pl-4 pr-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 shrink-0" role="tablist">
              <div className="flex items-center gap-5 h-full min-w-0">
                <PanelTab active={rightTab === 'findings'} onClick={() => setRightTab('findings')} count={findings.length}>
                  Findings
                </PanelTab>
                <PanelTab
                  active={rightTab === 'problems'}
                  onClick={() => setRightTab('problems')}
                  count={problemCount}
                  countTone={errorCount > 0 ? 'error' : 'muted'}
                >
                  Problems
                </PanelTab>
                <PanelTab active={rightTab === 'overview'} onClick={() => setRightTab('overview')}>
                  {selectedNodeData ? 'Details' : 'Overview'}
                </PanelTab>
              </div>
              <IconButton label="Hide side panel (Ctrl/Cmd+\)" onClick={() => setRightCollapsed(true)} className="hidden lg:inline-flex">
                <ChevronRightIcon className="w-4 h-4" />
              </IconButton>
            </div>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {!analysis || isEmpty ? (
                rightTab === 'problems' && parseErrors.length > 0 ? (
                  <ProblemsPanel parseErrors={parseErrors} diagnostics={[]} onJumpToLine={handleJumpToLine} />
                ) : (
                  <div className="p-6 text-center text-[13px] text-[var(--text-secondary)]">
                    {parseErrors.length > 0 ? 'Fix the YAML errors to see results.' : 'Results appear here once there is a Compose file.'}
                  </div>
                )
              ) : rightTab === 'findings' ? (
                <FindingsPanel
                  findings={findings}
                  suppressed={analysis.suppressed}
                  score={analysis.score}
                  onToggleRule={handleToggleRule}
                  onSelectFinding={handleSelectFinding}
                  onJumpToLine={handleJumpToLine}
                  onApplyFix={handleRequestFix}
                  onSuppress={handleSuppressFinding}
                  onFixAll={() => setShowFixAll(true)}
                />
              ) : rightTab === 'problems' ? (
                <ProblemsPanel parseErrors={parseErrors} diagnostics={diagnostics} onJumpToLine={handleJumpToLine} />
              ) : selectedNodeData ? (
                <NodeDetailsPanel
                  nodeData={selectedNodeData}
                  onJumpToLine={handleJumpToLine}
                  onBack={() => setSelectedNodeId(null)}
                />
              ) : (
                <ProjectOverview
                  model={analysis.model}
                  findings={findings}
                  score={analysis.score}
                  onSelectService={(name) => setSelectedNodeId(`service:${name}`)}
                />
              )}
            </div>
          </section>
        )}
      </main>

      {showSettings && (
        <SettingsDialog
          disabledRuleIds={disabledRuleIds}
          onToggleRule={handleToggleRule}
          onEnableAll={() => setDisabledRuleIds(new Set())}
          onClose={() => setShowSettings(false)}
        />
      )}

      {fixPreview && fixPreview.finding.autofix && (
        <FixPreviewDialog
          title={fixPreview.finding.autofix.label}
          subtitle={`${fixPreview.finding.ruleId} · ${fixPreview.finding.title} · ${fixPreview.finding.service}`}
          {...(fixPreview.finding.autofix.caution ? { caution: fixPreview.finding.autofix.caution } : {})}
          before={fixPreview.before}
          after={fixPreview.after}
          onApply={handleConfirmFix}
          onCancel={() => setFixPreview(null)}
        />
      )}

      {showFixAll && (
        <FixAllDialog
          yamlText={yamlText}
          findings={findings}
          disabledRuleIds={disabledRuleIds}
          onApply={(next, count) => {
            setYamlText(next);
            setShowFixAll(false);
            showToast(`Applied ${count} ${count === 1 ? 'fix' : 'fixes'}. Undo with Ctrl/Cmd+Z in the editor.`);
          }}
          onCancel={() => setShowFixAll(false)}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-md px-4 py-2.5 rounded-lg bg-[var(--text-primary)] text-[var(--bg-panel)] shadow-[0_8px_24px_rgb(0_0_0/0.2)] text-[13px]"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
