import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

function buildFix(serviceName: string): string {
  return fixWithYaml(
    'Remove `privileged: true` and grant only the specific capabilities or devices the service needs:',
    `
services:
  ${serviceName}:
    privileged: false
    cap_add:
      - NET_BIND_SERVICE # example: add only what is required`,
  );
}

export const CMP001: Rule = {
  id: 'CMP001',
  title: 'Privileged mode enabled',
  severity: 'critical',
  category: 'privileges',
  description:
    'Disables container isolation and grants root access to all host devices.',
  fix: buildFix('app'),
  references: [
    cis('5.5', 'Ensure that privileged containers are not used'),
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
          autofix: {
            label: 'Set privileged: false',
            caution: 'The service loses access to host devices; add back only the specific devices or capabilities it needs.',
            operations: [
              { kind: 'setScalar', service: service.name, key: 'privileged', value: false },
            ],
          },
        });
      }
    }
    return findings;
  },
};
