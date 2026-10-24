import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

function buildFix(serviceName: string): string {
  return fixWithYaml(
    'Cap the number of processes (and threads) the container can create. Size it generously for thread-heavy runtimes such as the JVM:',
    `
services:
  ${serviceName}:
    deploy:
      resources:
        limits:
          pids: 200`,
  );
}

export const CMP020: Rule = {
  id: 'CMP020',
  title: 'No PIDs limit',
  severity: 'info',
  description:
    'Without a PIDs limit, a fork bomb or thread leak in one container can exhaust the process table of the whole host.',
  fix: buildFix('app'),
  references: [
    cis('5.29', 'Ensure that the PIDs cgroup limit is used'),
    {
      title: 'Docker Compose Specification: pids_limit',
      url: 'https://docs.docker.com/reference/compose-file/services/#pids_limit',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];
    for (const service of Object.values(model.services)) {
      const limit = service.pidsLimit?.trim();
      // 0 and -1 mean "unlimited"
      if (limit && limit !== '0' && limit !== '-1') continue;
      findings.push({
        ruleId: this.id,
        title: this.title,
        severity: this.severity,
        service: service.name,
        line: service.pidsLimitLine ?? service.line,
        description: this.description,
        message: limit ? `\`pids_limit: ${limit}\` means unlimited.` : 'No `pids_limit` is set.',
        fix: buildFix(service.name),
        references: this.references,
      });
    }
    return findings;
  },
};
