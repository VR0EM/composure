import { ComposeModel, Finding, Rule } from '../types';

function buildFix(serviceName: string): string {
  return `Set memory and CPU limits under \`deploy.resources.limits\`:
\`\`\`yaml
services:
  ${serviceName}:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "0.50"
\`\`\``;
}

export const CMP014: Rule = {
  id: 'CMP014',
  title: 'No resource limits',
  severity: 'low',
  description:
    'Unbounded containers can exhaust host memory or CPU and starve other services.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.10 and 5.11: Set memory and CPU limits',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'Docker Compose Specification: Deploy resources',
      url: 'https://docs.docker.com/reference/compose-file/deploy/#resources',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      const hasMemory = Boolean(service.resourceLimits?.memory);
      const hasCpus = Boolean(service.resourceLimits?.cpus);

      if (!hasMemory || !hasCpus) {
        const missingParts: string[] = [];
        if (!hasMemory) missingParts.push('memory');
        if (!hasCpus) missingParts.push('CPU');

        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.resourceLimits?.line ?? service.line,
          description: this.description,
          message: `No ${missingParts.join(' or ')} limit is configured.`,
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
