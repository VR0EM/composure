import { ComposeModel, Finding, PortMapping, Rule, Severity } from '../types';
import { cis, fixWithYaml } from './shared';

/** Ports whose services should never face the internet directly. */
const SENSITIVE_PORTS: Record<number, { label: string; severity: Severity }> = {
  2375: { label: 'unencrypted Docker daemon API', severity: 'critical' },
  2376: { label: 'Docker daemon API', severity: 'high' },
  2379: { label: 'etcd', severity: 'high' },
  5432: { label: 'PostgreSQL', severity: 'high' },
  3306: { label: 'MySQL / MariaDB', severity: 'high' },
  1433: { label: 'Microsoft SQL Server', severity: 'high' },
  1521: { label: 'Oracle Database', severity: 'high' },
  27017: { label: 'MongoDB', severity: 'high' },
  6379: { label: 'Redis', severity: 'high' },
  11211: { label: 'Memcached', severity: 'high' },
  9200: { label: 'Elasticsearch / OpenSearch', severity: 'high' },
  5984: { label: 'CouchDB', severity: 'high' },
  9042: { label: 'Cassandra', severity: 'high' },
  8086: { label: 'InfluxDB', severity: 'high' },
  5672: { label: 'RabbitMQ (AMQP)', severity: 'high' },
  9092: { label: 'Kafka', severity: 'high' },
  2181: { label: 'ZooKeeper', severity: 'high' },
  8500: { label: 'Consul', severity: 'high' },
};

function isBoundToAllInterfaces(hostIp?: string): boolean {
  if (!hostIp) return true;
  const trimmed = hostIp.trim().replace(/^\[|\]$/g, '');
  return (
    trimmed === '' ||
    trimmed === '0.0.0.0' ||
    trimmed === '::' ||
    trimmed === '*' ||
    /:-(0\.0\.0\.0|::)?\}$/.test(trimmed)
  );
}

function matchSensitivePort(portSpec?: string): { port: number; label: string; severity: Severity } | null {
  if (!portSpec) return null;
  const trimmed = portSpec.trim();
  const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(trimmed);
  if (!rangeMatch) return null;
  const start = Number(rangeMatch[1]);
  const end = rangeMatch[2] !== undefined ? Number(rangeMatch[2]) : start;
  for (const [portStr, info] of Object.entries(SENSITIVE_PORTS)) {
    const p = Number(portStr);
    if (p >= start && p <= end) return { port: p, ...info };
  }
  return null;
}

function loopbackSpec(port: PortMapping): string {
  const proto = port.protocol !== 'tcp' ? `/${port.protocol}` : '';
  return `127.0.0.1:${port.published ?? ''}:${port.target}${proto}`;
}

function buildFix(serviceName: string, port?: PortMapping): string {
  const spec = port ? loopbackSpec(port) : '127.0.0.1:8080:80';
  return fixWithYaml(
    'Bind the port to `127.0.0.1` (and put a reverse proxy in front), or drop `ports` and keep the traffic on an internal Docker network:',
    `
services:
  ${serviceName}:
    ports:
      - "${spec}"`,
  );
}

export const CMP004: Rule = {
  id: 'CMP004',
  title: 'Port bound to 0.0.0.0',
  severity: 'medium',
  description:
    'Published ports listen on every interface, and Docker\'s iptables rules bypass host firewalls such as `ufw`.',
  fix: buildFix('app'),
  references: [
    cis('5.14', 'Ensure that incoming container traffic is bound to a specific host interface'),
    {
      title: 'Docker Docs: Packet filtering and firewalls',
      url: 'https://docs.docker.com/engine/network/packet-filtering-firewalls/',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      // With host networking, `ports` is ignored (CMP005 covers host networking)
      if (service.networkMode?.trim() === 'host') continue;

      service.ports.forEach((port, index) => {
        if (!isBoundToAllInterfaces(port.hostIp)) return;

        const hostPort = port.published ?? 'a random host port';
        const sensitive = matchSensitivePort(port.target) ?? matchSensitivePort(port.published);
        const autofix = {
          label: 'Bind to 127.0.0.1',
          operations: [
            { kind: 'bindPortHostIp' as const, service: service.name, index, hostIp: '127.0.0.1' },
          ],
        };

        if (sensitive) {
          findings.push({
            ruleId: this.id,
            title: sensitive.severity === 'critical' ? 'Docker API published' : 'DB port on 0.0.0.0',
            severity: sensitive.severity,
            service: service.name,
            line: port.line,
            description: this.description,
            message: `Publishes the ${sensitive.label} port (\`${port.raw}\`) on all interfaces.`,
            fix: buildFix(service.name, port),
            references: this.references,
            autofix,
          });
        } else {
          findings.push({
            ruleId: this.id,
            title: this.title,
            severity: 'medium',
            service: service.name,
            line: port.line,
            description: this.description,
            message:
              port.published === undefined
                ? `Publishes container port \`${port.target}\` on ${hostPort} on all interfaces.`
                : `Publishes port \`${port.raw}\` on all interfaces.`,
            fix: buildFix(service.name, port),
            references: this.references,
            autofix,
          });
        }
      });
    }

    return findings;
  },
};
