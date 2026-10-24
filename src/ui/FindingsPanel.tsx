import { ReactNode, useMemo, useState } from 'react';
import {
  Finding,
  SEVERITY_ORDER,
  Severity,
  calculateSecurityScore,
  groupFindingsBySeverity,
} from '../core';
import { ChevronDownIcon } from './Icons';

interface FindingsPanelProps {
  findings: Finding[];
  onToggleRule: (ruleId: string) => void;
  onSelectFinding: (finding: Finding) => void;
  onApplyFix?: (finding: Finding) => void;
}

export const SEVERITY_DOT_COLORS: Record<Severity, string> = {
  critical: 'bg-[var(--sev-critical-border)]',
  high: 'bg-[var(--sev-high-border)]',
  medium: 'bg-[var(--sev-medium-border)]',
  low: 'bg-[var(--sev-low-border)]',
  info: 'bg-[var(--sev-info-border)]',
};

const SEVERITY_GROUP_STYLES: Record<Severity, string> = {
  critical: 'bg-[var(--sev-critical-group-bg)] text-[var(--sev-critical-fg)]',
  high: 'bg-[var(--sev-high-group-bg)] text-[var(--sev-high-fg)]',
  medium: 'bg-[var(--sev-medium-group-bg)] text-[var(--sev-medium-fg)]',
  low: 'bg-[var(--sev-low-group-bg)] text-[var(--sev-low-fg)]',
  info: 'bg-[var(--sev-info-group-bg)] text-[var(--sev-info-fg)]',
};

