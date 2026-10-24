import { ComposeModel, Finding, Rule, Severity } from '../types';
import { cis, fixWithYaml } from './shared';

/** Devices that give raw access to host memory or disks. */
function classifyDevice(source: string): { severity: Severity; reason: string } {
  const path = source.trim();
  if (path === '/dev' || path === '/dev/') {
    return { severity: 'critical', reason: 'exposes every host device' };
  }
  if (/^\/dev\/(mem|kmem|port)$/.test(path)) {
    return { severity: 'high', reason: 'gives raw access to host memory' };
  }
  if (/^\/dev\/(sd[a-z]+|nvme\d+(n\d+)?(p\d+)?|vd[a-z]+|xvd[a-z]+|hd[a-z]+|mmcblk\d+(p\d+)?|dm-\d+|loop\d+|mapper\/.+|md\d+)\d*$/.test(path)) {
    return { severity: 'high', reason: 'gives raw access to a host disk' };
  }
  return { severity: 'medium', reason: 'grants direct access to host hardware' };
}

function buildFix(serviceName: string, source: string, target: string): string {
  return fixWithYaml(
    'Remove device mappings the service does not need, and restrict the rest to the minimum cgroup permissions (for example read-only `r`):',
    `
services:
  ${serviceName}:
    devices:
      - "${source}:${target}:r"`,
  );
}

export const CMP011: Rule = {
  id: 'CMP011',
  title: 'Host device mapped',
  severity: 'medium',
  category: 'isolation',
  description:
    'Grants direct container access to host hardware device nodes.',
  fix: buildFix('app', '/dev/ttyUSB0', '/dev/ttyUSB0'),
  references: [
    cis('5.18', 'Ensure that host devices are not directly exposed to containers'),
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const device of service.devices) {
        const { severity, reason } = classifyDevice(device.source);
        findings.push({
          ruleId: this.id,
          title: this.title,
          severity,
          service: service.name,
          line: device.line,
          description: this.description,
          message: `Maps host device \`${device.raw}\`, which ${reason}.`,
          fix: buildFix(service.name, device.source, device.target ?? device.source),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
