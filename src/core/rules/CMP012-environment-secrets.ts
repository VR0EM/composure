import { ComposeModel, Finding, Rule } from '../types';

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?key|jwt[_-]?key)/i;

function isSensitiveKeyName(key: string): boolean {
  const trimmed = key.trim();
  if (/(_file|_path)$/i.test(trimmed)) {
    return false;
  }
  return SECRET_KEY_PATTERN.test(trimmed);
}

function isInterpolatedOrSecretFile(value: string | null): boolean {
  if (value === null) return true;
  const trimmed = value.trim();
  if (trimmed === '') return true;
  if (trimmed.includes('${') || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('/run/secrets/')) {
    return true;
  }
  return false;
}

function buildFix(serviceName: string, key = 'POSTGRES_PASSWORD'): string {
  return `Reference the secret via \`\${${key}}\`, \`env_file\`, or Docker \`secrets\`:
\`\`\`yaml
services:
  ${serviceName}:
    environment:
      ${key}: \${${key}}
\`\`\``;
}

export const CMP012: Rule = {
  id: 'CMP012',
  title: 'Secret in environment',
  severity: 'high',
  description:
    'Plaintext credentials in Compose files leak via git and `docker inspect`.',
  fix: buildFix('db'),
  references: [
    {
      title: 'Docker Docs: How to use secrets in Docker Compose',
      url: 'https://docs.docker.com/compose/how-tos/use-secrets/',
    },
    {
      title: 'OWASP Docker Security Cheat Sheet: Rule 8, Do not store secrets in configuration',
      url: 'https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const entry of service.environment) {
        if (!isSensitiveKeyName(entry.key)) continue;
        if (isInterpolatedOrSecretFile(entry.value)) continue;

        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: entry.line,
          description: this.description,
          message: `Sets a literal value for \`${entry.key}\`.`,
          fix: buildFix(service.name, entry.key),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
