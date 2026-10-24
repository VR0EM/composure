import { ComposeModel, Finding, Rule } from '../types';

function isExplicitRootUser(user: string): boolean {
  const normalized = user.trim().toLowerCase();
  return (
    normalized === '0' ||
    normalized === 'root' ||
    normalized.startsWith('0:') ||
    normalized.startsWith('root:')
  );
}

function buildFix(serviceName: string): string {
  return `Specify a non-root \`user\` (UID:GID):
\`\`\`yaml
services:
  ${serviceName}:
    user: "1000:1000"
\`\`\``;
}

export const CMP013: Rule = {
  id: 'CMP013',
  title: 'User not set',
  severity: 'info',
  description:
    'Without a non-root UID, the container defaults to the image user (often `root`).',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 4.1: Ensure a user for the container has been created',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'OWASP Docker Security Cheat Sheet: Rule 2, Set a user',
      url: 'https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      if (!service.user) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: 'info',
          service: service.name,
          line: service.line,
          description: this.description,
          message: 'No `user` field is specified.',
          fix: buildFix(service.name),
          references: this.references,
        });
      } else if (isExplicitRootUser(service.user)) {
        findings.push({
          ruleId: this.id,
          title: 'Container runs as root',
          severity: 'medium',
          service: service.name,
          line: service.userLine ?? service.line,
          description: this.description,
          message: `Explicitly runs as \`${service.user}\`.`,
          fix: buildFix(service.name),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
