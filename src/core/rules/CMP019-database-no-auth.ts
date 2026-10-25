import { ComposeModel, Finding, NormalizedService, Rule } from '../types';
import { fixWithYaml } from './shared';

const TRUTHY = /^(yes|true|1|on|y)$/i;

interface AuthCheck {
  key: RegExp;
  matches: (value: string) => boolean;
  describe: (key: string) => string;
}

/** Environment settings that turn authentication off in popular datastore images. */
const AUTH_CHECKS: AuthCheck[] = [
  {
    key: /^POSTGRES_HOST_AUTH_METHOD$/,
    matches: (v) => v.trim().toLowerCase() === 'trust',
    describe: () => 'PostgreSQL accepts every connection without a password (`POSTGRES_HOST_AUTH_METHOD: trust`).',
  },
  {
    key: /^(MYSQL_ALLOW_EMPTY_PASSWORD|MARIADB_ALLOW_EMPTY_ROOT_PASSWORD|MARIADB_ALLOW_EMPTY_PASSWORD)$/,
    matches: (v) => TRUTHY.test(v.trim()),
    describe: (k) => `The database root account has an empty password (\`${k}\`).`,
  },
  {
    key: /^ALLOW_EMPTY_PASSWORD$/,
    matches: (v) => TRUTHY.test(v.trim()),
    describe: () => 'Authentication is disabled (`ALLOW_EMPTY_PASSWORD`, used by Bitnami images).',
  },
  {
    key: /^xpack\.security\.enabled$/,
    matches: (v) => /^(false|no|0|off)$/i.test(v.trim()),
    describe: () => 'Elasticsearch security (authentication and TLS) is disabled.',
  },
  {
    key: /^plugins\.security\.disabled$/,
    matches: (v) => TRUTHY.test(v.trim()),
    describe: () => 'OpenSearch security (authentication and TLS) is disabled.',
  },
];

function isPubliclyPublished(service: NormalizedService): boolean {
  if (service.networkMode?.trim() === 'host') return true;
  return service.ports.some((p) => {
    const ip = p.hostIp?.trim().replace(/^\[|\]$/g, '');
    return !ip || ip === '0.0.0.0' || ip === '::';
  });
}

function buildFix(serviceName: string): string {
  return fixWithYaml(
    'Keep authentication on and provide the password through Compose secrets (or `${VAR}` from an untracked `.env` file):',
    `
services:
  ${serviceName}:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt`,
  );
}

export const CMP019: Rule = {
  id: 'CMP019',
  title: 'Database auth disabled',
  severity: 'high',
  category: 'secrets',
  description:
    'Anyone who can reach the datastore over the network can read and change all of its data.',
  fix: buildFix('db'),
  references: [
    {
      title: 'Docker Hub: postgres image, POSTGRES_HOST_AUTH_METHOD',
      url: 'https://hub.docker.com/_/postgres',
    },
    {
      title: 'Docker Hub: mysql image, MYSQL_ALLOW_EMPTY_PASSWORD',
      url: 'https://hub.docker.com/_/mysql',
    },
    {
      title: 'OWASP Top 10: A07 Identification and Authentication Failures',
      url: 'https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      const exposed = isPubliclyPublished(service);
      for (const entry of service.environment) {
        if (entry.value === null) continue;
        const check = AUTH_CHECKS.find((c) => c.key.test(entry.key));
        if (!check || !check.matches(entry.value)) continue;
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: exposed ? 'critical' : this.severity,
          service: service.name,
          line: entry.line,
          description: this.description,
          message: `${check.describe(entry.key)}${exposed ? ' The service is also published on all interfaces.' : ''}`,
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
