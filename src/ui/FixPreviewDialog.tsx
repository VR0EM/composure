import { useEffect, useMemo, useRef } from 'react';
import { diffLines } from '../core';
import { CloseIcon } from './Icons';

interface FixPreviewDialogProps {
  title: string;
  subtitle?: string;
  before: string;
  after: string;
  onApply: () => void;
  onCancel: () => void;
}

const LINE_STYLES = {
  added: 'bg-[var(--node-volume-bg)] text-[var(--text-primary)]',
  removed: 'bg-[var(--sev-critical-group-bg)] text-[var(--text-primary)] line-through decoration-[var(--sev-critical-border)]/50',
  context: 'text-[var(--text-secondary)]',
  gap: 'text-[var(--text-muted)]',
} as const;

const LINE_PREFIX = { added: '+', removed: '-', context: ' ', gap: ' ' } as const;

/** Shows exactly which lines a fix changes before it touches the editor. */
export function FixPreviewDialog({ title, subtitle, before, after, onApply, onCancel }: FixPreviewDialogProps) {
  const lines = useMemo(() => diffLines(before, after, 2), [before, after]);
  const applyRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    applyRef.current?.focus();
  }, []);

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fix-preview-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        className="w-full max-w-2xl rounded-md bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="fix-preview-title" className="text-sm font-semibold text-[var(--text-primary)]">
              {title}
            </h2>
            {subtitle && <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-auto p-3">
          <pre className="font-mono text-xs leading-relaxed rounded border border-[var(--border-subtle)] bg-[var(--bg-app)] py-1.5">
            {lines.map((line, idx) => (
              <div key={idx} className={`flex px-2 ${LINE_STYLES[line.type]}`}>
                <span className="w-8 shrink-0 text-right pr-2 text-[var(--text-muted)] select-none">
                  {line.type === 'removed' ? line.oldLine : line.newLine ?? ''}
                </span>
                <span className="w-3 shrink-0 select-none">{LINE_PREFIX[line.type]}</span>
                <span className="whitespace-pre">{line.text || ' '}</span>
              </div>
            ))}
          </pre>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Only the highlighted lines change. You can undo with Ctrl+Z / Cmd+Z in the editor.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-7 px-3 rounded text-xs font-medium bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
          >
            Cancel
          </button>
          <button
            ref={applyRef}
            type="button"
            onClick={onApply}
            className="h-7 px-3 rounded text-xs font-medium bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90"
          >
            Apply change
          </button>
        </div>
      </div>
    </div>
  );
}
