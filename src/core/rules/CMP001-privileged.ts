import { ComposeModel, Finding, Rule } from '../types';

function buildFix(serviceName: string): string {
  return `Remove \`privileged: true\` and grant only required capabilities:
\`\`\`yaml
services:
  ${serviceName}:
    privileged: false
\`\`\``;
}

export const CMP001: Rule = {
  id: 'CMP001',
  title: 'Privileged mode enabled',
  severity: 'critical',
  description:
    'Disables container isolation and grants root access to all host devices.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.4: Privileged containers',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'Docker Docs: Runtime privilege and Linux capabilities',
      url: 'https://docs.docker.com/engine/containers/run/#runtime-privilege-and-linux-capabilities',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];
    for (const service of Object.values(model.services)) {
      if (service.privileged === true) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.privilegedLine ?? service.line,
          description: this.description,
          message: 'Runs with `privileged: true`.',
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }
    return findings;
  },
};
