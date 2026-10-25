import { ReactNode, useMemo, useState } from 'react';
import {
  Finding,
  SEVERITY_ORDER,
  SecurityScoreSummary,
  Severity,
  SuppressedFinding,
  groupFindingsBySeverity,
} from '../core';
import { CheckIcon, ChevronDownIcon, CopyIcon, ExternalLinkIcon, WrenchIcon } from './Icons';
import {
  Button,
  SEVERITY_LABELS,
  SEVERITY_SOLID,
  SEVERITY_TEXT,
  SegmentedControl,
  SeverityDot,
  scoreColor,
} from './primitives';

interface FindingsPanelProps {
  findings: Finding[];
  suppressed: SuppressedFinding[];
  score: SecurityScoreSummary;
  onToggleRule: (ruleId: string) => void;
  onSelectFinding: (finding: Finding) => void;
  onJumpToLine: (line: number) => void;
  onApplyFix?: (finding: Finding) => void;
  onSuppress?: (finding: Finding) => void;
  onFixAll?: () => void;
}

const SCORE_EXPLANATION =
  'Each service starts at 100 and loses points per finding (critical 30, high 15, medium 6, low 2). ' +
  'The project score averages the weakest service with the mean of all services. ' +
  'Open critical findings cap the score at 59, high findings at 74. ' +
  'Accepted risks do not count.';

