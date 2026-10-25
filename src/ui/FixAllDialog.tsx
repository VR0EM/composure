import { useMemo, useState } from 'react';
import { Finding, applyAutofixes, findingKey } from '../core';
import { DiffView, Dialog } from './FixPreviewDialog';
import { Button, SeverityDot } from './primitives';

interface FixAllDialogProps {
  yamlText: string;
  findings: Finding[];
  disabledRuleIds: ReadonlySet<string>;
  onApply: (nextText: string, appliedCount: number) => void;
  onCancel: () => void;
}

interface FixGroup {
  key: string;
  ruleId: string;
  label: string;
  caution?: string;
  items: Finding[];
}

function groupFixes(findings: Finding[]): FixGroup[] {
  const groups = new Map<string, FixGroup>();
  for (const f of findings) {
    if (!f.autofix) continue;
    const key = `${f.ruleId}:${f.title}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(f);
    } else {
      groups.set(key, {
        key,
        ruleId: f.ruleId,
        label: f.title,
        ...(f.autofix.caution ? { caution: f.autofix.caution } : {}),
        items: [f],
      });
    }
  }
  return Array.from(groups.values());
}

/**
 * Review and apply every automatic fix at once. Fixes are listed per rule
 * with checkboxes; the combined diff updates as the selection changes.
 */
export function FixAllDialog({ yamlText, findings, disabledRuleIds, onApply, onCancel }: FixAllDialogProps) {
  const fixable = useMemo(() => findings.filter((f) => f.autofix), [findings]);
  const groups = useMemo(() => groupFixes(fixable), [fixable]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(fixable.map(findingKey)));

  const result = useMemo(
    () => applyAutofixes(yamlText, { disabledRuleIds, selected }),
    [yamlText, disabledRuleIds, selected],
  );

  const toggle = (keys: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const allKeys = fixable.map(findingKey);
  const allOn = allKeys.every((k) => selected.has(k));

  return (
    <Dialog
      title="Fix all"
      subtitle="Choose the fixes to apply and check the combined change. Each fix only edits the lines it needs."
      onClose={onCancel}
      width="max-w-5xl"
      bodyClassName="flex flex-col lg:flex-row"
      footer={
        <>
          <span className="mr-auto text-xs text-[var(--text-muted)] tabular">
            {result.applied.length} of {fixable.length} fixes selected
            {result.skipped.length > 0 && ` · ${result.skipped.length} could not be applied automatically`}
          </span>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={result.applied.length === 0}
            onClick={() => onApply(result.text, result.applied.length)}
            data-autofocus
          >
            Apply {result.applied.length} {result.applied.length === 1 ? 'fix' : 'fixes'}
          </Button>
        </>
      }
    >
      <div className="lg:w-[340px] shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--border-subtle)] overflow-y-auto max-h-[36vh] lg:max-h-none">
        <label className="sticky top-0 z-[1] flex items-center gap-2.5 px-4 h-10 text-xs font-medium bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] cursor-pointer">
          <input
            type="checkbox"
            checked={allOn}
            onChange={(e) => toggle(allKeys, e.target.checked)}
            className="accent-[var(--accent)] w-3.5 h-3.5"
          />
          <span className="text-[var(--text-primary)]">All fixes</span>
          <span className="ml-auto text-[var(--text-muted)] tabular font-normal">{fixable.length}</span>
        </label>
        <ul>
          {groups.map((group) => {
            const keys = group.items.map(findingKey);
            const on = keys.filter((k) => selected.has(k)).length;
            return (
              <li key={group.key} className="border-b border-[var(--border-subtle)] last:border-b-0 py-2.5">
                <label className="flex items-start gap-2.5 px-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on === keys.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < keys.length;
                    }}
                    onChange={(e) => toggle(keys, e.target.checked)}
                    className="mt-0.5 accent-[var(--accent)] w-3.5 h-3.5"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium text-[var(--text-primary)]">{group.label}</span>
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">{group.ruleId}</span>
                    </span>
                    {group.caution && (
                      <span className="block mt-0.5 text-xs text-[var(--text-muted)] leading-snug">
                        {group.caution}
                      </span>
                    )}
                  </span>
                </label>
                <ul className="mt-1.5 space-y-0.5">
                  {group.items.map((item) => {
                    const key = findingKey(item);
                    return (
                      <li key={key}>
                        <label className="flex items-center gap-2.5 pl-10 pr-4 py-0.5 text-xs cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                          <input
                            type="checkbox"
                            checked={selected.has(key)}
                            onChange={(e) => toggle([key], e.target.checked)}
                            className="accent-[var(--accent)] w-3 h-3"
                          />
                          <SeverityDot severity={item.severity} className="w-1.5 h-1.5" />
                          <span className="truncate">
                            {item.autofix?.label}{' '}
                            <span className="text-[var(--text-muted)]">· {item.service}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex-1 min-w-0 min-h-[240px] overflow-auto bg-[var(--bg-app)]">
        <DiffView before={yamlText} after={result.text} context={2} />
      </div>
    </Dialog>
  );
}
