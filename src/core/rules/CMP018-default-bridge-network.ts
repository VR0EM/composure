import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

function buildFix(serviceName: string): string {
  return fixWithYaml(
    'Attach the service to user-defined networks, and mark backend networks `internal: true` so they have no route to the outside:',
    `
services:
  ${serviceName}:
    networks:
      - backend

networks:
  backend:
    internal: true`,
  );
}

/**
 * `network_mode: bridge` puts a container on Docker's legacy `docker0` bridge,
 * shared with every other container started that way, without service-name DNS.
 *
 * Note: Compose's implicit `default` network is NOT the docker0 bridge. It is a
 * project-scoped user-defined bridge with DNS, so it is only reported as an
 * informational segmentation hint when several services share it.
 */
export const CMP018: Rule = {
  id: 'CMP018',
  title: 'Default bridge network',
  severity: 'medium',
  description:
    'The legacy `docker0` bridge is shared by all standalone containers on the host and has no service-name DNS.',
  fix: buildFix('app'),
  references: [
    cis('5.30', "Ensure that Docker's default bridge 'docker0' is not used"),
    {
      title: 'Docker Docs: Differences between user-defined bridges and the default bridge',
      url: 'https://docs.docker.com/engine/network/drivers/bridge/#differences-between-user-defined-bridges-and-the-default-bridge',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];
    const services = Object.values(model.services);

    const onImplicitDefault = services.filter((s) =>
      s.networks.some((n) => n.name === 'default' && n.implicit),
    );

    for (const service of services) {
      if (service.networkMode?.trim() === 'bridge') {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.networkModeLine ?? service.line,
          description: this.description,
          message: 'Uses `network_mode: bridge`, the legacy `docker0` bridge shared by all standalone containers.',
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    // Segmentation hint: a flat network lets every service reach every other one
    if (onImplicitDefault.length >= 2) {
      for (const service of onImplicitDefault) {
        findings.push({
          ruleId: this.id,
          title: 'Flat project network',
          severity: 'info',
          service: service.name,
          line: service.line,
          description:
            'All services share the implicit project network, so any compromised service can reach all the others.',
          message: `Shares the implicit \`default\` network with ${onImplicitDefault.length - 1} other service(s).`,
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
