import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { diffLines } from '../core';
import { CloseIcon } from './Icons';
import { Button, IconButton } from './primitives';

const LINE_STYLES = {
  added: 'bg-[var(--success-bg)] text-[var(--text-primary)]',
  removed: 'bg-[var(--sev-critical-group-bg)] text-[var(--text-secondary)]',
  context: 'text-[var(--text-secondary)]',
  gap: 'text-[var(--text-muted)]',
} as const;

const LINE_PREFIX = { added: '+', removed: '−', context: ' ', gap: ' ' } as const;

const PREFIX_STYLES = {
  added: 'text-[var(--success-fg)]',
  removed: 'text-[var(--sev-critical-fg)]',
  context: 'text-transparent',
  gap: 'text-transparent',
} as const;

/** Unified line diff, used by the single-fix and fix-all dialogs. */
export function DiffView({ before, after, context = 2 }: { before: string; after: string; context?: number }) {
  const lines = useMemo(() => diffLines(before, after, context), [before, after, context]);
  if (lines.length === 0) {
    return <p className="p-4 text-xs text-[var(--text-muted)]">No changes.</p>;
  }
  return (
    <pre className="font-mono text-xs leading-[1.65] py-2 min-w-max">
      {lines.map((line, idx) =>
        line.type === 'gap' ? (
          <div key={idx} className="px-3 py-0.5 text-[var(--text-muted)] select-none">
            ⋯
          </div>
        ) : (
          <div key={idx} className={`flex pr-4 ${LINE_STYLES[line.type]}`}>
            <span className="w-10 shrink-0 text-right pr-3 text-[var(--text-muted)] select-none tabular">
              {line.type === 'removed' ? line.oldLine : line.newLine ?? ''}
            </span>
            <span className={`w-4 shrink-0 select-none ${PREFIX_STYLES[line.type]}`}>
              {LINE_PREFIX[line.type]}
            </span>
            <span className="whitespace-pre">{line.text || ' '}</span>
          </div>
        ),
      )}
    </pre>
  );
}

/** Shared dialog frame: overlay, title row, scrolling body, footer. */
export function Dialog({
  title,
  subtitle,
  onClose,
  footer,
  children,
  width = 'max-w-2xl',
  bodyClassName = '',
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  width?: string;
  bodyClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-50 bg-[var(--overlay)] flex items-center justify-center p-4"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        className={`w-full ${width} max-h-[88vh] rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-[0_12px_40px_rgb(0_0_0/0.25)] overflow-hidden flex flex-col`}
      >
        <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 border-b border-[var(--border-subtle)]">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{subtitle}</div>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon className="w-4 h-4" />
          </IconButton>
        </div>
        <div className={`flex-1 min-h-0 overflow-auto ${bodyClassName}`}>{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface FixPreviewDialogProps {
  title: string;
  subtitle?: string;
  caution?: string;
  before: string;
  after: string;
  onApply: () => void;
  onCancel: () => void;
}

/** Shows exactly which lines a single fix changes before it touches the editor. */
export function FixPreviewDialog({ title, subtitle, caution, before, after, onApply, onCancel }: FixPreviewDialogProps) {
  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
      footer={
        <>
          <span className="mr-auto text-xs text-[var(--text-muted)]">Undo anytime with Ctrl+Z / Cmd+Z</span>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onApply} data-autofocus>
            Apply change
          </Button>
        </>
      }
    >
      <div className="p-4 space-y-3">
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] overflow-x-auto">
          <DiffView before={before} after={after} />
        </div>
        {caution && <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{caution}</p>}
      </div>
    </Dialog>
  );
}
