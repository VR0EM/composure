import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_RULES,
  ComposeModel,
  ComposeParseError,
  DiagramNodeData,
  Finding,
  applyFindingFix,
  buildComposeGraph,
  compressYamlToHash,
  decompressYamlFromHash,
  generateFindingsMarkdown,
  parseCompose,
  runRules,
} from '../core';
import { ComposeEditor, EditorHandle } from './Editor';
import { FindingsPanel } from './FindingsPanel';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  GitHubIcon,
  MoonIcon,
  SettingsGearIcon,
  SunIcon,
} from './Icons';
import { NodeDetailsPanel } from './NodeDetailsPanel';
import { DEFAULT_COMPOSE_YAML } from './defaultCompose';
import { ComposeDiagram } from './diagram/ComposeDiagram';
import { COMPOSE_EXAMPLES } from './examples';
import {
  downloadTextFile,
  exportDiagramAsPng,
  exportDiagramAsSvg,
} from './exportDiagram';

const initialParseResult = parseCompose(DEFAULT_COMPOSE_YAML);
const initialModel: ComposeModel | null = initialParseResult.ok
  ? initialParseResult.model
  : null;

type MobileTab = 'editor' | 'diagram' | 'findings';
type RightPanelTab = 'findings' | 'details';

function getInitialTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem('composure-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return 'dark';
}

