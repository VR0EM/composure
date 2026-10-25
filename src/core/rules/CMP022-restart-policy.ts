import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

function buildFix(serviceName: string): string {
  return fixWithYaml(
    'Set a restart policy so the service comes back after a crash or host reboot (use `"no"` for one-shot jobs such as migrations):',
    `
services:
  ${serviceName}:
    restart: unless-stopped`,
  );
}

export const CMP022: Rule = {
  id: 'CMP022',
  title: 'No restart policy',
  severity: 'info',
  category: 'reliability',
  description:
    'Without a restart policy the service stays down after a crash or a host reboot.',
  fix: buildFix('app'),
  references: [
    cis('5.15', "Ensure that the 'on-failure' container restart policy is set to '5'"),
    {
      title: 'Docker Compose Specification: restart',
      url: 'https://docs.docker.com/reference/compose-file/services/#restart',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];
    for (const service of Object.values(model.services)) {
      // `restart` also reflects deploy.restart_policy (see the normalizer)
      if (service.restart !== undefined) continue;
      findings.push({
        ruleId: this.id,
        title: this.title,
        severity: this.severity,
        service: service.name,
        line: service.line,
        description: this.description,
        message: 'No `restart` policy is set.',
        fix: buildFix(service.name),
        references: this.references,
        autofix: {
          label: 'Set restart: unless-stopped',
          caution: 'One-shot jobs (migrations, seeders) should use restart: "no" instead.',
          operations: [{ kind: 'setScalar', service: service.name, key: 'restart', value: 'unless-stopped' }],
        },
      });
    }
    return findings;
  },
};
