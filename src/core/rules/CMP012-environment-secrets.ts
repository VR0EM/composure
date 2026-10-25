import { ComposeModel, EnvironmentEntry, Finding, Rule, Severity } from '../types';
import { OWASP_DOCKER_CHEAT_SHEET, fixWithYaml, isInterpolated } from './shared';

const SECRET_KEY_PATTERN =
  /(password|passwd|_pwd$|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?key|jwt[_-]?key|credentials?)/i;

/** Key suffixes that name settings *about* a secret rather than the secret itself. */
const NON_SECRET_SUFFIX =
  /(_file|_path|_dir|_length|_len|_min|_max|_ttl|_expiry|_expires?|_expiration|_timeout|_lifetime|_age|_interval|_enabled|_required|_policy|_type|_method|_algorithm|_alg|_rounds|_cost|_size|_header|_url|_uri|_endpoint|_host|_port|_user|_username|_name|_id|_seconds|_minutes|_hours|_days|_ms|_count|_limit|_mode|_format|_version|_prefix)$/i;

/** Values that can never be a real secret: flags, numbers of a few digits, placeholders. */
function isNonSecretValue(value: string): boolean {
  const v = value.trim();
  return (
    /^(true|false|yes|no|on|off|y|n|0|1|null|none|~)$/i.test(v) ||
    /^<[^>]+>$/.test(v) || // <your-password-here> style placeholders
    /^(\.{0,2}\/|~\/)[\w./-]*$/.test(v) // a file path, e.g. GOOGLE_APPLICATION_CREDENTIALS
  );
}

export function isSensitiveKeyName(key: string): boolean {
  const trimmed = key.trim();
  if (NON_SECRET_SUFFIX.test(trimmed)) return false;
  return SECRET_KEY_PATTERN.test(trimmed);
}

/** Well-known credential formats, matched in any environment value. */
const TOKEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'an AWS access key ID' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, label: 'a GitHub token' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/, label: 'a GitHub fine-grained token' },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/, label: 'a GitLab token' },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/, label: 'a Slack token' },
  { pattern: /\b(sk|rk)_live_[A-Za-z0-9]{16,}\b/, label: 'a Stripe live key' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'a Google API key' },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/, label: 'an Anthropic API key' },
  { pattern: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, label: 'an OpenAI API key' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'a private key' },
];

/** `scheme://user:password@host` with a literal (non-interpolated) password. */
const URL_CREDENTIALS = /^[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/i;

/** `${VAR:-fallback}` / `${VAR-fallback}` with a literal fallback. */
const FALLBACK = /\$\{([A-Za-z_][A-Za-z0-9_]*):?-([^}]+)\}/;

interface SecretHit {
  title: string;
  severity: Severity;
  message: string;
  replaceable: boolean;
}

function classify(entry: EnvironmentEntry): SecretHit | null {
  const value = entry.value;
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();

  for (const { pattern, label } of TOKEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        title: 'Secret in environment',
        severity: 'high',
        message: `\`${entry.key}\` contains what looks like ${label}.`,
        replaceable: true,
      };
    }
  }

  const url = URL_CREDENTIALS.exec(trimmed);
  if (url && !isInterpolated(url[1] ?? '')) {
    return {
      title: 'Credentials in URL',
      severity: 'high',
      message: `\`${entry.key}\` embeds a literal password in a connection URL.`,
      replaceable: false,
    };
  }

  if (!isSensitiveKeyName(entry.key)) return null;

  const fallback = FALLBACK.exec(trimmed);
  if (fallback) {
    const literal = (fallback[2] ?? '').trim();
    if (literal && !literal.includes('$') && !isNonSecretValue(literal)) {
      return {
        title: 'Hardcoded secret fallback',
        severity: 'medium',
        message: `\`${entry.key}\` falls back to a hardcoded value when \`${fallback[1]}\` is unset.`,
        replaceable: false,
      };
    }
    return null;
  }

  if (isInterpolated(trimmed) || trimmed.startsWith('/run/secrets/') || isNonSecretValue(trimmed)) {
    return null;
  }

  return {
    title: 'Secret in environment',
    severity: 'high',
    message: `Sets a literal value for \`${entry.key}\`.`,
    replaceable: true,
  };
}

function buildFix(serviceName: string, key = 'POSTGRES_PASSWORD'): string {
  const varName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : 'SECRET_VALUE';
  return fixWithYaml(
    `Load the value from the shell or an untracked \`.env\` file with \`\${${varName}}\`, or better, use Compose \`secrets\` (mounted at \`/run/secrets/\`) where the image supports \`*_FILE\` variables:`,
    `
services:
  ${serviceName}:
    environment:
      ${key}: \${${varName}:?${varName} is required}`,
  );
}

export const CMP012: Rule = {
  id: 'CMP012',
  title: 'Secret in environment',
  severity: 'high',
  category: 'secrets',
  description:
    'Plaintext credentials in Compose files leak through git history and `docker inspect`.',
  fix: buildFix('db'),
  references: [
    {
      title: 'Docker Docs: How to use secrets in Docker Compose',
      url: 'https://docs.docker.com/compose/how-tos/use-secrets/',
    },
    {
      title: 'OWASP Docker Security Cheat Sheet: Do not store secrets in configuration',
      url: OWASP_DOCKER_CHEAT_SHEET,
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const entry of service.environment) {
        const hit = classify(entry);
        if (!hit) continue;
        const canAutofix = hit.replaceable && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key);

        findings.push({
          ruleId: this.id,
          title: hit.title,
          severity: hit.severity,
          service: service.name,
          line: entry.line,
          description: this.description,
          message: hit.message,
          fix: buildFix(service.name, entry.key),
          references: this.references,
          ...(canAutofix
            ? {
                autofix: {
                  label: `Use \${${entry.key}}`,
                  caution: `Set ${entry.key} in your shell or in an untracked .env file next to the Compose file.`,
                  operations: [
                    {
                      kind: 'setEnvValue' as const,
                      service: service.name,
                      envKey: entry.key,
                      value: `\${${entry.key}}`,
                    },
                  ],
                },
              }
            : {}),
        });
      }
    }

    return findings;
  },
};
