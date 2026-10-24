import { ComposeModel, Finding, Rule } from '../types';
import { cis } from './shared';

function hasActiveHealthcheck(
  healthcheck: ComposeModel['services'][string]['healthcheck'],
): boolean {
  if (!healthcheck) return false;
  if (healthcheck.disable === true) return false;
  if (!healthcheck.test) return false;
  if (Array.isArray(healthcheck.test)) {
    if (healthcheck.test.length === 0) return false;
    if (healthcheck.test[0]?.toUpperCase() === 'NONE') return false;
  } else if (healthcheck.test.trim().toUpperCase() === 'NONE') {
    return false;
  }
  return true;
}

function buildFix(serviceName: string): string {
  return `Configure a \`healthcheck\` command for the service:
\`\`\`yaml
services:
  ${serviceName}:
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:80/health"]
      interval: 30s
      timeout: 5s
      retries: 3
\`\`\``;
}

export const CMP015: Rule = {
  id: 'CMP015',
  title: 'Healthcheck not set',
  severity: 'low',
  category: 'reliability',
  description:
    'Docker cannot detect hung processes or wait for readiness on startup. (If the image defines a HEALTHCHECK, this is already covered.)',
  fix: buildFix('api'),
  references: [
    cis('5.27', 'Ensure that container health is checked at runtime'),
    {
      title: 'Docker Compose Specification: healthcheck',
      url: 'https://docs.docker.com/reference/compose-file/services/#healthcheck',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      if (!hasActiveHealthcheck(service.healthcheck)) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.healthcheck?.line ?? service.line,
          description: this.description,
          message: 'No active `healthcheck` is defined.',
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
