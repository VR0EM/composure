import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

interface UnconfinedMatch {
  title: string;
  message: string;
}

/** Normalize `seccomp=unconfined`, `seccomp:unconfined`, `seccomp: unconfined` alike. */
export function normalizeSecurityOpt(raw: string): string {
  return raw.replace(/\s+/g, '').toLowerCase().replace('=', ':');
}

function matchUnconfined(raw: string): UnconfinedMatch | null {
  const normalized = normalizeSecurityOpt(raw);
  switch (normalized) {
    case 'seccomp:unconfined':
      return { title: 'seccomp unconfined', message: 'Disables the default seccomp syscall filter.' };
    case 'apparmor:unconfined':
      return { title: 'apparmor unconfined', message: 'Disables the AppArmor profile.' };
    case 'label:disable':
      return { title: 'SELinux labels disabled', message: 'Disables SELinux label separation.' };
    case 'systempaths:unconfined':
      return {
        title: 'System paths unmasked',
        message: 'Unmasks sensitive `/proc` and `/sys` paths that Docker normally hides.',
      };
    default:
      return null;
  }
}

function buildFix(serviceName: string, option: string): string {
  return fixWithYaml(
    `Remove \`${option}\` so Docker applies its default confinement. If the service needs one extra syscall, ship a custom seccomp profile instead:`,
    `
services:
  ${serviceName}:
    security_opt:
      - no-new-privileges:true
      # - seccomp=./seccomp-profile.json  # custom profile if really needed`,
  );
}

export const CMP008: Rule = {
  id: 'CMP008',
  title: 'Profile unconfined',
  severity: 'high',
  category: 'isolation',
  description:
    'Disables default syscall filtering or mandatory access control.',
  fix: buildFix('app', 'seccomp:unconfined'),
  references: [
    cis('5.2', 'Ensure that, if applicable, an AppArmor Profile is enabled'),
    cis('5.3', 'Ensure that, if applicable, SELinux security options are set'),
    cis('5.22', 'Ensure the default seccomp profile is not Disabled'),
    {
      title: 'Docker Docs: Seccomp security profiles',
      url: 'https://docs.docker.com/engine/security/seccomp/',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const opt of service.securityOpt) {
        const match = matchUnconfined(opt.value);
        if (!match) continue;
        findings.push({
          ruleId: this.id,
          title: match.title,
          severity: this.severity,
          service: service.name,
          line: opt.line,
          description: this.description,
          message: `${match.message} (\`${opt.value}\`)`,
          fix: buildFix(service.name, opt.value),
          references: this.references,
          autofix: {
            label: `Remove ${opt.value}`,
            caution: 'Check that the service still starts under the default profile.',
            operations: [
              {
                kind: 'removeListItem',
                service: service.name,
                key: 'security_opt',
                item: opt.value,
                compare: 'securityOpt',
              },
            ],
          },
        });
      }
    }

    return findings;
  },
};