export function renderInlineCode(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={index}
          className="font-mono text-[0.92em] text-[var(--text-primary)] bg-[var(--bg-subtle)] px-1 py-px rounded"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function parseFixContent(fix: string): { text: string; yamlCode: string | null } {
  const match = /([\s\S]*?)```yaml\n([\s\S]*?)```/.exec(fix);
  if (match) {
    return { text: (match[1] ?? '').trim(), yamlCode: (match[2] ?? '').trim() };
  }
  return { text: fix, yamlCode: null };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function verdict(counts: Record<Severity, number>): string {
  if (counts.critical > 0) {
    return `${plural(counts.critical, 'critical issue')} to fix before deploying.`;
  }
  if (counts.high > 0) {
    return `No critical issues. ${plural(counts.high, 'high-severity finding')} left.`;
  }
  if (counts.medium > 0) {
    return `No critical or high issues. ${plural(counts.medium, 'medium finding')} left to harden.`;
  }
  if (counts.low > 0) {
    return `Solid baseline. ${plural(counts.low, 'low-severity improvement')} left.`;
  }
  return 'No findings for the enabled rules.';
}

interface RuleFindingGroup {
  key: string;
  ruleId: string;
  title: string;
  severity: Severity;
  items: Finding[];
}

function groupFindingsByRule(list: Finding[]): RuleFindingGroup[] {
  const map = new Map<string, RuleFindingGroup>();
  for (const f of list) {
    const key = `${f.ruleId}:${f.title}`;
    const existing = map.get(key);
    if (existing) {
      existing.items.push(f);
    } else {
      map.set(key, { key, ruleId: f.ruleId, title: f.title, severity: f.severity, items: [f] });
    }
  }
  return Array.from(map.values());
}

export function FindingsPanel({
  findings,
  suppressed,
  score,
  onToggleRule,
  onSelectFinding,
  onJumpToLine,
  onApplyFix,
  onSuppress,
  onFixAll,
}: FindingsPanelProps) {
  const [groupBy, setGroupBy] = useState<'severity' | 'service'>('severity');
  const [hiddenSeverities, setHiddenSeverities] = useState<Set<Severity>>(() => new Set(['info']));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(['low']));
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showSuppressed, setShowSuppressed] = useState(false);

  const counts = score.countsBySeverity;
  const fixableCount = findings.filter((f) => f.autofix).length;
  const total = findings.length;

  const filtered = useMemo(
    () => findings.filter((f) => !hiddenSeverities.has(f.severity)),
    [findings, hiddenSeverities],
  );
  const bySeverity = useMemo(() => groupFindingsBySeverity(filtered), [filtered]);
  const byService = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of filtered) map.set(f.service, [...(map.get(f.service) ?? []), f]);
    return Array.from(map.entries()).sort(
      (a, b) => (score.serviceScores[a[0]] ?? 100) - (score.serviceScores[b[0]] ?? 100),
    );
  }, [filtered, score.serviceScores]);

  const toggleSeverity = (sev: Severity) =>
    setHiddenSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary */}
      <div className="px-4 pt-3.5 pb-3 border-b border-[var(--border-subtle)] space-y-3 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0" title={SCORE_EXPLANATION}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[26px] leading-none font-semibold tracking-tight tabular text-[var(--text-primary)]">
                {score.score}
              </span>
              <span className="text-xs text-[var(--text-muted)] tabular">/100</span>
              <span
                className="ml-2 text-[13px] font-semibold"
                style={{ color: scoreColor(score.score) }}
              >
                Grade {score.grade}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-[var(--text-secondary)] leading-snug">{verdict(counts)}</p>
          </div>
          {onFixAll && fixableCount > 0 && (
            <Button variant="primary" onClick={onFixAll} title="Review and apply all automatic fixes">
              <WrenchIcon className="w-3.5 h-3.5" />
              Fix all
              <span className="tabular opacity-70">{fixableCount}</span>
            </Button>
          )}
        </div>

        {total > 0 && (
          <div
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]"
            role="img"
            aria-label={SEVERITY_ORDER.map((s) => `${counts[s]} ${s}`).join(', ')}
          >
            {SEVERITY_ORDER.map((sev) =>
              counts[sev] > 0 ? (
                <span
                  key={sev}
                  className="h-full transition-opacity"
                  style={{
                    width: `${(counts[sev] / total) * 100}%`,
                    backgroundColor: SEVERITY_SOLID[sev],
                    opacity: hiddenSeverities.has(sev) ? 0.25 : 1,
                  }}
                />
              ) : null,
            )}
          </div>
        )}

        {total > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {SEVERITY_ORDER.filter((sev) => counts[sev] > 0).map((sev) => {
              const hidden = hiddenSeverities.has(sev);
              return (
                <button
                  key={sev}
                  type="button"
                  aria-pressed={!hidden}
                  onClick={() => toggleSeverity(sev)}
                  title={hidden ? `Show ${sev} findings` : `Hide ${sev} findings`}
                  className={`inline-flex items-center gap-1.5 text-xs rounded px-0.5 transition-colors ${
                    hidden
                      ? 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                      : 'text-[var(--text-primary)]'
                  }`}
                >
                  <SeverityDot severity={sev} className={hidden ? 'opacity-30' : ''} />
                  <span>{SEVERITY_LABELS[sev]}</span>
                  <span className="tabular text-[var(--text-muted)]">{counts[sev]}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Toolbar */}
      {total > 0 && (
        <div className="h-10 px-4 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] shrink-0">
          <span className="text-xs text-[var(--text-muted)] tabular">
            {filtered.length === total ? plural(total, 'finding') : `${filtered.length} of ${total} shown`}
          </span>
          <SegmentedControl
            label="Group findings by"
            value={groupBy}
            onChange={(v) => {
              setGroupBy(v);
              setExpandedKey(null);
            }}
            options={[
              { value: 'severity', label: 'Severity' },
              { value: 'service', label: 'Service' },
            ]}
          />
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {total === 0 ? (
          <div className="px-6 py-10 text-center space-y-1.5">
            <div className="text-[13px] font-medium text-[var(--text-primary)]">No findings</div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              This file passes every enabled rule. Composure checks the Compose configuration,
              not what is inside the images.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-[var(--text-secondary)]">
            All findings are hidden by the severity filter above.
          </div>
        ) : groupBy === 'severity' ? (
          SEVERITY_ORDER.map((severity) => {
            const group = bySeverity[severity];
            if (group.length === 0) return null;
            const collapsed = collapsedGroups.has(severity);
            return (
              <section key={severity}>
                <GroupHeader
                  collapsed={collapsed}
                  onToggle={() => toggleGroup(severity)}
                  left={
                    <>
                      <SeverityDot severity={severity} />
                      <span style={{ color: SEVERITY_TEXT[severity] }}>{SEVERITY_LABELS[severity]}</span>
                      <span className="text-[var(--text-muted)] tabular font-normal">{group.length}</span>
                    </>
                  }
                />
                {!collapsed &&
                  groupFindingsByRule(group).map((ruleGroup) => {
                    const itemKey = `rule:${severity}:${ruleGroup.key}`;
                    return (
                      <RuleGroupRow
                        key={itemKey}
                        group={ruleGroup}
                        expanded={expandedKey === itemKey}
                        onToggle={() => {
                          const first = ruleGroup.items[0];
                          if (first && expandedKey !== itemKey) onSelectFinding(first);
                          setExpandedKey((prev) => (prev === itemKey ? null : itemKey));
                        }}
                        onSelectFinding={onSelectFinding}
                        onDisableRule={() => onToggleRule(ruleGroup.ruleId)}
                        onApplyFix={onApplyFix}
                        onSuppress={onSuppress}
                      />
                    );
                  })}
              </section>
            );
          })
        ) : (
          byService.map(([serviceName, group]) => {
            const groupKey = `svc:${serviceName}`;
            const collapsed = collapsedGroups.has(groupKey);
            const serviceScore = score.serviceScores[serviceName];
            return (
              <section key={groupKey}>
                <GroupHeader
                  collapsed={collapsed}
                  onToggle={() => toggleGroup(groupKey)}
                  left={
                    <>
                      <span className="text-[var(--text-primary)] truncate">{serviceName}</span>
                      <span className="text-[var(--text-muted)] tabular font-normal">{group.length}</span>
                    </>
                  }
                  right={
                    serviceScore !== undefined ? (
                      <span className="tabular font-medium" style={{ color: scoreColor(serviceScore) }}>
                        {serviceScore}
                      </span>
                    ) : null
                  }
                />
                {!collapsed &&
                  group.map((finding, idx) => {
                    const itemKey = `${finding.ruleId}:${finding.service}:${finding.line}:${idx}`;
                    return (
                      <RuleGroupRow
                        key={itemKey}
                        group={{
                          key: itemKey,
                          ruleId: finding.ruleId,
                          title: finding.title,
                          severity: finding.severity,
                          items: [finding],
                        }}
                        showService={false}
                        expanded={expandedKey === itemKey}
                        onToggle={() => {
                          if (expandedKey !== itemKey) onSelectFinding(finding);
                          setExpandedKey((prev) => (prev === itemKey ? null : itemKey));
                        }}
                        onSelectFinding={onSelectFinding}
                        onDisableRule={() => onToggleRule(finding.ruleId)}
                        onApplyFix={onApplyFix}
                        onSuppress={onSuppress}
                      />
                    );
                  })}
              </section>
            );
          })
        )}

        {suppressed.length > 0 && (
          <section className="border-t border-[var(--border-subtle)]">
            <GroupHeader
              collapsed={!showSuppressed}
              onToggle={() => setShowSuppressed((v) => !v)}
              left={
                <>
                  <span className="text-[var(--text-secondary)]">Accepted risks</span>
                  <span className="text-[var(--text-muted)] tabular font-normal">{suppressed.length}</span>
                </>
              }
            />
            {showSuppressed && (
              <ul>
                {suppressed.map((f, idx) => (
                  <li key={`${f.ruleId}-${f.service}-${f.line}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => onJumpToLine(f.suppression.line)}
                      className="w-full pl-4 pr-4 py-2.5 text-left flex items-start gap-2.5 text-xs hover:bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] last:border-b-0"
                    >
                      <SeverityDot severity={f.severity} className="mt-1 opacity-40" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[var(--text-secondary)]">
                          {f.title} <span className="text-[var(--text-muted)]">· {f.service}</span>
                        </span>
                        <span className="block text-[var(--text-muted)] truncate">
                          {f.suppression.reason ?? 'No reason given'}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{f.ruleId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function GroupHeader({
  collapsed,
  onToggle,
  left,
  right,
}: {
  collapsed: boolean;
  onToggle: () => void;
  left: ReactNode;
  right?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="sticky top-0 z-[1] w-full h-9 px-4 flex items-center justify-between gap-2 text-xs font-medium bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] transition-colors"
    >
      <span className="flex items-center gap-2 min-w-0">{left}</span>
      <span className="flex items-center gap-2 shrink-0">
        {right}
        <ChevronDownIcon
          className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
      </span>
    </button>
  );
}

function RuleGroupRow({
  group,
  expanded,
  showService = true,
  onToggle,
  onSelectFinding,
  onDisableRule,
  onApplyFix,
  onSuppress,
}: {
  group: RuleFindingGroup;
  expanded: boolean;
  showService?: boolean;
  onToggle: () => void;
  onSelectFinding: (finding: Finding) => void;
  onDisableRule: () => void;
  onApplyFix?: (finding: Finding) => void;
  onSuppress?: (finding: Finding) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const active = group.items[selectedIndex] ?? group.items[0]!;
  const services = Array.from(new Set(group.items.map((f) => f.service)));
  const meta =
    group.items.length === 1
      ? `${showService ? `${group.items[0]!.service} · ` : ''}line ${group.items[0]!.line}`
      : `${services.join(', ')} · ${group.items.length} places`;

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={`w-full pl-4 pr-4 py-2.5 text-left flex items-start gap-2.5 transition-colors ${
          expanded ? 'bg-[var(--bg-elevated)]' : 'hover:bg-[var(--bg-elevated)]'
        }`}
      >
        <SeverityDot severity={group.severity} className="mt-[5px]" />
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-medium text-[var(--text-primary)] leading-snug">{group.title}</span>
            <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{group.ruleId}</span>
          </span>
          <span className="block mt-0.5 text-xs text-[var(--text-muted)] truncate">{meta}</span>
        </span>
      </button>

      {expanded && (
        <div className="pl-[34px] pr-4 pb-4 pt-1 space-y-3 bg-[var(--bg-elevated)]">
          {group.items.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item, idx) => (
                <button
                  key={`${item.service}-${item.line}-${idx}`}
                  type="button"
                  onClick={() => {
                    setSelectedIndex(idx);
                    onSelectFinding(item);
                  }}
                  className={`h-6 px-2 rounded-md text-xs border transition-colors ${
                    idx === selectedIndex
                      ? 'bg-[var(--bg-panel)] border-[var(--border-hover)] text-[var(--text-primary)] font-medium'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  {item.service} <span className="text-[var(--text-muted)] tabular">L{item.line}</span>
                </button>
              ))}
            </div>
          )}
          <FindingDetail
            finding={active}
            onDisableRule={onDisableRule}
            onApplyFix={onApplyFix}
            onSuppress={onSuppress}
          />
        </div>
      )}
    </div>
  );
}

function FindingDetail({
  finding,
  onDisableRule,
  onApplyFix,
  onSuppress,
}: {
  finding: Finding;
  onDisableRule: () => void;
  onApplyFix?: (finding: Finding) => void;
  onSuppress?: (finding: Finding) => void;
}) {
  const [copied, setCopied] = useState(false);
  const { text: fixText, yamlCode } = parseFixContent(finding.fix);

  const copyYaml = () => {
    if (!yamlCode) return;
    navigator.clipboard
      ?.writeText(yamlCode)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <>
      <p className="text-[13px] text-[var(--text-primary)] leading-relaxed">
        {renderInlineCode(finding.message)}{' '}
        <span className="text-[var(--text-secondary)]">{renderInlineCode(finding.description)}</span>
      </p>

      <div className="space-y-2">
        {fixText && (
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{renderInlineCode(fixText)}</p>
        )}
        {yamlCode && (
          <div className="relative">
            <pre className="p-3 pr-10 rounded-md bg-[var(--bg-panel)] border border-[var(--border-subtle)] font-mono text-xs leading-relaxed text-[var(--text-primary)] overflow-x-auto">
              <code>{yamlCode}</code>
            </pre>
            <button
              type="button"
              onClick={copyYaml}
              aria-label="Copy YAML example"
              title={copied ? 'Copied' : 'Copy YAML example'}
              className="absolute top-2 right-2 h-6 w-6 inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
            >
              {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <CopyIcon className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>

      {(finding.autofix || onSuppress) && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {finding.autofix && onApplyFix && (
              <Button variant="secondary" onClick={() => onApplyFix(finding)} title="Preview the change, then apply it">
                <WrenchIcon className="w-3.5 h-3.5" />
                {finding.autofix.label}
              </Button>
            )}
            {onSuppress && (
              <Button
                variant="ghost"
                onClick={() => onSuppress(finding)}
                title={`Insert "# composure-ignore ${finding.ruleId}" above line ${finding.line}`}
              >
                Accept risk
              </Button>
            )}
          </div>
          {finding.autofix?.caution && (
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">{finding.autofix.caution}</p>
          )}
        </div>
      )}

      <div className="flex items-end justify-between gap-3 pt-1">
        <ul className="space-y-1 min-w-0">
          {finding.references.map((ref, idx) => (
            <li key={idx}>
              <a
                href={ref.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-start gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline underline-offset-2 decoration-[var(--border-strong)] hover:decoration-[var(--text-secondary)]"
              >
                <span>{ref.title}</span>
                <ExternalLinkIcon className="w-3 h-3 mt-0.5 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onDisableRule}
          title={`Turn off ${finding.ruleId} for every file (undo in Settings)`}
          className="shrink-0 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          Mute rule
        </button>
      </div>
    </>
  );
}
