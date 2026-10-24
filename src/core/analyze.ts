import { parseCompose } from './parser';
import { SecurityScoreSummary, calculateSecurityScore, runRules } from './ruleEngine';
import { SuppressedFinding, applySuppressions, parseSuppressions } from './suppressions';
import { ComposeDiagnostic, ComposeModel, ComposeParseError, Finding, Rule } from './types';

export interface AnalyzeOptions {
  rules?: Rule[];
  disabledRuleIds?: Iterable<string>;
}

export type AnalysisResult =
  | {
      ok: true;
      model: ComposeModel;
      /** Active security findings (after inline suppressions) */
      findings: Finding[];
      /** Findings silenced by `# composure-ignore` comments */
      suppressed: SuppressedFinding[];
      /** Compose correctness problems */
      diagnostics: ComposeDiagnostic[];
      score: SecurityScoreSummary;
    }
  | { ok: false; errors: ComposeParseError[] };

/**
 * One-call analysis used by both the web UI and the CLI:
 * parse, validate, run the hardening rules, apply suppressions, and score.
 */
export function analyzeCompose(yamlText: string, options: AnalyzeOptions = {}): AnalysisResult {
  const parsed = parseCompose(yamlText);
  if (!parsed.ok) return parsed;

  const rawFindings = runRules(parsed.model, {
    ...(options.rules ? { rules: options.rules } : {}),
    ...(options.disabledRuleIds ? { disabledRuleIds: options.disabledRuleIds } : {}),
  });
  const { active, suppressed, unused } = applySuppressions(
    rawFindings,
    parseSuppressions(yamlText),
    parsed.model,
  );

  const diagnostics = [...parsed.diagnostics, ...unused].sort((a, b) => a.line - b.line);
  const score = calculateSecurityScore(active, { services: Object.keys(parsed.model.services) });

  return { ok: true, model: parsed.model, findings: active, suppressed, diagnostics, score };
}
