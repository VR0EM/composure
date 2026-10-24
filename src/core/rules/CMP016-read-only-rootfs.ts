import { ComposeModel, Finding, Rule } from '../types';

function buildFix(serviceName: string): string {
  return `Enable \`read_only: true\` and mount \`tmpfs\` for paths that need runtime writes:
\`\`\`yaml
services:
  ${serviceName}:
    read_only: true
    tmpfs:
      - /tmp
\`\`\``;
}

export const CMP016: Rule = {
  id: 'CMP016',
  title: 'Writable root filesystem',
  severity: 'info',
  description:
    'Setting `read_only: true` prevents processes from modifying container binaries.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.12: Mount the container root filesystem as read-only',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'OWASP Docker Security Cheat Sheet: Rule 7, Use a read-only filesystem',
      url: 'https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      if (service.readOnly !== true) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.readOnlyLine ?? service.line,
          description: this.description,
          message: 'Root filesystem is writable.',
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
