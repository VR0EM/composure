import { ComposeDiagnostic, ComposeParseError, DiagnosticSeverity } from '../core';
import { renderInlineCode } from './FindingsPanel';

interface ProblemsPanelProps {
  parseErrors: ComposeParseError[];
  diagnostics: ComposeDiagnostic[];
  onJumpToLine: (line: number) => void;
}

const LEVEL_STYLES: Record<DiagnosticSeverity, { dot: string; label: string }> = {
  error: { dot: 'bg-[var(--sev-critical-border)]', label: 'Error' },
  warning: { dot: 'bg-[var(--sev-medium-border)]', label: 'Warning' },
  info: { dot: 'bg-[var(--sev-info-border)]', label: 'Info' },
};

/**
 * Compose correctness problems: YAML syntax errors and things `docker compose`
 * would reject or silently ignore. Separate from security findings because
 * they are bugs, not hardening suggestions.
 */
export function ProblemsPanel({ parseErrors, diagnostics, onJumpToLine }: ProblemsPanelProps) {
  const rows: Array<{ severity: DiagnosticSeverity; message: string; line: number; code: string; service?: string }> = [
    ...parseErrors.map((e) => ({ severity: 'error' as const, message: e.message, line: e.line, code: 'yaml-syntax' })),
    ...diagnostics,
  ];

  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-[var(--text-secondary)] space-y-1">
        <div className="text-[var(--text-primary)] font-medium">No Compose problems</div>
        <p>Keys, references, ports and dependencies all check out.</p>
      </div>
    );
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const r of rows) counts[r.severity]++;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center gap-3 text-xs text-[var(--text-secondary)] shrink-0">
        {(['error', 'warning', 'info'] as const).map((level) =>
          counts[level] > 0 ? (
            <span key={level} className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${LEVEL_STYLES[level].dot}`} />
              {counts[level]} {LEVEL_STYLES[level].label.toLowerCase()}
              {counts[level] > 1 ? 's' : ''}
            </span>
          ) : null,
        )}
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-[var(--border-subtle)]/60">
        {rows.map((row, idx) => (
          <li key={`${row.code}-${row.line}-${idx}`}>
            <button
              type="button"
              onClick={() => onJumpToLine(row.line)}
              className="w-full px-3.5 py-2.5 text-left flex items-start gap-2 text-xs hover:bg-[var(--bg-elevated)]/60 transition-colors"
            >
              <span
                className={`mt-1 w-2 h-2 rounded-full shrink-0 ${LEVEL_STYLES[row.severity].dot}`}
                title={LEVEL_STYLES[row.severity].label}
              />
              <span className="flex-1 min-w-0 space-y-0.5">
                <span className="block text-[var(--text-primary)] leading-relaxed">
                  {renderInlineCode(row.message)}
                </span>
                <span className="block text-[var(--text-muted)]">
                  {row.code}
                  {row.service ? ` · ${row.service}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-[var(--text-muted)]">L{row.line}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