export function App() {
  const [yamlText, setYamlText] = useState<string>(DEFAULT_COMPOSE_YAML);
  const [activeExampleId, setActiveExampleId] =
    useState<string>('production-stack');
  const [fileName, setFileName] = useState<string>('docker-compose.yml');
  const [lastValidModel, setLastValidModel] = useState<ComposeModel | null>(
    initialModel,
  );
  const [parseErrors, setParseErrors] = useState<ComposeParseError[]>(
    initialParseResult.ok ? [] : initialParseResult.errors,
  );
  const [disabledRuleIds, setDisabledRuleIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightPanelTab>('findings');
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('diagram');

  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [shareCopied, setShareCopied] = useState<boolean>(false);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState<boolean>(false);

  const editorRef = useRef<EditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('composure-theme', theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node)
      ) {
        setShowExportMenu(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [showExportMenu]);

  // Global keyboard shortcuts (Esc, Cmd/Ctrl+O, Cmd/Ctrl+S, Cmd/Ctrl+B, Cmd/Ctrl+\)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac =
        typeof navigator !== 'undefined' &&
        navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === 'Escape') {
        if (showSettingsDialog) {
          setShowSettingsDialog(false);
        } else if (showExportMenu) {
          setShowExportMenu(false);
        } else if (selectedNodeId) {
          setSelectedNodeId(null);
          setRightTab('findings');
        }
        return;
      }

      if (mod && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        fileInputRef.current?.click();
        return;
      }

      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        setShowExportMenu((prev) => !prev);
        return;
      }

      if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setLeftCollapsed((prev) => !prev);
        return;
      }

      if (mod && e.key === '\\') {
        e.preventDefault();
        setRightCollapsed((prev) => !prev);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSettingsDialog, showExportMenu, selectedNodeId]);

  // Load shared YAML from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
      decompressYamlFromHash(hash).then((decoded) => {
        if (decoded) {
          setYamlText(decoded);
          setActiveExampleId('custom');
          setFileName('shared-compose.yml');
          const res = parseCompose(decoded);
          if (res.ok) {
            setParseErrors([]);
            setLastValidModel(res.model);
          } else {
            setParseErrors(res.errors);
          }
        }
      });
    }
  }, []);

  // Debounced live parsing while typing
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (yamlText.trim().length === 0) {
        setParseErrors([]);
        setLastValidModel(null);
        return;
      }
      const result = parseCompose(yamlText);
      if (result.ok) {
        setParseErrors([]);
        setLastValidModel(result.model);
      } else {
        setParseErrors(result.errors);
      }
    }, 200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [yamlText]);

  const findings: Finding[] = useMemo(() => {
    if (!lastValidModel) return [];
    return runRules(lastValidModel, { disabledRuleIds });
  }, [lastValidModel, disabledRuleIds]);

  const graph = useMemo(() => {
    if (!lastValidModel) return { nodes: [], edges: [] };
    return buildComposeGraph(lastValidModel, findings);
  }, [lastValidModel, findings]);

  const selectedNodeData: DiagramNodeData | null = useMemo(() => {
    if (!selectedNodeId) return null;
    const found = graph.nodes.find((n) => n.id === selectedNodeId);
    return found ? found.data : null;
  }, [graph, selectedNodeId]);

  const layoutTrigger = useMemo(
    () => (leftCollapsed ? 1 : 0) + (rightCollapsed ? 2 : 0),
    [leftCollapsed, rightCollapsed],
  );

  const handleJumpToLine = (line: number) => {
    if (window.innerWidth < 1024) {
      setMobileTab('editor');
    } else if (leftCollapsed) {
      setLeftCollapsed(false);
    }
    window.requestAnimationFrame(() => {
      editorRef.current?.jumpToLine(line);
    });
  };

  const handleSelectDiagramNode = (
    nodeId: string | null,
    _data: DiagramNodeData | null,
  ) => {
    setSelectedNodeId(nodeId);
    if (nodeId) {
      setRightTab('details');
      if (rightCollapsed) setRightCollapsed(false);
      if (window.innerWidth < 1024) {
        setMobileTab('findings');
      }
    } else {
      setRightTab('findings');
    }
  };

  const handleToggleRule = (ruleId: string) => {
    setDisabledRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  const handleEnableAllRules = () => {
    setDisabledRuleIds(new Set());
  };

  const handleSelectFinding = (finding: Finding) => {
    setSelectedNodeId(`service:${finding.service}`);
    handleJumpToLine(finding.line);
  };

  const handleSelectExample = (exampleId: string) => {
    const ex = COMPOSE_EXAMPLES.find((e) => e.id === exampleId);
    if (!ex) return;
    setActiveExampleId(ex.id);
    setFileName(`${ex.id}.yml`);
    setYamlText(ex.yaml);
    setSelectedNodeId(null);
    setRightTab('findings');
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const handleFileContent = (name: string, content: string) => {
    setFileName(name);
    setActiveExampleId('custom');
    setYamlText(content);
    setSelectedNodeId(null);
    setRightTab('findings');
  };

  const handleFileUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleFileContent(file.name, reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleFileContent(file.name, reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleShareUrl = async () => {
    const encoded = await compressYamlToHash(yamlText);
    const newHash = `#compose=${encoded}`;
    window.history.replaceState(null, '', newHash);
    const fullUrl = `${window.location.origin}${window.location.pathname}${newHash}`;
    await navigator.clipboard?.writeText(fullUrl);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 2000);
  };

  const handleExportMarkdown = () => {
    if (!lastValidModel) return;
    const md = generateFindingsMarkdown(lastValidModel, findings);
    downloadTextFile(md, 'composure-security-report.md');
  };

  const handleApplyFix = (finding: Finding) => {
    const updatedYaml = applyFindingFix(yamlText, finding);
    if (updatedYaml) {
      setYamlText(updatedYaml);
    }
  };

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
      onDrop={handleDrop}
      className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)] select-none"
    >
      {/* Drag and Drop Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-8 pointer-events-none">
          <div className="max-w-md w-full rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-panel)] p-8 text-center space-y-2 shadow-xl">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              Drop your docker-compose.yml to inspect
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              100% client-side. Your compose file never leaves the browser.
            </p>
          </div>
        </div>
      )}

      {/* Header: Wordmark, Preset Switcher, Open, Share, Export Dropdown, GitHub, Settings, Theme */}
      <header className="h-11 border-b border-[var(--border-subtle)] px-4 flex items-center justify-between gap-3 shrink-0 bg-[var(--bg-panel)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-strong)] flex items-center justify-center text-[var(--accent)] shadow-xs">
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <rect x="2" y="2" width="5" height="5" rx="1.2" />
                <rect x="9" y="2" width="5" height="5" rx="1.2" fillOpacity="0.75" />
                <rect x="2" y="9" width="5" height="5" rx="1.2" fillOpacity="0.75" />
                <rect x="9" y="9" width="5" height="5" rx="1.2" fillOpacity="0.4" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
              Composure
            </span>
          </div>

          {/* Direct Preset Stack Switcher */}
          <div className="hidden sm:flex items-center">
            <select
              aria-label="Preset Compose Stack"
              value={activeExampleId}
              onChange={(e) => handleSelectExample(e.target.value)}
              className="h-7 px-2 text-xs rounded bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] focus:outline-none focus:border-[var(--accent)] font-medium cursor-pointer transition-colors"
            >
              {COMPOSE_EXAMPLES.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.label}
                </option>
              ))}
              {activeExampleId === 'custom' && (
                <option value="custom">Custom ({fileName})</option>
              )}
            </select>
          </div>
        </div>

        {/* Mobile/Tablet (< 1024px) Tab Switcher */}
        <div className="flex lg:hidden items-center bg-[var(--bg-elevated)] p-0.5 rounded border border-[var(--border-subtle)] text-xs">
          <button
            type="button"
            onClick={() => setMobileTab('editor')}
            className={`px-2.5 py-1 rounded transition-colors ${
              mobileTab === 'editor'
                ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            Editor
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('diagram')}
            className={`px-2.5 py-1 rounded transition-colors ${
              mobileTab === 'diagram'
                ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            Diagram
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('findings')}
            className={`px-2.5 py-1 rounded transition-colors ${
              mobileTab === 'findings'
                ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            Findings
          </button>
        </div>

        {/* Right Controls: Open, Share, Export dropdown, Settings gear, Theme toggle */}
        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".yml,.yaml,text/yaml,application/x-yaml"
            onChange={handleFileUploadChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Open docker-compose.yml file"
            className="h-7 inline-flex items-center px-2.5 rounded text-xs font-medium bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
          >
            Open
          </button>

          <button
            type="button"
            onClick={handleShareUrl}
            title="Copy shareable link with compressed YAML in URL hash"
            className="h-7 inline-flex items-center px-2.5 rounded text-xs font-medium bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
          >
            {shareCopied ? 'Copied' : 'Share'}
          </button>

          {/* Export Dropdown (Neutral Secondary Button) */}
          <div ref={exportMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowExportMenu((v) => !v)}
              className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded text-xs font-medium bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
            >
              <span>Export</span>
              <ChevronDownIcon className="w-3 h-3" />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 mt-1 w-44 rounded bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-lg py-1 z-30 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    exportDiagramAsSvg(graph, theme);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                >
                  Diagram as SVG
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    exportDiagramAsPng(graph, theme);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                >
                  Diagram as PNG
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    handleExportMarkdown();
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                >
                  Markdown report (.md)
                </button>
              </div>
            )}
          </div>

          {/* GitHub Repository Link */}
          <a
            href="https://github.com/VR0EM/composure"
            target="_blank"
            rel="noreferrer"
            title="View Composure on GitHub"
            aria-label="GitHub Repository"
            className="h-7 w-7 inline-flex items-center justify-center rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
          >
            <GitHubIcon className="w-3.5 h-3.5" />
          </a>

          {/* Settings Gear Button (Presets, Policy & About) */}
          <button
            type="button"
            onClick={() => setShowSettingsDialog(true)}
            title="Settings and About"
            aria-label="Settings"
            className="h-7 w-7 inline-flex items-center justify-center rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
          >
            <SettingsGearIcon className="w-3.5 h-3.5" />
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="Toggle theme"
            className="h-7 w-7 inline-flex items-center justify-center rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
          >
            {theme === 'dark' ? (
              <SunIcon className="w-3.5 h-3.5" />
            ) : (
              <MoonIcon className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </header>

      {/* Main Three-Area Workspace */}
      <main className="flex-1 flex min-h-0 overflow-hidden select-text">
        {/* 1. Left Area: Editor (Collapsible to a thin rail on desktop) */}
        {leftCollapsed ? (
          <aside
            onClick={() => setLeftCollapsed(false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setLeftCollapsed(false);
              }
            }}
            title="Click anywhere to expand YAML editor (Cmd+B)"
            aria-label="Expand YAML editor"
            className="hidden lg:flex w-9 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)] cursor-pointer flex-col items-center py-2.5 gap-3 shrink-0 select-none transition-colors group"
          >
            <div className="p-1 rounded text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
              <ChevronRightIcon className="w-4 h-4" />
            </div>
            <span className="text-xs font-mono text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] [writing-mode:vertical-rl] rotate-180 transition-colors">
              {fileName}
            </span>
          </aside>
        ) : (
          <section
            className={`${
              mobileTab === 'editor' ? 'flex w-full' : 'hidden'
            } lg:flex lg:w-[340px] xl:w-[380px] border-r border-[var(--border-subtle)] flex-col h-full bg-[var(--bg-panel)] shrink-0`}
          >
            <div className="h-9 px-3 border-b border-[var(--border-subtle)] flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-[var(--text-primary)] font-medium truncate">
                  {fileName}
                </span>
                {parseErrors.length > 0 && (
                  <span className="text-xs text-[var(--sev-critical-fg)] shrink-0">
                    {parseErrors.length} error{parseErrors.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setLeftCollapsed(true)}
                title="Collapse editor (Cmd+B)"
                aria-label="Collapse editor"
                className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border border-transparent hover:border-[var(--border-subtle)] transition-colors cursor-pointer"
              >
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                <span>Collapse</span>
              </button>
            </div>

            <div className="flex-1 min-h-0">
              <ComposeEditor
                ref={editorRef}
                value={yamlText}
                onChange={setYamlText}
                errors={parseErrors}
                findings={findings}
                theme={theme}
              />
            </div>

            {parseErrors.length > 0 && (
              <div
                role="alert"
                className="border-t border-[var(--sev-critical-border)] bg-[var(--sev-critical-group-bg)] px-3 py-2 max-h-32 overflow-y-auto space-y-1 shrink-0"
              >
                {parseErrors.map((err, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleJumpToLine(err.line)}
                    className="w-full text-left flex items-start justify-between gap-2 text-xs text-[var(--text-primary)] hover:underline"
                  >
                    <span className="font-mono text-xs break-all">
                      {err.message}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-[var(--sev-critical-fg)]">
                      L{err.line}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 2. Center Area: Diagram taking all remaining space */}
        <section
          className={`${
            mobileTab === 'diagram' ? 'flex w-full' : 'hidden'
          } lg:flex flex-1 min-w-0 h-full relative`}
        >
          <ComposeDiagram
            graph={graph}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectDiagramNode}
            isStale={parseErrors.length > 0}
            theme={theme}
            layoutTrigger={layoutTrigger}
          />
        </section>

        {/* 3. Right Area: Single Panel (~380px wide, collapsible) with "Findings" and "Details" tabs */}
        {rightCollapsed ? (
          <aside
            onClick={() => setRightCollapsed(false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setRightCollapsed(false);
              }
            }}
            title="Click anywhere to expand findings & details panel (Cmd+\)"
            aria-label="Expand findings and details panel"
            className="hidden lg:flex w-9 border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)] cursor-pointer flex-col items-center py-2.5 gap-3 shrink-0 select-none transition-colors group"
          >
            <div className="p-1 rounded text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
              <ChevronLeftIcon className="w-4 h-4" />
            </div>
            <span className="text-xs text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] [writing-mode:vertical-rl] transition-colors">
              Findings ({findings.length})
            </span>
          </aside>
        ) : (
          <section
            className={`${
              mobileTab === 'findings' ? 'flex w-full' : 'hidden'
            } lg:flex lg:w-[380px] border-l border-[var(--border-subtle)] flex-col h-full bg-[var(--bg-panel)] shrink-0`}
          >
            {/* Right Panel Tab Header: Findings | Details */}
            <div className="h-9 px-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-4 h-full text-xs">
                <button
                  type="button"
                  onClick={() => setRightTab('findings')}
                  className={`h-full inline-flex items-center gap-1.5 border-b-2 font-medium transition-colors ${
                    rightTab === 'findings'
                      ? 'border-[var(--accent)] text-[var(--text-primary)]'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>Findings</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {findings.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setRightTab('details')}
                  className={`h-full inline-flex items-center gap-1.5 border-b-2 font-medium transition-colors ${
                    rightTab === 'details'
                      ? 'border-[var(--accent)] text-[var(--text-primary)]'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>Details</span>
                  {selectedNodeData?.kind === 'service' && (
                    <span className="text-xs text-[var(--text-muted)] truncate max-w-[110px]">
                      {selectedNodeData.service.name}
                    </span>
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setRightCollapsed(true)}
                title="Collapse panel (Cmd+\)"
                aria-label="Collapse panel"
                className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border border-transparent hover:border-[var(--border-subtle)] transition-colors cursor-pointer"
              >
                <span>Collapse</span>
                <ChevronRightIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {rightTab === 'findings' ? (
                <FindingsPanel
                  findings={findings}
                  onToggleRule={handleToggleRule}
                  onSelectFinding={handleSelectFinding}
                  onApplyFix={handleApplyFix}
                />
              ) : (
                <NodeDetailsPanel
                  nodeData={selectedNodeData}
                  onJumpToLine={handleJumpToLine}
                />
              )}
            </div>
          </section>
        )}
      </main>

      {/* Settings Dialog (Preset, Policy & About) */}
      {showSettingsDialog && (
        <div
          onClick={() => setShowSettingsDialog(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-md bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setShowSettingsDialog(false)}
                className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-5 text-xs">
              {/* Example Presets */}
              <div className="space-y-2">
                <label
                  htmlFor="settings-preset-select"
                  className="block font-medium text-[var(--text-primary)]"
                >
                  Example Compose File
                </label>
                <select
                  id="settings-preset-select"
                  value={activeExampleId}
                  onChange={(e) => {
                    handleSelectExample(e.target.value);
                  }}
                  className="w-full h-8 px-2.5 rounded bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-strong)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {COMPOSE_EXAMPLES.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.label}: {ex.description}
                    </option>
                  ))}
                  {activeExampleId === 'custom' && (
                    <option value="custom">Custom ({fileName})</option>
                  )}
                </select>
              </div>

              {/* Policy Rules */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[var(--text-primary)]">
                    Hardening Policy Rules (
                    {ALL_RULES.length - disabledRuleIds.size}/{ALL_RULES.length}{' '}
                    enabled)
                  </span>
                  {disabledRuleIds.size > 0 && (
                    <button
                      type="button"
                      onClick={handleEnableAllRules}
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
                    >
                      Enable all
                    </button>
                  )}
                </div>

                <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded max-h-60 overflow-y-auto">
                  {ALL_RULES.map((rule) => {
                    const enabled = !disabledRuleIds.has(rule.id);
                    return (
                      <label
                        key={rule.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-[var(--bg-elevated)] cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() => handleToggleRule(rule.id)}
                            className="accent-[var(--accent)] rounded cursor-pointer"
                          />
                          <span className="text-xs text-[var(--text-secondary)] shrink-0">
                            {rule.id}
                          </span>
                          <span
                            className={`truncate ${
                              enabled
                                ? 'text-[var(--text-primary)]'
                                : 'text-[var(--text-muted)] line-through'
                            }`}
                          >
                            {rule.title}
                          </span>
                        </div>
                        <span className="text-xs text-[var(--text-secondary)] shrink-0 capitalize">
                          {rule.severity}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* About & Privacy */}
              <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2 text-[var(--text-secondary)] leading-relaxed">
                <div className="font-medium text-[var(--text-primary)]">
                  About Composure &amp; Privacy
                </div>
                <p>
                  Composure runs 100% client-side in your browser. There is no
                  backend, no external API calls, no analytics, and no
                  telemetry. Your{' '}
                  <code className="font-mono text-[var(--text-primary)]">
                    docker-compose.yml
                  </code>{' '}
                  file never leaves your browser.
                </p>
                <p>
                  When you use the Share action, your YAML is compressed locally
                  into the URL fragment (
                  <code className="font-mono">#compose=...</code>), which
                  browsers never transmit to web servers.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
