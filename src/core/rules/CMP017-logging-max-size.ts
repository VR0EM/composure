import { ComposeModel, Finding, Rule } from '../types';

function buildFix(serviceName: string): string {
  return `Configure container log limits and rotation:
\`\`\`yaml
services:
  ${serviceName}:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
\`\`\``;
}

export const CMP017: Rule = {
  id: 'CMP017',
  title: 'Uncapped container logging',
  severity: 'low',
  description:
    'Without log limits, runaway container logs can exhaust host storage.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.13: Ensure container log size is restricted',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'Docker Compose Specification: logging',
      url: 'https://docs.docker.com/reference/compose-file/services/#logging',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      if (service.logging?.driver === 'none') {
        continue;
      }

      const maxSize = service.logging?.options?.['max-size'];
      if (!maxSize || maxSize.trim().length === 0) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.loggingLine ?? service.line,
          description: this.description,
          message: 'No `max-size` log rotation limit is configured.',
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
