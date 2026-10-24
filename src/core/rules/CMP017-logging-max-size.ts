import { ComposeModel, Finding, Rule } from '../types';
import { fixWithYaml } from './shared';

/**
 * Only the default `json-file` driver keeps logs on the host without rotation.
 * `local` rotates by default, and remote drivers (journald, syslog, fluentd,
 * gelf, awslogs, ...) ship logs elsewhere, so `max-size` does not apply.
 */
function needsRotation(driver: string | undefined): boolean {
  if (driver === undefined) return true;
  const d = driver.trim().toLowerCase();
  return d === '' || d === 'json-file';
}

function buildFix(serviceName: string): string {
  return fixWithYaml(
    'Cap the `json-file` log size and number of rotated files (or switch to the `local` driver, which rotates by default):',
    `
services:
  ${serviceName}:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"`,
  );
}

export const CMP017: Rule = {
  id: 'CMP017',
  title: 'Uncapped container logging',
  severity: 'low',
  description:
    'The default `json-file` log driver never rotates, so a chatty container can fill the host disk.',
  fix: buildFix('app'),
  references: [
    {
      title: 'Docker Docs: JSON File logging driver (max-size, max-file)',
      url: 'https://docs.docker.com/engine/logging/drivers/json-file/',
    },
    {
      title: 'Docker Docs: Configure logging drivers',
      url: 'https://docs.docker.com/engine/logging/configure/',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      if (!needsRotation(service.logging?.driver)) continue;

      const maxSize = service.logging?.options?.['max-size'];
      if (maxSize && maxSize.trim().length > 0) continue;

      findings.push({
        ruleId: this.id,
        title: this.title,
        severity: this.severity,
        service: service.name,
        line: service.loggingLine ?? service.line,
        description: this.description,
        message: 'No `max-size` limit for the `json-file` log driver (the default), so logs grow without bound.',
        fix: buildFix(service.name),
        references: this.references,
        autofix: {
          label: 'Cap logs at 3 × 10 MB',
          operations: [
            // Pin the driver: max-size is rejected if the daemon default is e.g. journald
            ...(service.logging?.driver
              ? []
              : [
                  {
                    kind: 'setNested' as const,
                    service: service.name,
                    path: ['logging', 'driver'],
                    value: 'json-file',
                  },
                ]),
            { kind: 'setNested', service: service.name, path: ['logging', 'options', 'max-size'], value: '10m' },
            ...(service.logging?.options?.['max-file']
              ? []
              : [
                  {
                    kind: 'setNested' as const,
                    service: service.name,
                    path: ['logging', 'options', 'max-file'],
                    value: '3',
                  },
                ]),
          ],
        },
      });
    }

    return findings;
  },
};
