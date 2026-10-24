import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

const DANGEROUS_CAPS: Record<string, string> = {
  ALL: 'grants every Linux kernel capability',
  SYS_ADMIN: 'allows mount manipulation and many other root-only operations (a common escape vector)',
  SYS_MODULE: 'allows loading kernel modules (full host compromise)',
  SYS_RAWIO: 'allows raw I/O access to host memory and devices',
  SYS_PTRACE: 'allows inspecting and injecting code into other processes',
  SYS_BOOT: 'allows rebooting the host',
  SYS_TIME: 'allows changing the host system clock',
  NET_ADMIN: 'allows modifying network interfaces, firewall rules, and routing tables',
  DAC_READ_SEARCH: 'bypasses file read permission checks (used in the "shocker" escape)',
  MAC_ADMIN: 'allows changing mandatory access control (AppArmor/SELinux) policy',
  MAC_OVERRIDE: 'allows bypassing mandatory access control (AppArmor/SELinux)',
  BPF: 'allows loading eBPF programs into the kernel',
  PERFMON: 'allows kernel performance monitoring and tracing',
  SYSLOG: 'allows reading kernel logs, which can leak kernel addresses',
};

export function normalizeCapability(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return upper.startsWith('CAP_') ? upper.slice(4) : upper;
}

function buildFix(serviceName: string, cap: string): string {
  return fixWithYaml(
    `Remove \`${cap}\`, drop all capabilities, and add back only the ones the service needs:`,
    `
services:
  ${serviceName}:
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE # example: only what is required`,
  );
}

export const CMP006: Rule = {
  id: 'CMP006',
  title: 'Dangerous capability',
  severity: 'high',
  category: 'privileges',
  description:
    'Broad kernel capabilities weaken isolation and can allow host escape.',
  fix: buildFix('app', 'SYS_ADMIN'),
  references: [
    cis('5.4', 'Ensure that Linux kernel capabilities are restricted within containers'),
    {
      title: 'Docker Docs: Runtime privilege and Linux capabilities',
      url: 'https://docs.docker.com/engine/containers/run/#runtime-privilege-and-linux-capabilities',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const capEntry of service.capAdd) {
        const norm = normalizeCapability(capEntry.value);
        const reason = DANGEROUS_CAPS[norm];
        if (!reason) continue;
        findings.push({
          ruleId: this.id,
          title: norm === 'ALL' ? 'All capabilities added' : this.title,
          severity: norm === 'ALL' ? 'critical' : 'high',
          service: service.name,
          line: capEntry.line,
          description: this.description,
          message: `Adds \`${capEntry.value}\`, which ${reason}.`,
          fix: buildFix(service.name, capEntry.value),
          references: this.references,
          autofix: {
            label: `Remove ${capEntry.value}`,
            caution: 'Only if the service works without it; some tools (VPNs, packet capture) genuinely need it.',
            operations: [
              {
                kind: 'removeListItem',
                service: service.name,
                key: 'cap_add',
                item: capEntry.value,
                compare: 'capability',
              },
            ],
          },
        });
      }
    }

    return findings;
  },
};
