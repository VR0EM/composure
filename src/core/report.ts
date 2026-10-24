import {
  SEVERITY_ORDER,
  SecurityScoreSummary,
  calculateSecurityScore,
  groupFindingsBySeverity,
} from './ruleEngine';
import { SuppressedFinding } from './suppressions';
import { ComposeDiagnostic, ComposeModel, Finding } from './types';

export interface ReportExtras {
  diagnostics?: ComposeDiagnostic[];
  suppressed?: SuppressedFinding[];
  score?: SecurityScoreSummary;
  /** File name shown in the header */
  fileName?: string;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Generate a standalone Markdown report for a ComposeModel: score, Compose
 * problems, findings with fixes, and accepted (suppressed) risks.
 */
export function generateFindingsMarkdown(
  model: ComposeModel,
  findings: Finding[],
  extras: ReportExtras = {},
): string {
  const serviceNames = Object.keys(model.services);
  const summary =
    extras.score ?? calculateSecurityScore(findings, { services: serviceNames });
  const grouped = groupFindingsBySeverity(findings);
  const diagnostics = extras.diagnostics ?? [];
  const suppressed = extras.suppressed ?? [];

  const lines: string[] = [];
  lines.push('# Composure: Docker Compose Security Hardening Report');
  lines.push('');
  if (extras.fileName) lines.push(`- **File**: \`${extras.fileName}\``);
  if (model.name) lines.push(`- **Project**: \`${model.name}\``);
  lines.push(
    `- **Services Analyzed (${serviceNames.length})**: ${serviceNames.map((s) => `\`${s}\``).join(', ')}`,
  );
  lines.push(`- **Hardening Score**: **${summary.score}/100** (Grade: **${summary.grade}**)`);
  lines.push(`- **Total Findings**: ${summary.totalFindings}`);
  if (suppressed.length > 0) lines.push(`- **Accepted (suppressed) Findings**: ${suppressed.length}`);
  if (diagnostics.length > 0) lines.push(`- **Compose Problems**: ${diagnostics.length}`);
  lines.push('');

  lines.push('## Summary by Severity');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('| :--- | ---: |');
  for (const sev of SEVERITY_ORDER) {
    lines.push(`| **${sev.toUpperCase()}** | ${summary.countsBySeverity[sev]} |`);
  }
  lines.push('');

  const scored = Object.entries(summary.serviceScores);
  if (scored.length > 1) {
    lines.push('## Score by Service');
    lines.push('');
    lines.push('| Service | Score |');
    lines.push('| :--- | ---: |');
    for (const [name, score] of scored.sort((a, b) => a[1] - b[1])) {
      lines.push(`| \`${name}\` | ${score} |`);
    }
    lines.push('');
  }

  if (diagnostics.length > 0) {
    lines.push('## Compose Problems');
    lines.push('');
    lines.push('| Level | Line | Problem |');
    lines.push('| :--- | ---: | :--- |');
    for (const d of diagnostics) {
      lines.push(`| ${d.severity} | ${d.line} | ${escapeCell(d.message)} |`);
    }
    lines.push('');
  }

  if (findings.length === 0) {
    lines.push('## Findings');
    lines.push('');
    lines.push('No security findings detected for the enabled rules.');
    lines.push('');
  } else {
    lines.push('## Detailed Findings');
    lines.push('');

    for (const sev of SEVERITY_ORDER) {
      const list = grouped[sev];
      if (list.length === 0) continue;

      lines.push(`### ${sev.toUpperCase()} (${list.length})`);
      lines.push('');

      for (const f of list) {
        lines.push(`#### [${f.ruleId}] ${f.title}: Service \`${f.service}\` (Line ${f.line})`);
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
  }

  if (suppressed.length > 0) {
    lines.push('## Accepted Risks (suppressed)');
    lines.push('');
    lines.push('| Rule | Service | Line | Reason |');
    lines.push('| :--- | :--- | ---: | :--- |');
    for (const f of suppressed) {
      lines.push(
        `| ${f.ruleId} ${escapeCell(f.title)} | \`${f.service}\` | ${f.line} | ${escapeCell(f.suppression.reason ?? '—')} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
