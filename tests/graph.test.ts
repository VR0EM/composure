import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Finding,
  buildComposeGraph,
  getWorstSeverity,
  parseCompose,
  portNodeTitle,
  shortenHostPath,
  splitImageReference,
} from '../src/core';

function readFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

describe('splitImageReference', () => {
  it('splits image name and tag accurately across registries, digests, and interpolations', () => {
    expect(splitImageReference('nginx:1.27-alpine')).toEqual({
      imageName: 'nginx',
      imageTag: '1.27-alpine',
    });

    expect(splitImageReference('ubuntu')).toEqual({
      imageName: 'ubuntu',
      imageTag: 'latest (implicit)',
    });

    expect(splitImageReference('registry.local:5000/org/app:v2')).toEqual({
      imageName: 'registry.local:5000/org/app',
      imageTag: 'v2',
    });

    expect(
      splitImageReference('ghcr.io/org/worker:${APP_TAG:-1.4.2}'),
    ).toEqual({
      imageName: 'ghcr.io/org/worker',
      imageTag: '${APP_TAG:-1.4.2}',
    });

    expect(
      splitImageReference(
        'nginx@sha256:abcdef0123456789abcdef0123456789',
      ),
    ).toEqual({
      imageName: 'nginx',
      imageTag: '@sha256:abcdef01…',
    });
  });
});

describe('shortenHostPath', () => {
  it('keeps normal paths whole so the location stays unambiguous', () => {
    expect(shortenHostPath('/var/run/docker.sock')).toBe('/var/run/docker.sock');
    expect(shortenHostPath('/etc')).toBe('/etc');
    expect(shortenHostPath('./nginx.conf')).toBe('./nginx.conf');
    expect(shortenHostPath('/')).toBe('/');
  });

  it('shortens long paths in the middle, keeping the root and the file name', () => {
    const long = '/srv/data/applications/production/config/nginx/conf.d/site.conf';
    const short = shortenHostPath(long);
    expect(short.length).toBeLessThanOrEqual(34);
    expect(short.startsWith('/srv/…/')).toBe(true);
    expect(short.endsWith('/site.conf')).toBe(true);
    expect(shortenHostPath('/a/' + 'x'.repeat(60)).length).toBe(34);
  });
});

describe('buildComposeGraph', () => {
  it('creates service, network, volume, bindMount, and hostPort nodes and labeled edges', () => {
    const parsed = parseCompose(readFixture('short-syntax.yml'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const graph = buildComposeGraph(parsed.model);

    // Check node kinds
    const serviceNodes = graph.nodes.filter((n) => n.kind === 'service');
    const portNodes = graph.nodes.filter((n) => n.kind === 'hostPort');
    const netNodes = graph.nodes.filter((n) => n.kind === 'network');
    const volNodes = graph.nodes.filter((n) => n.kind === 'volume');
    const bindNodes = graph.nodes.filter((n) => n.kind === 'bindMount');

    expect(serviceNodes.map((n) => n.id)).toEqual([
      'service:web',
      'service:api',
      'service:redis',
    ]);
    expect(portNodes).toHaveLength(5);
    expect(netNodes.map((n) => n.id).sort()).toEqual([
      'network:backend',
      'network:default',
    ]);
    expect(volNodes.map((n) => n.id)).toContain('volume:app_cache');
    expect(bindNodes.map((n) => n.id)).toEqual(['bind:./html']);

    // Check edges
    const depEdges = graph.edges.filter((e) => e.kind === 'dependsOn');
    expect(depEdges).toHaveLength(2);
    expect(depEdges[0]).toMatchObject({
      source: 'service:web',
      target: 'service:api',
      label: 'depends_on',
      dashed: true,
    });

    const volEdges = graph.edges.filter((e) => e.kind === 'volume');
    const bindEdge = volEdges.find((e) => e.target === 'bind:./html');
    expect(bindEdge).toMatchObject({
      source: 'service:web',
      target: 'bind:./html',
      label: 'ro',
      readOnly: true,
    });

    const namedVolEdge = volEdges.find((e) => e.target === 'volume:app_cache');
    expect(namedVolEdge).toMatchObject({
      source: 'service:web',
      target: 'volume:app_cache',
      label: 'rw',
      readOnly: false,
    });

    const portEdges = graph.edges.filter((e) => e.kind === 'port');
    expect(portEdges[0]).toMatchObject({
      source: 'port:web:0',
      target: 'service:web',
      label: ':80',
    });
    expect(portEdges[3]).toMatchObject({
      source: 'port:web:3',
      target: 'service:web',
      label: ':8000-8005/udp',
    });
  });

  it('colors service nodes by their worst finding severity', () => {
    const parsed = parseCompose(readFixture('short-syntax.yml'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const mockFindings: Finding[] = [
      {
        ruleId: 'CMP001',
        title: 'Low issue',
        severity: 'low',
        service: 'web',
        line: 4,
        description: 'desc',
        message: 'msg',
        fix: 'fix',
        references: [],
      },
      {
        ruleId: 'CMP002',
        title: 'Critical issue',
        severity: 'critical',
        service: 'web',
        line: 5,
        description: 'desc',
        message: 'msg',
        fix: 'fix',
        references: [],
      },
    ];

    expect(getWorstSeverity(mockFindings)).toBe('critical');
    const graph = buildComposeGraph(parsed.model, mockFindings);
    const webNode = graph.nodes.find((n) => n.id === 'service:web');
    const apiNode = graph.nodes.find((n) => n.id === 'service:api');
    expect(webNode?.data.kind).toBe('service');
    if (webNode?.data.kind === 'service') {
      expect(webNode.data.worstSeverity).toBe('critical');
      expect(webNode.data.findingsCount).toBe(2);
      // Size follows the text, not the number of findings
      expect(webNode.height).toBe(apiNode?.height);
    }
  });
});

describe('node sizing and edge details', () => {
  it('sizes each column to its longest text so names are not cut off', () => {
    const parsed = parseCompose(`services:
  a:
    image: ghcr.io/some-organisation/a-rather-long-image-name:1.2.3
    ports: ["127.0.0.1:18080:80", "53:53/udp"]
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro", "data:/data"]
  b:
    image: nginx:1.27
volumes:
  data: {}
`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const graph = buildComposeGraph(parsed.model);
    const [a, b] = graph.nodes.filter((n) => n.kind === 'service');
    expect(a!.width).toBe(288); // long image: capped at the maximum width
    expect(b!.width).toBe(168); // short name and image: minimum width
    const sock = graph.nodes.find((n) => n.id === 'bind:/var/run/docker.sock');
    expect(sock!.width).toBeGreaterThanOrEqual('/var/run/docker.sock'.length * 7.2 + 24);

    const port = graph.nodes.find((n) => n.id === 'port:a:1');
    expect(port?.data.kind === 'hostPort' && portNodeTitle(port.data)).toBe('0.0.0.0:53 → 53/udp');
  });

  it('explains every connection in plain language', () => {
    const parsed = parseCompose(readFixture('short-syntax.yml'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const graph = buildComposeGraph(parsed.model);
    for (const edge of graph.edges) {
      expect(edge.detail.title.length).toBeGreaterThan(0);
      expect(edge.detail.text.length).toBeGreaterThan(0);
    }
    const bind = graph.edges.find((e) => e.target === 'bind:./html');
    expect(bind?.detail.text).toContain('read-only');
  });
});
