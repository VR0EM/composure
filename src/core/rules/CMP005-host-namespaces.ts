import { ComposeModel, Finding, NormalizedService, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

interface NamespaceCheck {
  field: string;
  label: string;
  title: string;
  value: (s: NormalizedService) => string | undefined;
  line: (s: NormalizedService) => number | undefined;
  impact: string;
}

const NAMESPACES: NamespaceCheck[] = [
  {
    field: 'network_mode',
    label: 'network',
    title: 'Host network shared',
    value: (s) => s.networkMode,
    line: (s) => s.networkModeLine,
    impact: 'it can bind any host port and reach services listening on localhost',
  },
  {
    field: 'pid',
    label: 'PID',
    title: 'Host PID shared',
    value: (s) => s.pid,
    line: (s) => s.pidLine,
    impact: 'it can see and signal every process on the host',
  },
  {
    field: 'ipc',
    label: 'IPC',
    title: 'Host IPC shared',
    value: (s) => s.ipc,
    line: (s) => s.ipcLine,
    impact: 'it can access host shared memory segments',
  },
  {
    field: 'uts',
    label: 'UTS',
    title: 'Host UTS shared',
    value: (s) => s.uts,
    line: (s) => s.utsLine,
    impact: 'it can change the hostname of the host',
  },
  {
    field: 'userns_mode',
    label: 'user',
    title: 'Host userns shared',
    value: (s) => s.usernsMode,
    line: (s) => s.usernsModeLine,
    impact: 'root in the container is root on the host (no user namespace remapping)',
  },
  {
    field: 'cgroup',
    label: 'cgroup',
    title: 'Host cgroup shared',
    value: (s) => s.cgroup,
    line: (s) => s.cgroupLine,
    impact: 'it can see the host cgroup hierarchy',
  },
];

function buildFix(serviceName: string, field: string): string {
  if (field === 'network_mode') {
    return fixWithYaml(
      'Remove `network_mode: host` and publish only the ports you need on a user-defined network:',
      `
services:
  ${serviceName}:
    networks:
      - app_net
    ports:
      - "127.0.0.1:8080:8080"

networks:
  app_net:`,
    );
  }
  return fixWithYaml(
    `Remove \`${field}: host\` so the container keeps its own ${field === 'userns_mode' ? 'user' : field} namespace:`,
    `
services:
  ${serviceName}:
    # ${field}: host   <- remove this line`,
  );
}

export const CMP005: Rule = {
  id: 'CMP005',
  title: 'Host namespace shared',
  severity: 'high',
  category: 'isolation',
  description:
    'Disables namespace isolation between the container and the host.',
  fix: buildFix('app', 'network_mode'),
  references: [
    cis('5.10', "Ensure that the host's network namespace is not shared"),
    cis('5.16', "Ensure that the host's process namespace is not shared"),
    cis('5.17', "Ensure that the host's IPC namespace is not shared"),
    cis('5.21', "Ensure that the host's UTS namespace is not shared"),
    cis('5.31', "Ensure that the host's user namespaces are not shared"),
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const ns of NAMESPACES) {
        if (ns.value(service)?.trim().toLowerCase() !== 'host') continue;
        findings.push({
          ruleId: this.id,
          title: ns.title,
          severity: this.severity,
          service: service.name,
          line: ns.line(service) ?? service.line,
          description: this.description,
          message: `Shares the host ${ns.label} namespace (\`${ns.field}: host\`), so ${ns.impact}.`,
          fix: buildFix(service.name, ns.field),
          references: this.references,
          // Dropping host networking changes how the service is reached, so it stays manual.
          ...(ns.field !== 'network_mode'
            ? {
                autofix: {
                  label: `Remove ${ns.field}: host`,
                  caution: 'Monitoring or system tools that inspect the host may stop working.',
                  operations: [{ kind: 'removeKey' as const, service: service.name, key: ns.field }],
                },
              }
            : {}),
        });
      }
    }

    return findings;
  },
};
