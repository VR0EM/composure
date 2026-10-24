import { RuleReference } from '../types';

const CIS_URL = 'https://www.cisecurity.org/benchmark/docker';

/**
 * Reference to a CIS Docker Benchmark v1.6.0 recommendation.
 * Control numbers match the docker-bench-security implementation of v1.6.0.
 */
export function cis(control: string, title: string): RuleReference {
  return { title: `CIS Docker Benchmark v1.6.0, ${control}: ${title}`, url: CIS_URL };
}

export const OWASP_DOCKER_CHEAT_SHEET =
  'https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html';

/** Render a fix explanation with a YAML example block. */
export function fixWithYaml(text: string, yaml: string): string {
  return `${text}\n\`\`\`yaml\n${yaml.replace(/^\n+|\n+$/g, '')}\n\`\`\``;
}

/** True for `${VAR}`, `${VAR:-x}` and `$VAR` style values. */
export function isInterpolated(value: string): boolean {
  return value.includes('${') || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim());
}

/** Quote a value for use inside a YAML example when it needs it. */
export function yamlQuote(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) && !/^(true|false|yes|no|on|off|null|~)$/i.test(value)
    ? value
    : JSON.stringify(value);
}
