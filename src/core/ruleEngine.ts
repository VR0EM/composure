import { ALL_RULES } from './rules';
import { ComposeModel, Finding, Rule, Severity } from './types';

export const SEVERITY_ORDER: Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

const SEVERITY_SORT_WEIGHT: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 25,
  high: 10,
  medium: 4,
  low: 1,
  info: 0,
};

export type SecurityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface SecurityScoreSummary {
  score: number;
  grade: SecurityGrade;
  countsBySeverity: Record<Severity, number>;
  totalFindings: number;
}

export interface RunRulesOptions {
  rules?: Rule[];
  disabledRuleIds?: Iterable<string>;
}

/**
 * Execute all enabled hardening rules against a normalized ComposeModel
 * and return findings sorted by severity (critical -> info) and line number.
 */
export function runRules(
  model: ComposeModel,
  options: RunRulesOptions = {},
): Finding[] {
  const rules = options.rules ?? ALL_RULES;
  const disabledSet = new Set(options.disabledRuleIds ?? []);

  const findings: Finding[] = [];
  for (const rule of rules) {
    if (disabledSet.has(rule.id)) continue;
    const ruleFindings = rule.check(model);
    findings.push(...ruleFindings);
  }

  findings.sort((a, b) => {
    const sevDiff =
      SEVERITY_SORT_WEIGHT[b.severity] - SEVERITY_SORT_WEIGHT[a.severity];
    if (sevDiff !== 0) return sevDiff;
    if (a.line !== b.line) return a.line - b.line;
    return a.ruleId.localeCompare(b.ruleId);
  });

  return findings;
}

/**
 * Group findings by severity in order: critical, high, medium, low, info.
 */
export function groupFindingsBySeverity(
  findings: Finding[],
): Record<Severity, Finding[]> {
  const grouped: Record<Severity, Finding[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    info: [],
  };

  for (const finding of findings) {
    grouped[finding.severity].push(finding);
  }

  return grouped;
}

/**
 * Compute an overall security hardening score (0-100) and letter grade.
 * Penalties: critical -25, high -10, medium -4, low -1, info 0 (minimum 0).
 * Grades: A >= 90, B >= 75, C >= 60, D >= 40, F < 40.
 */
export function calculateSecurityScore(
  findings: Finding[],
): SecurityScoreSummary {
  const countsBySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  let penalty = 0;
  for (const f of findings) {
    countsBySeverity[f.severity]++;
    penalty += SEVERITY_PENALTY[f.severity];
  }

  const score = Math.max(0, 100 - penalty);

  let grade: SecurityGrade;
  if (score >= 90) {
    grade = 'A';
  } else if (score >= 75) {
    grade = 'B';
  } else if (score >= 60) {
    grade = 'C';
  } else if (score >= 40) {
    grade = 'D';
  } else {
    grade = 'F';
  }

  return {
    score,
    grade,
    countsBySeverity,
    totalFindings: findings.length,
  };
}
