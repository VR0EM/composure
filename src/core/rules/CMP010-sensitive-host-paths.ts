import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

/** Host directories whose exposure (whole or any subpath) is sensitive. */
const SENSITIVE_TREES = [
  '/etc',
  '/root',
  '/proc',
  '/sys',
  '/boot',
  '/var/lib/docker',
  '/var/lib/containerd',
  '/var/lib/kubelet',
];

/** Host directories that are only sensitive when mounted as a whole. */
const SENSITIVE_EXACT = ['/', '/dev', '/run', '/var/run', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/var', '/home'];

/** Credential directories inside any home directory. */
const CREDENTIAL_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure', '.config/gcloud'];

/**
 * Read-only mounts that are standard practice and expose nothing secret:
 * time zone data, CA bundles and OS identification.
 */
const READ_ONLY_ALLOWLIST = [
  '/etc/localtime',
  '/etc/timezone',
  '/usr/share/zoneinfo',
  '/etc/ssl/certs',
  '/etc/ca-certificates',
  '/etc/pki/ca-trust',
  '/etc/pki/tls/certs',
  '/usr/share/ca-certificates',
  '/etc/os-release',
  '/usr/lib/os-release',
  '/etc/machine-id',
];

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function matchSensitiveHostPath(
  rawSource: string | undefined,
  readOnly: boolean,
): string | null {
  if (!rawSource) return null;
  const trimmed = rawSource.trim();
  if (trimmed === '/') return '/';
  const normalized = trimmed.replace(/\/+$/, '');

  if (readOnly && READ_ONLY_ALLOWLIST.some((p) => isUnder(normalized, p))) return null;

  // A whole home directory (`~`, `/home/<user>`), or credentials inside one (`~/.ssh`)
  const home = /^(~|\/root|\/home\/[^/]+)(\/.*)?$/.exec(normalized);
  if (home && home[1] !== '/root') {
    const rest = home[2] ?? '';
    if (rest === '') return 'home directory';
    for (const dir of CREDENTIAL_DIRS) {
      if (isUnder(rest, `/${dir}`)) return `~/${dir}`;
    }
  }

  for (const prefix of SENSITIVE_TREES) {
    if (isUnder(normalized, prefix)) return prefix;
  }
  if (SENSITIVE_EXACT.includes(normalized)) return normalized;
  return null;
}

function buildFix(serviceName: string, target: string): string {
  return fixWithYaml(
    'Mount only the specific file or subdirectory the service needs, read-only, or use a named volume:',
    `
services:
  ${serviceName}:
    volumes:
      - ./config/app.conf:${target === '/' ? '/etc/app/app.conf' : target}:ro`,
  );
}

export const CMP010: Rule = {
  id: 'CMP010',
  title: 'Sensitive host mount',
  severity: 'critical',
  category: 'isolation',
  description:
    'Exposes host credentials, system configuration, or runtime files.',
  fix: buildFix('app', '/etc/app/app.conf'),
  references: [
    cis('5.6', 'Ensure sensitive host system directories are not mounted on containers'),
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const mount of service.volumes) {
        if (mount.type !== 'bind' || !mount.source) continue;
        const matched = matchSensitiveHostPath(mount.source, mount.readOnly);
        if (!matched) continue;

        const isReadWrite = !mount.readOnly;
        findings.push({
          ruleId: this.id,
          title: isReadWrite ? 'Sensitive host mount (rw)' : 'Sensitive host mount (ro)',
          severity: isReadWrite ? 'critical' : 'high',
          service: service.name,
          line: mount.line,
          description: this.description,
          message: `Mounts \`${mount.source}\` (${isReadWrite ? 'read-write' : 'read-only'}) to \`${mount.target}\`.`,
          fix: buildFix(service.name, mount.target),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
