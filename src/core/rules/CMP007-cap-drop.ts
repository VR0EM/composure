import { ComposeModel, Finding, Rule } from '../types';

function dropsAllCapabilities(capDropValues: string[]): boolean {
  return capDropValues.some((v) => {
    const norm = v.trim().toUpperCase();
    return norm === 'ALL' || norm === 'CAP_ALL';
  });
}

function buildFix(serviceName: string): string {
  return `Drop all default capabilities:
\`\`\`yaml
services:
  ${serviceName}:
    cap_drop:
      - ALL
\`\`\``;
}

export const CMP007: Rule = {
  id: 'CMP007',
  title: 'Capabilities not dropped',
  severity: 'low',
  description:
    'Dropping `ALL` default Linux capabilities reduces the kernel attack surface.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.3: Restrict Linux kernel capabilities',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'OWASP Docker Security Cheat Sheet: Rule 3, Limit Capabilities',
      url: 'https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      const dropped = service.capDrop.map((c) => c.value);
      if (!dropsAllCapabilities(dropped)) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.capDropLine ?? service.line,
          description: this.description,
          message: 'Does not set `cap_drop: [ALL]`.',
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
