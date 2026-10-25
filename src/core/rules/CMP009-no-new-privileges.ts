import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';
import { normalizeSecurityOpt } from './CMP008-security-opt-unconfined';

function hasNoNewPrivileges(securityOptValues: string[]): boolean {
  return securityOptValues.some((raw) => {
    const normalized = normalizeSecurityOpt(raw);
    return normalized === 'no-new-privileges:true' || normalized === 'no-new-privileges';
  });
}

function buildFix(serviceName: string): string {
  return fixWithYaml(
    'Enable `no-new-privileges:true` under `security_opt`:',
    `
services:
  ${serviceName}:
    security_opt:
      - no-new-privileges:true`,
  );
}

export const CMP009: Rule = {
  id: 'CMP009',
  title: 'No no-new-privileges',
  severity: 'medium',
  category: 'privileges',
  description:
    'Processes can gain extra privileges via setuid or setgid binaries.',
  fix: buildFix('app'),
  references: [
    cis('5.26', 'Ensure that the container is restricted from acquiring additional privileges'),
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      const opts = service.securityOpt.map((s) => s.value);
      if (!hasNoNewPrivileges(opts)) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.securityOptLine ?? service.line,
          description: this.description,
          message: 'Missing `no-new-privileges:true` in `security_opt`.',
          fix: buildFix(service.name),
          references: this.references,
          autofix: {
            label: 'Add no-new-privileges:true',
            caution: 'setuid tools such as sudo stop working inside the container.',
            operations: [
              {
                kind: 'addListItem',
                service: service.name,
                key: 'security_opt',
                item: 'no-new-privileges:true',
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
