import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

/** Container runtime API sockets that grant control over the host. */
const RUNTIME_SOCKETS: Array<{ pattern: RegExp; runtime: string }> = [
  { pattern: /(^|\/)docker\.sock$/, runtime: 'Docker' },
  { pattern: /(^|\/)containerd\.sock$/, runtime: 'containerd' },
  { pattern: /(^|\/)crio\.sock$/, runtime: 'CRI-O' },
  { pattern: /(^|\/)podman\.sock$/, runtime: 'Podman' },
  { pattern: /(^|\/)dockershim\.sock$/, runtime: 'dockershim' },
];

export function matchRuntimeSocket(pathStr?: string): string | null {
  if (!pathStr) return null;
  const normalized = pathStr.trim().replace(/\/+$/, '');
  for (const { pattern, runtime } of RUNTIME_SOCKETS) {
    if (pattern.test(normalized)) return runtime;
  }
  return null;
}

function buildFix(serviceName: string): string {
  return fixWithYaml(
    `Remove the socket mount, or put a filtering socket proxy in front of it so \`${serviceName}\` only reaches the API calls it needs:`,
    `
services:
  socket-proxy:
    image: tecnativa/docker-socket-proxy:latest # pin a version
    environment:
      CONTAINERS: 1 # allow only what ${serviceName} needs
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - socket_internal

  ${serviceName}:
    environment:
      DOCKER_HOST: tcp://socket-proxy:2375
    networks:
      - socket_internal

networks:
  socket_internal:
    internal: true`,
  );
}

export const CMP002: Rule = {
  id: 'CMP002',
  title: 'Docker socket mounted',
  severity: 'critical',
  description:
    'A container runtime socket gives full control over the host, equivalent to root.',
  fix: buildFix('app'),
  references: [
    cis('5.32', 'Ensure that the Docker socket is not mounted inside any containers'),
    {
      title: 'Docker Docs: Protect the Docker daemon socket',
      url: 'https://docs.docker.com/engine/security/protect-access/',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];
    for (const service of Object.values(model.services)) {
      for (const mount of service.volumes) {
        if (mount.type === 'tmpfs') continue;
        const runtime = matchRuntimeSocket(mount.source) ?? matchRuntimeSocket(mount.target);
        if (!runtime) continue;
        const roNote = mount.readOnly ? ' `:ro` does not block API calls.' : '';
        findings.push({
          ruleId: this.id,
          title: runtime === 'Docker' ? this.title : 'Runtime socket mounted',
          severity: 'critical',
          service: service.name,
          line: mount.line,
          description: this.description,
          message: `Mounts the host ${runtime} socket (\`${mount.source ?? mount.target}\`).${roNote}`,
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }
    return findings;
  },
};
