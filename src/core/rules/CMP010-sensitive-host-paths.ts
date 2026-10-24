import { ComposeModel, Finding, Rule } from '../types';

const SENSITIVE_PREFIXES = [
  '/etc',
  '/root',
  '/home',
  '/proc',
  '/sys',
  '/var/lib/docker',
];

function matchSensitiveHostPath(rawSource?: string): string | null {
  if (!rawSource) return null;
  const trimmed = rawSource.trim();
  if (trimmed === '/') return '/';

  const normalized = trimmed.replace(/\/+$/, '');
  for (const prefix of SENSITIVE_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return prefix;
    }
  }
  return null;
}

function buildFix(serviceName: string, target = '/var/lib/app'): string {
  return `Use a named volume or mount a scoped subdirectory as read-only:
\`\`\`yaml
services:
  ${serviceName}:
    volumes:
      - ${serviceName}_data:${target}:ro
\`\`\``;
}

export const CMP010: Rule = {
  id: 'CMP010',
  title: 'Sensitive host mount',
  severity: 'critical',
  description:
    'Exposes host credentials, system configuration, or runtime files.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.5: Do not mount sensitive host system directories',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const mount of service.volumes) {
        if (mount.type !== 'bind' || !mount.source) continue;
        const matched = matchSensitiveHostPath(mount.source);
        if (!matched) continue;

        const isReadWrite = !mount.readOnly;
        findings.push({
          ruleId: this.id,
          title: isReadWrite
            ? 'Sensitive host mount (rw)'
            : 'Sensitive host mount (ro)',
          severity: isReadWrite ? 'critical' : 'high',
          service: service.name,
          line: mount.line,
          description: this.description,
          message: `Mounts \`${mount.source}\` (${isReadWrite ? 'rw' : 'ro'}) to \`${mount.target}\`.`,
          fix: buildFix(service.name, mount.target),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