const SEVERITY_CHIP_ACTIVE_STYLES: Record<Severity, string> = {
  critical:
    'bg-[var(--sev-critical-chip-bg)] text-[var(--sev-critical-fg)] border-transparent font-medium',
  high: 'bg-[var(--sev-high-chip-bg)] text-[var(--sev-high-fg)] border-transparent font-medium',
  medium:
    'bg-[var(--sev-medium-chip-bg)] text-[var(--sev-medium-fg)] border-transparent font-medium',
  low: 'bg-[var(--sev-low-chip-bg)] text-[var(--sev-low-fg)] border-transparent font-medium',
  info: 'bg-[var(--sev-info-chip-bg)] text-[var(--sev-info-fg)] border-transparent font-medium',
};

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export function renderInlineCode(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={index}
          className="font-mono text-xs text-[var(--text-primary)] bg-[var(--bg-elevated)] px-1 py-0.5 rounded"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function parseFixContent(fix: string): {
  text: string;
  yamlCode: string | null;
} {
  const match = /([\s\S]*?)```yaml\n([\s\S]*?)```/.exec(fix);
  if (match) {
    return {
      text: (match[1] ?? '').trim(),
      yamlCode: (match[2] ?? '').trim(),
    };
  }
  return { text: fix, yamlCode: null };
}

const CONTEXTUAL_MESSAGE_RULES = new Set([
  'CMP002',
  'CMP003',
  'CMP004',
  'CMP006',
  'CMP010',
  'CMP011',
  'CMP012',
  'CMP014',
]);

function formatFindingExplanation(finding: Finding): string {
  if (CONTEXTUAL_MESSAGE_RULES.has(finding.ruleId)) {
    return `${finding.message} ${finding.description}`;
  }
  return finding.description;
}

interface RuleFindingGroup {
  ruleId: string;
  title: string;
  severity: Severity;
  items: Finding[];
}

function groupFindingsByRule(list: Finding[]): RuleFindingGroup[] {
  const map = new Map<string, RuleFindingGroup>();
  for (const f of list) {
    const existing = map.get(f.ruleId);
    if (existing) {
      existing.items.push(f);
    } else {
      map.set(f.ruleId, {
        ruleId: f.ruleId,
        title: f.title,
        severity: f.severity,
        items: [f],
      });
    }
  }
  return Array.from(map.values());
}

export function FindingsPanel({
  findings,
  onToggleRule,
  onSelectFinding,
  onApplyFix,
}: FindingsPanelProps) {
  const [groupBy, setGroupBy] = useState<'severity' | 'service'>('severity');
  // Info hidden by default
  const [visibleSeverities, setVisibleSeverities] = useState<Set<Severity>>(
    () => new Set<Severity>(['critical', 'high', 'medium', 'low']),
  );
  // Low collapsed by default
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set<string>(['low']),
  );
  // Only one finding or rule group expanded at a time
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const scoreSummary = useMemo(
    () => calculateSecurityScore(findings),
    [findings],
  );

  const filteredFindings = useMemo(
    () => findings.filter((f) => visibleSeverities.has(f.severity)),
    [findings, visibleSeverities],
  );

  const groupedBySeverity = useMemo(
    () => groupFindingsBySeverity(filteredFindings),
    [filteredFindings],
  );

  const groupedByService = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of filteredFindings) {
      const list = map.get(f.service) ?? [];
      list.push(f);
      map.set(f.service, list);
    }
    return Array.from(map.entries());
  }, [filteredFindings]);

  const nonZeroSeverities = useMemo(
    () => SEVERITY_ORDER.filter((sev) => scoreSummary.countsBySeverity[sev] > 0),
    [scoreSummary],
  );

  const toggleSeverityFilter = (sev: Severity) => {
    setVisibleSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) {
        next.delete(sev);
      } else {
        next.add(sev);
      }
      return next;
    });
  };

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-panel)] text-[var(--text-primary)] overflow-hidden">
      {/* Top Summary: 40px Grade letter on the left, Score below Grade label, Group toggle, and Filter chips */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-base font-mono border shadow-xs ${
                scoreSummary.grade === 'A'
                  ? 'bg-[var(--node-volume-bg)] text-[var(--node-volume-fg)] border-[var(--node-volume-border)]'
                  : scoreSummary.grade === 'B' || scoreSummary.grade === 'C'
                  ? 'bg-[var(--sev-medium-group-bg)] text-[var(--sev-medium-fg)] border-[var(--sev-medium-border)]'
                  : 'bg-[var(--sev-critical-group-bg)] text-[var(--sev-critical-fg)] border-[var(--sev-critical-border)]'
              }`}
            >
              {scoreSummary.grade}
            </div>
            <div className="flex flex-col justify-center">
              <span className="text-xs text-[var(--text-secondary)] leading-tight">
                Posture Score
              </span>
              <span className="text-xs font-semibold text-[var(--text-primary)] leading-tight">
                {scoreSummary.score}/100
              </span>
            </div>
          </div>

          {/* Group by Severity / Service toggle */}
          <div className="inline-flex rounded bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)] text-xs shrink-0">
            <button
              type="button"
              onClick={() => {
                setGroupBy('severity');
                setExpandedKey(null);
              }}
              className={`px-2 py-0.5 rounded transition-colors ${
                groupBy === 'severity'
                  ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Severity
            </button>
            <button
              type="button"
              onClick={() => {
                setGroupBy('service');
                setExpandedKey(null);
              }}
              className={`px-2 py-0.5 rounded transition-colors ${
                groupBy === 'service'
                  ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Service
            </button>
          </div>
        </div>

        {/* Filter chips per severity (tinted background when active, hide chips with count 0) */}
        {nonZeroSeverities.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {nonZeroSeverities.map((sev) => {
              const active = visibleSeverities.has(sev);
              const count = scoreSummary.countsBySeverity[sev];
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() => toggleSeverityFilter(sev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs transition-colors border ${
                    active
                      ? SEVERITY_CHIP_ACTIVE_STYLES[sev]
                      : 'bg-transparent text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  <span>{SEVERITY_LABELS[sev]}</span>
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Findings List */}
      <div className="flex-1 overflow-y-auto">
        {filteredFindings.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--text-secondary)]">
            No findings. This tool checks configuration only, not image contents.
          </div>
        ) : groupBy === 'severity' ? (
          SEVERITY_ORDER.map((severity) => {
            const group = groupedBySeverity[severity];
            if (group.length === 0) return null;
            const ruleGroups = groupFindingsByRule(group);
            const isCollapsed = collapsedGroups.has(severity);

            return (
              <section key={severity}>
                <button
                  type="button"
                  onClick={() => toggleGroupCollapse(severity)}
                  className={`w-full px-4 py-2 flex items-center justify-between text-xs font-medium transition-colors ${SEVERITY_GROUP_STYLES[severity]}`}
                >
                  <div className="flex items-center gap-2">
                    <span>{SEVERITY_LABELS[severity]}</span>
                    <span>{group.length}</span>
                  </div>
                  <ChevronDownIcon
                    className={`w-3.5 h-3.5 transition-transform ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                </button>

                {!isCollapsed && (
                  <div className="divide-y divide-[var(--border-subtle)]/60">
                    {ruleGroups.map((ruleGroup) => {
                      const itemKey = `rule:${severity}:${ruleGroup.ruleId}`;
                      return (
                        <CompactRuleGroupRow
                          key={itemKey}
                          ruleGroup={ruleGroup}
                          isExpanded={expandedKey === itemKey}
                          onToggleExpand={() => {
                            const first = ruleGroup.items[0];
                            if (first) onSelectFinding(first);
                            setExpandedKey((prev) =>
                              prev === itemKey ? null : itemKey,
                            );
                          }}
                          onSelectFinding={onSelectFinding}
                          onDisableRule={() => onToggleRule(ruleGroup.ruleId)}
                          onApplyFix={onApplyFix}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        ) : (
          groupedByService.map(([serviceName, group]) => {
            const groupKey = `svc:${serviceName}`;
            const isCollapsed = collapsedGroups.has(groupKey);

            return (
              <section key={groupKey}>
                <button
                  type="button"
                  onClick={() => toggleGroupCollapse(groupKey)}
                  className="w-full px-4 py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-subtle)] flex items-center justify-between text-xs font-medium transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-primary)]">
                      {serviceName}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {group.length}
                    </span>
                  </div>
                  <ChevronDownIcon
                    className={`w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                </button>

                {!isCollapsed && (
                  <div className="divide-y divide-[var(--border-subtle)]/60">
                    {group.map((finding, idx) => {
                      const itemKey = `${finding.ruleId}:${finding.service}:${finding.line}:${idx}`;
                      return (
                        <CompactFindingRow
                          key={itemKey}
                          finding={finding}
                          isExpanded={expandedKey === itemKey}
                          onToggleExpand={() => {
                            onSelectFinding(finding);
                            setExpandedKey((prev) =>
                              prev === itemKey ? null : itemKey,
                            );
                          }}
                          onDisableRule={() => onToggleRule(finding.ruleId)}
                          onApplyFix={onApplyFix}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function CompactRuleGroupRow({
  ruleGroup,
  isExpanded,
  onToggleExpand,
  onSelectFinding,
  onDisableRule,
  onApplyFix,
}: {
  ruleGroup: RuleFindingGroup;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelectFinding: (finding: Finding) => void;
  onDisableRule: () => void;
  onApplyFix?: (finding: Finding) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeFinding =
    ruleGroup.items[selectedIndex] ?? ruleGroup.items[0]!;

  const servicesSummary = useMemo(() => {
    const names = Array.from(new Set(ruleGroup.items.map((f) => f.service)));
    if (names.length === 1 && ruleGroup.items.length === 1) {
      return `${names[0]} L${ruleGroup.items[0]!.line}`;
    }
    return names.join(', ');
  }, [ruleGroup.items]);

  return (
    <div className="text-xs">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggleExpand}
        className={`w-full px-3.5 py-2.5 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)]/60 transition-colors ${
          isExpanded ? 'bg-[var(--bg-elevated)]/80' : ''
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            SEVERITY_DOT_COLORS[ruleGroup.severity]
          }`}
          title={ruleGroup.severity}
        />
        <span className="text-[var(--text-secondary)] shrink-0">
          {ruleGroup.ruleId}
        </span>
        <span className="text-[var(--text-primary)] font-medium whitespace-nowrap shrink-0">
          {ruleGroup.title}
        </span>
        <span className="text-[var(--text-secondary)] truncate min-w-0 flex-1 text-right">
          {servicesSummary}
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3.5 pt-1.5 pl-8 space-y-2.5 bg-[var(--bg-elevated)]/30">
          {ruleGroup.items.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {ruleGroup.items.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={`${item.service}-${item.line}-${idx}`}
                    type="button"
                    onClick={() => {
                      setSelectedIndex(idx);
                      onSelectFinding(item);
                    }}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                      isSelected
                        ? 'bg-[var(--accent-bg)] text-[var(--accent)] border-transparent font-medium'
                        : 'bg-transparent text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {item.service} L{item.line}
                  </button>
                );
              })}
            </div>
          )}

          <FindingExpandedContent
            finding={activeFinding}
            onDisableRule={onDisableRule}
            onApplyFix={onApplyFix}
          />
        </div>
      )}
    </div>
  );
}

function CompactFindingRow({
  finding,
  isExpanded,
  onToggleExpand,
  onDisableRule,
  onApplyFix,
}: {
  finding: Finding;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDisableRule: () => void;
  onApplyFix?: (finding: Finding) => void;
}) {
  return (
    <div className="text-xs">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggleExpand}
        className={`w-full px-3.5 py-2.5 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)]/60 transition-colors ${
          isExpanded ? 'bg-[var(--bg-elevated)]/80' : ''
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            SEVERITY_DOT_COLORS[finding.severity]
          }`}
          title={finding.severity}
        />
        <span className="text-[var(--text-secondary)] shrink-0">
          {finding.ruleId}
        </span>
        <span className="text-[var(--text-primary)] font-medium whitespace-nowrap flex-1">
          {finding.title}
        </span>
        <span className="text-[var(--text-muted)] shrink-0">
          L{finding.line}
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3.5 pt-1.5 pl-8 space-y-2.5 bg-[var(--bg-elevated)]/30">
          <FindingExpandedContent
            finding={finding}
            onDisableRule={onDisableRule}
            onApplyFix={onApplyFix}
          />
        </div>
      )}
    </div>
  );
}

function FindingExpandedContent({
  finding,
  onDisableRule,
  onApplyFix,
}: {
  finding: Finding;
  onDisableRule: () => void;
  onApplyFix?: (finding: Finding) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);
  const { text: fixText, yamlCode } = parseFixContent(finding.fix);

  const handleCopyYaml = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!yamlCode) return;
    navigator.clipboard?.writeText(yamlCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleApplyFix = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onApplyFix) return;
    onApplyFix(finding);
    setApplied(true);
    window.setTimeout(() => setApplied(false), 1500);
  };

  const explanation = formatFindingExplanation(finding);

  return (
    <>
      <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
        {renderInlineCode(explanation)}
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          {fixText && (
            <span className="text-xs text-[var(--text-primary)] font-medium">
              {renderInlineCode(fixText)}
            </span>
          )}
          {yamlCode && (
            <div className="flex items-center gap-2 shrink-0">
              {onApplyFix && (
                <button
                  type="button"
                  onClick={handleApplyFix}
                  className="text-xs px-2 py-0.5 rounded bg-[var(--accent-bg)] text-[var(--accent)] font-medium hover:opacity-90 transition-opacity"
                  title="Apply remediation YAML directly to compose file"
                >
                  {applied ? 'Applied!' : 'Apply Fix'}
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyYaml}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
              >
                {copied ? 'Copied' : 'Copy YAML'}
              </button>
            </div>
          )}
        </div>

        {yamlCode && (
          <pre className="p-2.5 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-primary)] overflow-x-auto">
            <code>{yamlCode}</code>
          </pre>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap gap-3 min-w-0">
          {finding.references.map((ref, idx) => (
            <a
              key={idx}
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline truncate"
            >
              {ref.title}
            </a>
          ))}
        </div>

        <button
          type="button"
          onClick={onDisableRule}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
        >
          Mute {finding.ruleId}
        </button>
      </div>
    </>
  );
}
