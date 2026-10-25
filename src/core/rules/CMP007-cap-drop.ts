import { ComposeModel, Finding, Rule } from '../types';
import { OWASP_DOCKER_CHEAT_SHEET, cis, fixWithYaml } from './shared';

function dropsAllCapabilities(capDropValues: string[]): boolean {
  return capDropValues.some((v) => {
    const norm = v.trim().toUpperCase();
    return norm === 'ALL' || norm === 'CAP_ALL';
  });
}

function buildFix(serviceName: string): string {
  return fixWithYaml(
    'Drop all default capabilities, then add back only what the service needs:',
    `
services:
  ${serviceName}:
    cap_drop:
      - ALL`,
  );
}

export const CMP007: Rule = {
  id: 'CMP007',
  title: 'Capabilities not dropped',
  severity: 'low',
  category: 'privileges',
  description:
    'Dropping `ALL` default Linux capabilities reduces the kernel attack surface.',
  fix: buildFix('app'),
  references: [
    cis('5.4', 'Ensure that Linux kernel capabilities are restricted within containers'),
    {
      title: 'OWASP Docker Security Cheat Sheet: Rule 3, Limit capabilities',
      url: OWASP_DOCKER_CHEAT_SHEET,
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      // Privileged containers get every capability anyway (CMP001 covers that)
      if (service.privileged === true) continue;
      const dropped = service.capDrop.map((c) => c.value);
      if (!dropsAllCapabilities(dropped)) {
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity: this.severity,
          service: service.name,
          line: service.capDropLine ?? service.line,
          description: this.description,
          message: 'Does not set `cap_drop: [ALL]`.',
          fix: buildFix(service.name),
          references: this.references,
          autofix: {
            label: 'Add cap_drop: ALL',
            caution: 'Some images need a few capabilities back (often CHOWN, SETUID, SETGID) through cap_add.',
            operations: [
              { kind: 'addListItem', service: service.name, key: 'cap_drop', item: 'ALL', compare: 'capability' },
            ],
          },
        });
      }
    }

    return findings;
  },
};
