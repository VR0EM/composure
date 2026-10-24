import { ComposeModel, Finding, Rule } from '../types';

function buildFix(serviceName: string): string {
  return `Remove the \`unconfined\` option so Docker applies its default profile:
\`\`\`yaml
services:
  ${serviceName}:
    security_opt:
      - no-new-privileges:true
\`\`\``;
}

export const CMP008: Rule = {
  id: 'CMP008',
  title: 'Profile unconfined',
  severity: 'high',
  description:
    'Disables default syscall filtering or mandatory access control.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.2 and 5.21: AppArmor and seccomp profiles',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'Docker Docs: Seccomp security profiles',
      url: 'https://docs.docker.com/engine/security/seccomp/',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const opt of service.securityOpt) {
        const normalized = opt.value.replace(/\s+/g, '').toLowerCase();
        if (
          normalized === 'seccomp:unconfined' ||
          normalized === 'seccomp=unconfined'
        ) {
          findings.push({
            ruleId: this.id,
            title: 'seccomp unconfined',
            severity: this.severity,
            service: service.name,
            line: opt.line,
            description: this.description,
            message: 'Sets `seccomp:unconfined`.',
            fix: buildFix(service.name),
            references: this.references,
          });
        } else if (
          normalized === 'apparmor:unconfined' ||
          normalized === 'apparmor=unconfined'
        ) {
          findings.push({
            ruleId: this.id,
            title: 'apparmor unconfined',
            severity: this.severity,
            service: service.name,
            line: opt.line,
            description: this.description,
            message: 'Sets `apparmor:unconfined`.',
            fix: buildFix(service.name),
            references: this.references,
          });
        }
      }
    }

    return findings;
  },
};
