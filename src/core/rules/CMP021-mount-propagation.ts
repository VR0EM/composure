import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

function buildFix(serviceName: string, source: string, target: string): string {
  return fixWithYaml(
    'Use the default `rprivate` propagation unless the service really has to see mounts created on the host later (or create mounts the host must see):',
    `
services:
  ${serviceName}:
    volumes:
      - type: bind
        source: ${source}
        target: ${target}
        bind:
          propagation: rprivate`,
  );
}

export const CMP021: Rule = {
  id: 'CMP021',
  title: 'Shared mount propagation',
  severity: 'medium',
  description:
    'With shared propagation, mounts made inside the container appear on the host (and vice versa), weakening mount isolation.',
  fix: buildFix('app', './data', '/data'),
  references: [
    cis('5.20', 'Ensure mount propagation mode is not set to shared'),
    {
      title: 'Docker Docs: Bind propagation',
      url: 'https://docs.docker.com/engine/storage/bind-mounts/#configure-bind-propagation',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];
    for (const service of Object.values(model.services)) {
      for (const mount of service.volumes) {
        if (mount.type !== 'bind' || !mount.propagation) continue;
        const mode = mount.propagation.toLowerCase();
        if (mode !== 'shared' && mode !== 'rshared') continue;
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: mount.line,
          description: this.description,
          message: `Bind mount \`${mount.source ?? ''}\` uses \`${mode}\` propagation.`,
          fix: buildFix(service.name, mount.source ?? './data', mount.target),
          references: this.references,
        });
      }
    }
    return findings;
  },
};
