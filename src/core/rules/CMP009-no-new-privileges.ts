import { ComposeModel, Finding, Rule } from '../types';

function hasNoNewPrivileges(securityOptValues: string[]): boolean {
  return securityOptValues.some((raw) => {
    const normalized = raw.replace(/\s+/g, '').toLowerCase();
    return (
      normalized === 'no-new-privileges:true' ||
      normalized === 'no-new-privileges=true' ||
      normalized === 'no-new-privileges'
    );
  });
}

function buildFix(serviceName: string): string {
  return `Enable \`no-new-privileges:true\` under \`security_opt\`:
\`\`\`yaml
services:
  ${serviceName}:
    security_opt:
      - no-new-privileges:true
\`\`\``;
}

export const CMP009: Rule = {
  id: 'CMP009',
  title: 'No no-new-privileges',
  severity: 'medium',
  description:
    'Processes can gain extra privileges via setuid or setgid binaries.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.25: Restrict container from acquiring additional privileges',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      const opts = service.securityOpt.map((s) => s.value);
      if (!hasNoNewPrivileges(opts)) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.securityOptLine ?? service.line,
          description: this.description,
          message: 'Missing `no-new-privileges:true` in `security_opt`.',
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
