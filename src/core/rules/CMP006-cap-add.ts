import { ComposeModel, Finding, Rule } from '../types';

const DANGEROUS_CAPS: Record<string, string> = {
  ALL: 'grants all Linux kernel capabilities',
  SYS_ADMIN: 'allows broad system administration operations including mount manipulation',
  NET_ADMIN: 'allows modifying network interfaces, firewall rules, and routing tables',
  SYS_PTRACE: 'allows inspecting and debugging processes',
  SYS_MODULE: 'allows loading and unloading kernel modules',
  DAC_READ_SEARCH: 'bypasses file read and directory search permission checks',
};

function normalizeCapability(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return upper.startsWith('CAP_') ? upper.slice(4) : upper;
}

function buildFix(serviceName: string): string {
  return `Drop all capabilities and add only the specific capability required:
\`\`\`yaml
services:
  ${serviceName}:
    cap_drop:
      - ALL
\`\`\``;
}

export const CMP006: Rule = {
  id: 'CMP006',
  title: 'Dangerous capability',
  severity: 'high',
  description:
    'Broad kernel capabilities weaken isolation and can allow host escape.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.3: Restrict Linux kernel capabilities',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
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
        if (reason) {
          findings.push({
            ruleId: this.id,
            title:
              norm === 'ALL' ? 'All capabilities added' : this.title,
            severity: norm === 'ALL' ? 'critical' : 'high',
            service: service.name,
            line: capEntry.line,
            description: this.description,
            message: `Adds \`${capEntry.value}\`, which ${reason}.`,
            fix: buildFix(service.name),
            references: this.references,
          });
        }
      }
    }

    return findings;
  },
};
