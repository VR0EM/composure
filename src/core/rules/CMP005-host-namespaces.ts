import { ComposeModel, Finding, Rule } from '../types';

function buildFix(serviceName: string, fieldName = 'network_mode'): string {
  return `Remove \`${fieldName}: host\` and use isolated container namespaces:
\`\`\`yaml
services:
  ${serviceName}:
    networks:
      - default
\`\`\``;
}

export const CMP005: Rule = {
  id: 'CMP005',
  title: 'Host namespace shared',
  severity: 'high',
  description:
    'Disables namespace isolation between the container and the host.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.9, 5.15, 5.16, 5.30: Host namespace isolation',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      if (service.networkMode?.trim().toLowerCase() === 'host') {
        findings.push({
          ruleId: this.id,
          title: 'Host network shared',
          severity: this.severity,
          service: service.name,
          line: service.networkModeLine ?? service.line,
          description: this.description,
          message: 'Shares the host network namespace (`network_mode: host`).',
          fix: buildFix(service.name, 'network_mode'),
          references: this.references,
        });
      }

      if (service.pid?.trim().toLowerCase() === 'host') {
        findings.push({
          ruleId: this.id,
          title: 'Host PID shared',
          severity: this.severity,
          service: service.name,
          line: service.pidLine ?? service.line,
          description: this.description,
          message: 'Shares the host PID namespace (`pid: host`).',
          fix: buildFix(service.name, 'pid'),
          references: this.references,
        });
      }

      if (service.ipc?.trim().toLowerCase() === 'host') {
        findings.push({
          ruleId: this.id,
          title: 'Host IPC shared',
          severity: this.severity,
          service: service.name,
          line: service.ipcLine ?? service.line,
          description: this.description,
          message: 'Shares the host IPC namespace (`ipc: host`).',
          fix: buildFix(service.name, 'ipc'),
          references: this.references,
        });
      }

      if (service.usernsMode?.trim().toLowerCase() === 'host') {
        findings.push({
          ruleId: this.id,
          title: 'Host userns shared',
          severity: this.severity,
          service: service.name,
          line: service.usernsModeLine ?? service.line,
          description: this.description,
          message: 'Shares the host user namespace (`userns_mode: host`).',
          fix: buildFix(service.name, 'userns_mode'),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
