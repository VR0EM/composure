import { ComposeModel, Finding, Rule } from '../types';

function buildFix(serviceName: string): string {
  return `Isolate service inside a user-defined network:
\`\`\`yaml
services:
  ${serviceName}:
    networks:
      - internal_net
networks:
  internal_net:
\`\`\``;
}

export const CMP018: Rule = {
  id: 'CMP018',
  title: 'Default bridge network',
  severity: 'medium',
  description:
    'Default bridge networks lack DNS discovery and allow unsegmented container access.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.9: Ensure default bridge network is not used',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'Docker Docs: Use user-defined bridge networks',
      url: 'https://docs.docker.com/network/drivers/bridge/',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      const explicitBridge = service.networkMode === 'bridge';
      const implicitDefault = service.networks.some(
        (n) => n.name === 'default' && n.implicit,
      );

      if (explicitBridge || implicitDefault) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line:
            service.networkModeLine ??
            service.fieldLines['networks'] ??
            service.line,
          description: this.description,
          message: explicitBridge
            ? 'Explicitly bound to the legacy Docker default bridge.'
            : 'Implicitly attached to default network without custom isolation.',
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
