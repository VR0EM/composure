import {
  SEVERITY_ORDER,
  calculateSecurityScore,
  groupFindingsBySeverity,
} from './ruleEngine';
import { ComposeModel, Finding } from './types';

/**
 * Generate a standalone Markdown security hardening report for a ComposeModel
 * and its active findings.
 */
export function generateFindingsMarkdown(
  model: ComposeModel,
  findings: Finding[],
): string {
  const summary = calculateSecurityScore(findings);
  const grouped = groupFindingsBySeverity(findings);
  const serviceNames = Object.keys(model.services);

  const lines: string[] = [];
  lines.push('# Composure: Docker Compose Security Hardening Report');
  lines.push('');
  if (model.name) {
    lines.push(`- **Project**: \`${model.name}\``);
  }
  lines.push(
    `- **Services Analyzed (${serviceNames.length})**: ${serviceNames.map((s) => `\`${s}\``).join(', ')}`,
  );
  lines.push(
    `- **Hardening Score**: **${summary.score}/100** (Grade: **${summary.grade}**)`,
  );
  lines.push(`- **Total Findings**: ${summary.totalFindings}`);
  lines.push('');

  lines.push('## Summary by Severity');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('| :--- | ---: |');
  for (const sev of SEVERITY_ORDER) {
    lines.push(
      `| **${sev.toUpperCase()}** | ${summary.countsBySeverity[sev]} |`,
    );
  }
  lines.push('');

  if (findings.length === 0) {
    lines.push('## Findings');
    lines.push('');
    lines.push('No security findings detected for the enabled rules.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## Detailed Findings');
  lines.push('');

  for (const sev of SEVERITY_ORDER) {
    const list = grouped[sev];
    if (list.length === 0) continue;

    lines.push(`### ${sev.toUpperCase()} (${list.length})`);
    lines.push('');

    for (const f of list) {
      lines.push(
        `#### [${f.ruleId}] ${f.title}: Service \`${f.service}\` (Line ${f.line})`,
      );
      lines.push('');
      lines.push(`${f.message}`);
      lines.push('');
      lines.push(`> ${f.description}`);
      lines.push('');
      lines.push('**Recommended Fix:**');
      lines.push('');
      lines.push(f.fix);
      lines.push('');
      if (f.references.length > 0) {
        lines.push('**References:**');
        for (const ref of f.references) {
          lines.push(`- [${ref.title}](${ref.url})`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
