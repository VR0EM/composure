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

/** Points deducted from a service's score per finding. */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 30,
  high: 15,
  medium: 6,
  low: 2,
  info: 0,
};

/** Highest score reachable while a finding of this severity is open. */
export const SEVERITY_SCORE_CAP: Partial<Record<Severity, number>> = {
  critical: 59, // at best a D
  high: 74, // at best a C
};

export type SecurityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface SecurityScoreSummary {
  score: number;
  grade: SecurityGrade;
  countsBySeverity: Record<Severity, number>;
  totalFindings: number;
  /** Per-service scores (0-100) used to compute the overall score */
  serviceScores: Record<string, number>;
}

export interface SecurityScoreOptions {
  /**
   * All service names in the project. Services without findings count as 100.
   * When omitted, only services that have findings are considered.
   */
  services?: string[];
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

export function gradeForScore(score: number): SecurityGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Compute an overall hardening score (0-100) and letter grade.
 *
 * Each service starts at 100 and loses points per finding
 * (critical 30, high 15, medium 6, low 2, info 0). The project score is the
 * average of the weakest service and the mean of all services, so one bad
 * service drags the grade down, but adding more well-configured services
 * does not. Open critical findings cap the score at 59 (D) and high findings
 * at 74 (C), so a serious issue can never hide behind a good average.
 *
 * Grades: A >= 90, B >= 75, C >= 60, D >= 40, F < 40.
 */
export function calculateSecurityScore(
  findings: Finding[],
  options: SecurityScoreOptions = {},
): SecurityScoreSummary {
  const countsBySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  const penalties = new Map<string, number>();
  for (const name of options.services ?? []) penalties.set(name, 0);

  for (const f of findings) {
    countsBySeverity[f.severity]++;
    penalties.set(f.service, (penalties.get(f.service) ?? 0) + SEVERITY_PENALTY[f.severity]);
  }

  const serviceScores: Record<string, number> = {};
  for (const [name, penalty] of penalties) {
    serviceScores[name] = Math.max(0, 100 - penalty);
  }

  const scores = Object.values(serviceScores);
  let score = 100;
  if (scores.length > 0) {
    const worst = Math.min(...scores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    score = Math.round((worst + mean) / 2);
  }

  for (const severity of SEVERITY_ORDER) {
    const cap = SEVERITY_SCORE_CAP[severity];
    if (cap !== undefined && countsBySeverity[severity] > 0) {
      score = Math.min(score, cap);
    }
  }

  return {
    score,
    grade: gradeForScore(score),
    countsBySeverity,
    totalFindings: findings.length,
    serviceScores,
  };
}
