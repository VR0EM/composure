import { CATEGORY_ORDER } from './categories';
import { ALL_RULES, RULES_BY_ID } from './rules';
import { ComposeModel, Finding, Rule, RuleCategory, Severity } from './types';

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

/** How much a service counts as "weak" in a category, by its worst finding there. */
export const CATEGORY_SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 1,
  high: 0.7,
  medium: 0.4,
  low: 0.15,
  info: 0,
};

/** Highest score reachable while a finding of this severity is open. */
export const SEVERITY_SCORE_CAP: Partial<Record<Severity, number>> = {
  critical: 59, // at best a D
  high: 74, // at best a C
};

export type SecurityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface CategoryScore {
  score: number;
  findings: number;
  worst: Severity | 'none';
}

export interface SecurityScoreSummary {
  score: number;
  grade: SecurityGrade;
  countsBySeverity: Record<Severity, number>;
  totalFindings: number;
  /** Per-service scores (0-100) used to compute the overall score */
  serviceScores: Record<string, number>;
  /** The same scoring applied to each rule category on its own */
  categoryScores: Record<RuleCategory, CategoryScore>;
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

  let score = combineServiceScores(Object.values(serviceScores));

  for (const severity of SEVERITY_ORDER) {
    const cap = SEVERITY_SCORE_CAP[severity];
    if (cap !== undefined && countsBySeverity[severity] > 0) {
      score = Math.min(score, cap);
    }
  }

  // Category breakdown: the share of services without issues in that area,
  // weighted by each service's worst finding there.
  const serviceNames = Array.from(penalties.keys());
  const categoryScores = {} as Record<RuleCategory, CategoryScore>;
  for (const category of CATEGORY_ORDER) {
    const inCategory = findings.filter((f) => RULES_BY_ID.get(f.ruleId)?.category === category);
    const worstPerService = new Map<string, number>();
    let worst: Severity | 'none' = 'none';
    for (const f of inCategory) {
      const weight = CATEGORY_SEVERITY_WEIGHT[f.severity];
      worstPerService.set(f.service, Math.max(worstPerService.get(f.service) ?? 0, weight));
      if (worst === 'none' || SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(worst)) {
        worst = f.severity;
      }
    }
    const affected = Array.from(worstPerService.values()).reduce((a, b) => a + b, 0);
    const total = Math.max(1, serviceNames.length);
    categoryScores[category] = {
      score: Math.round(100 * (1 - Math.min(1, affected / total))),
      findings: inCategory.length,
      worst,
    };
  }

  return {
    score,
    grade: gradeForScore(score),
    countsBySeverity,
    totalFindings: findings.length,
    serviceScores,
    categoryScores,
  };
}

/** Average of the weakest service and the mean of all services (100 when empty). */
function combineServiceScores(scores: number[]): number {
  if (scores.length === 0) return 100;
  const worst = Math.min(...scores);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round((worst + mean) / 2);
}
