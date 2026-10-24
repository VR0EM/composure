import { ComposeModel, Finding, Rule } from '../types';

function buildFix(
  serviceName: string,
  source = '/dev/ttyUSB0',
  target = '/dev/ttyUSB0',
): string {
  return `Remove unnecessary device mappings or restrict permissions to read-only (\`:r\`):
\`\`\`yaml
services:
  ${serviceName}:
    devices:
      - "${source}:${target}:r"
\`\`\``;
}

export const CMP011: Rule = {
  id: 'CMP011',
  title: 'Host device mapped',
  severity: 'medium',
  description:
    'Grants direct container access to host hardware device nodes.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.6: Do not expose host devices directly to containers',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const device of service.devices) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: device.line,
          description: this.description,
          message: `Maps host device \`${device.raw}\`.`,
          fix: buildFix(
            service.name,
            device.source,
            device.target ?? device.source,
          ),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
