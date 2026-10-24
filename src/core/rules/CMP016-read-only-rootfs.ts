import { ComposeModel, Finding, Rule } from '../types';
import { OWASP_DOCKER_CHEAT_SHEET, cis } from './shared';

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
    cis('5.13', "Ensure that the container's root filesystem is mounted as read only"),
    {
      title: 'OWASP Docker Security Cheat Sheet: Rule 8, Use a read-only filesystem',
      url: OWASP_DOCKER_CHEAT_SHEET,
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
          autofix: service.volumes.some((v) => v.target.replace(/\/+$/, '') === '/tmp')
            ? {
                label: 'Set read_only: true',
                operations: [
                  { kind: 'setScalar', service: service.name, key: 'read_only', value: true },
                ],
              }
            : {
                label: 'Set read_only: true + tmpfs /tmp',
                operations: [
                  { kind: 'setScalar', service: service.name, key: 'read_only', value: true },
                  {
                    kind: 'addListItem',
                    service: service.name,
                    key: 'tmpfs',
                    item: '/tmp',
                    compare: 'mountTarget',
                  },
                ],
              },
        });
      }
    }

    return findings;
  },
};
