import { ComposeModel, Finding, PortMapping, Rule } from '../types';

const DB_CACHE_PORTS: Record<number, string> = {
  5432: 'PostgreSQL',
  3306: 'MySQL / MariaDB',
  27017: 'MongoDB',
  6379: 'Redis',
  9200: 'Elasticsearch / OpenSearch',
  11211: 'Memcached',
};

function isBoundToAllInterfaces(hostIp?: string): boolean {
  if (!hostIp) return true;
  const trimmed = hostIp.trim();
  if (
    trimmed === '' ||
    trimmed === '0.0.0.0' ||
    trimmed === '::' ||
    trimmed === '*' ||
    trimmed.includes(':-0.0.0.0}')
  ) {
    return true;
  }
  return false;
}

function matchSensitivePort(
  portSpec?: string,
): { port: number; serviceName: string } | null {
  if (!portSpec) return null;
  const trimmed = portSpec.trim();

  const rangeMatch = /^(\d+)-(\d+)$/.exec(trimmed);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    for (const [portStr, label] of Object.entries(DB_CACHE_PORTS)) {
      const p = Number(portStr);
      if (p >= start && p <= end) {
        return { port: p, serviceName: label };
      }
    }
    return null;
  }

  const num = Number(trimmed);
  if (!Number.isNaN(num) && DB_CACHE_PORTS[num]) {
    return { port: num, serviceName: DB_CACHE_PORTS[num]! };
  }
  return null;
}

function findDatabasePort(
  mapping: PortMapping,
): { port: number; serviceName: string } | null {
  return (
    matchSensitivePort(mapping.target) ?? matchSensitivePort(mapping.published)
  );
}

function buildFix(serviceName: string, published = '8080', target = '80', protocol = 'tcp'): string {
  const protoSuffix = protocol !== 'tcp' ? `/${protocol}` : '';
  return `Bind the port to \`127.0.0.1\` or keep traffic on an internal Docker network:
\`\`\`yaml
services:
  ${serviceName}:
    ports:
      - "127.0.0.1:${published}:${target}${protoSuffix}"
\`\`\``;
}

export const CMP004: Rule = {
  id: 'CMP004',
  title: 'Port bound to 0.0.0.0',
  severity: 'medium',
  description:
    'Binds to all network interfaces and can bypass host firewalls such as `ufw`.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 5.13: Bind incoming traffic to a specific host interface',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'Docker Docs: Packet filtering and firewalls',
      url: 'https://docs.docker.com/engine/network/packet-filtering-firewalls/',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      for (const port of service.ports) {
        if (!isBoundToAllInterfaces(port.hostIp)) {
          continue;
        }

        const pub = port.published ?? port.target;
        const dbMatch = findDatabasePort(port);
        if (dbMatch) {
          findings.push({
            ruleId: this.id,
            title: 'DB port on 0.0.0.0',
            severity: 'high',
            service: service.name,
            line: port.line,
            description: this.description,
            message: `Publishes ${dbMatch.serviceName} port \`${pub}\` on \`0.0.0.0\`.`,
            fix: buildFix(service.name, pub, port.target, port.protocol),
            references: this.references,
          });
        } else {
          findings.push({
            ruleId: this.id,
            title: this.title,
            severity: 'medium',
            service: service.name,
            line: port.line,
            description: this.description,
            message: `Publishes port \`${port.raw}\` on \`0.0.0.0\`.`,
            fix: buildFix(service.name, pub, port.target, port.protocol),
            references: this.references,
          });
        }
      }
    }

    return findings;
  },
};
