import { ComposeModel, Finding, Rule } from '../types';

function isDockerSocketPath(pathStr?: string): boolean {
  if (!pathStr) return false;
  const normalized = pathStr.trim().replace(/\/+$/, '');
  return (
    normalized === '/var/run/docker.sock' ||
    normalized === '/run/docker.sock' ||
    normalized.endsWith('/docker.sock')
  );
}

function buildFix(serviceName: string): string {
  return `Remove the direct socket mount or connect \`${serviceName}\` to a read-only socket proxy over an internal network:
\`\`\`yaml
services:
  ${serviceName}:
    environment:
      DOCKER_HOST: tcp://socket-proxy:2375
    networks:
      - socket_internal
\`\`\``;
}

export const CMP002: Rule = {
  id: 'CMP002',
  title: 'Docker socket mounted',
  severity: 'critical',
  description:
    'Exposes the Docker daemon API, allowing full root control of the host.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.31: Docker socket mount',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'Docker Docs: Protect the Docker daemon socket',
      url: 'https://docs.docker.com/engine/security/protect-access/',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];
    for (const service of Object.values(model.services)) {
      for (const mount of service.volumes) {
        if (
          isDockerSocketPath(mount.source) ||
          isDockerSocketPath(mount.target)
        ) {
          const roNote = mount.readOnly
            ? ' (`:ro` does not block API calls)'
            : '';
          findings.push({
            ruleId: this.id,
            title: this.title,
            severity: 'critical',
            service: service.name,
            line: mount.line,
            description: this.description,
            message: `Mounts the host Docker socket (${mount.source ?? mount.target})${roNote}.`,
            fix: buildFix(service.name),
            references: this.references,
          });
        }
      }
    }
    return findings;
  },
};
