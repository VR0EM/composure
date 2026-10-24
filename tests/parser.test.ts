import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseCompose,
  parseShortPort,
  parseShortVolume,
  splitColonOutsideInterpolation,
} from '../src/core';

function readFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

describe('splitColonOutsideInterpolation', () => {
  it('splits normal colon-delimited strings', () => {
    expect(splitColonOutsideInterpolation('127.0.0.1:8080:80')).toEqual([
      '127.0.0.1',
      '8080',
      '80',
    ]);
  });

  it('preserves colons inside ${VAR:-default} interpolations and IPv6 brackets', () => {
    expect(
      splitColonOutsideInterpolation('${HOST_IP:-127.0.0.1}:${PORT:-8080}:80'),
    ).toEqual(['${HOST_IP:-127.0.0.1}', '${PORT:-8080}', '80']);

    expect(splitColonOutsideInterpolation('[::1]:8080:80')).toEqual([
      '[::1]',
      '8080',
      '80',
    ]);
  });
});

describe('Short syntax helpers', () => {
  it('parses ports with and without host IP, ranges, and protocols', () => {
    const p1 = parseShortPort('8080:80', { line: 10 });
    expect(p1.hostIp).toBeUndefined();
    expect(p1).toMatchObject({
      published: '8080',
      target: '80',
      protocol: 'tcp',
      line: 10,
      syntax: 'short',
    });

    const p2 = parseShortPort('127.0.0.1:8080:80', { line: 11 });
    expect(p2).toMatchObject({
      hostIp: '127.0.0.1',
      published: '8080',
      target: '80',
      protocol: 'tcp',
      line: 11,
    });

    const p3 = parseShortPort('8000-8005:8000-8005/udp', { line: 12 });
    expect(p3.hostIp).toBeUndefined();
    expect(p3).toMatchObject({
      published: '8000-8005',
      target: '8000-8005',
      protocol: 'udp',
      line: 12,
    });
  });

  it('distinguishes named volumes, bind mounts, and anonymous volumes with ro/rw flags', () => {
    const declared = new Set(['app_cache']);

    const bind = parseShortVolume('./html:/usr/share/nginx/html:ro', { line: 5 }, declared);
    expect(bind).toMatchObject({
      type: 'bind',
      source: './html',
      target: '/usr/share/nginx/html',
      readOnly: true,
      line: 5,
    });

    const named = parseShortVolume('app_cache:/var/cache/nginx', { line: 6 }, declared);
    expect(named).toMatchObject({
      type: 'volume',
      source: 'app_cache',
      target: '/var/cache/nginx',
      readOnly: false,
      line: 6,
    });

    const anon = parseShortVolume('/var/log/nginx', { line: 7 }, declared);
    expect(anon.source).toBeUndefined();
    expect(anon).toMatchObject({
      type: 'volume',
      target: '/var/log/nginx',
      readOnly: false,
      line: 7,
    });
  });
});

describe('Fixture: short-syntax.yml', () => {
  it('normalizes short syntax for ports, expose, volumes, tmpfs, environment, depends_on, and implicit default network', () => {
    const result = parseCompose(readFixture('short-syntax.yml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { model } = result;
    expect(model.name).toBe('short-syntax-demo');
    expect(Object.keys(model.services)).toEqual(['web', 'api', 'redis']);

    const web = model.services['web']!;
    expect(web.image).toBe('nginx:1.27-alpine');
    expect(web.line).toBe(4);
    expect(web.imageLine).toBe(5);

    // Ports
    expect(web.ports).toHaveLength(5);
    expect(web.ports[0]).toMatchObject({
      published: '8080',
      target: '80',
      protocol: 'tcp',
      line: 7,
    });
    expect(web.ports[0]?.hostIp).toBeUndefined();
    expect(web.ports[1]).toMatchObject({
      hostIp: '127.0.0.1',
      published: '8443',
      target: '443',
      protocol: 'tcp',
      line: 8,
    });
    expect(web.ports[2]).toMatchObject({
      hostIp: '::1',
      published: '9090',
      target: '9090',
      protocol: 'tcp',
      line: 9,
    });
    expect(web.ports[3]).toMatchObject({
      published: '8000-8005',
      target: '8000-8005',
      protocol: 'udp',
      line: 10,
    });
    expect(web.ports[4]?.published).toBeUndefined();
    expect(web.ports[4]).toMatchObject({
      target: '3000',
      protocol: 'tcp',
      line: 11,
    });

    // Expose (internal only)
    expect(web.expose).toEqual([
      { port: '8081', protocol: 'tcp', line: 13, column: 9, endLine: 13 },
      { port: '9000', protocol: 'udp', line: 14, column: 9, endLine: 14 },
    ]);

    // Volumes + tmpfs
    expect(web.volumes).toHaveLength(5);
    expect(web.volumes[0]).toMatchObject({
      type: 'bind',
      source: './html',
      target: '/usr/share/nginx/html',
      readOnly: true,
      syntax: 'short',
      line: 16,
    });
    expect(web.volumes[1]).toMatchObject({
      type: 'volume',
      source: 'app_cache',
      target: '/var/cache/nginx',
      readOnly: false,
      syntax: 'short',
      line: 17,
    });
    expect(web.volumes[2]?.source).toBeUndefined();
    expect(web.volumes[2]).toMatchObject({
      type: 'volume',
      target: '/var/log/nginx',
      readOnly: false,
      syntax: 'short',
      line: 18,
    });
    expect(web.volumes[3]).toMatchObject({
      type: 'tmpfs',
      target: '/run',
      readOnly: false,
      syntax: 'tmpfs',
      line: 20,
    });
    expect(web.volumes[4]).toMatchObject({
      type: 'tmpfs',
      target: '/tmp',
      readOnly: true,
      syntax: 'tmpfs',
      line: 21,
    });

    // Environment (list syntax)
    expect(web.environment).toEqual([
      {
        key: 'NODE_ENV',
        value: 'production',
        syntax: 'list',
        line: 23,
        column: 9,
        endLine: 23,
      },
      {
        key: 'EMPTY_VAL',
        value: '',
        syntax: 'list',
        line: 24,
        column: 9,
        endLine: 24,
      },
      {
        key: 'PASSTHROUGH_ONLY',
        value: null,
        syntax: 'list',
        line: 25,
        column: 9,
        endLine: 25,
      },
    ]);

    // Depends on (short syntax)
    expect(web.dependsOn).toMatchObject([
      { target: 'api', condition: 'service_started', syntax: 'short', line: 27 },
      { target: 'redis', condition: 'service_started', syntax: 'short', line: 28 },
    ]);

    // Implicit "default" network for `web` (which has no `networks` key), while `api` uses `backend`
    expect(web.networks).toEqual([
      { name: 'default', implicit: true, syntax: 'implicit', line: 4 },
    ]);
    expect(model.networks['default']).toMatchObject({
      name: 'default',
      implicit: true,
    });
    expect(model.networks['backend']).toMatchObject({
      name: 'backend',
      implicit: false,
    });
    expect(model.services['api']?.networks).toMatchObject([
      { name: 'backend', syntax: 'short' },
    ]);
  });
});

describe('Fixture: long-syntax.yml', () => {
  it('normalizes long syntax for ports, volumes, networks, environment, depends_on, profiles, healthcheck, and resources', () => {
    const result = parseCompose(readFixture('long-syntax.yml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { model } = result;
    expect(model.version).toBe('3.9');

    const gw = model.services['gateway']!;
    expect(gw.build).toMatchObject({
      context: './gateway',
      dockerfile: 'Dockerfile.prod',
    });
    expect(gw.profiles).toEqual(['edge', 'debug']);

    expect(gw.ports).toHaveLength(2);
    expect(gw.ports[0]).toMatchObject({
      hostIp: '127.0.0.1',
      published: '80',
      target: '8080',
      protocol: 'tcp',
      mode: 'host',
      syntax: 'long',
    });
    expect(gw.ports[1]).toMatchObject({
      published: '5353',
      target: '5353',
      protocol: 'udp',
      syntax: 'long',
    });

    expect(gw.volumes).toHaveLength(3);
    expect(gw.volumes[0]).toMatchObject({
      type: 'bind',
      source: './certs',
      target: '/etc/certs',
      readOnly: true,
      syntax: 'long',
    });
    expect(gw.volumes[1]).toMatchObject({
      type: 'volume',
      source: 'gateway_state',
      target: '/var/lib/gateway',
      readOnly: false,
      syntax: 'long',
    });
    expect(gw.volumes[2]).toMatchObject({
      type: 'tmpfs',
      target: '/run/gateway',
      readOnly: false,
      syntax: 'long',
    });

    expect(gw.networks).toMatchObject([
      {
        name: 'dmz',
        aliases: ['ingress.local'],
        ipv4Address: '172.20.0.10',
        syntax: 'long',
      },
    ]);

    expect(gw.environment).toMatchObject([
      { key: 'LOG_LEVEL', value: 'info', syntax: 'map' },
      { key: 'WORKERS', value: '4', syntax: 'map' },
      { key: 'FEATURE_X', value: 'true', syntax: 'map' },
      { key: 'OPTIONAL_KEY', value: null, syntax: 'map' },
    ]);

    expect(gw.dependsOn).toMatchObject([
      {
        target: 'auth',
        condition: 'service_healthy',
        restart: true,
        required: true,
        syntax: 'long',
      },
    ]);

    expect(gw.healthcheck).toMatchObject({
      test: ['CMD', 'curl', '-f', 'http://localhost:8080/health'],
      interval: '30s',
      timeout: '5s',
      retries: 3,
    });

    expect(gw.resourceLimits).toMatchObject({
      memory: '512M',
      cpus: '0.50',
    });

    // No service used the implicit default network, so only `dmz` is in model.networks
    expect(Object.keys(model.networks)).toEqual(['dmz']);
    expect(model.networks['dmz']).toMatchObject({
      name: 'dmz',
      driver: 'bridge',
      internal: true,
      implicit: false,
    });
    expect(model.volumes['gateway_state']).toMatchObject({
      name: 'gateway_state',
      driver: 'local',
      external: true,
      implicit: false,
    });
  });
});

describe('Fixture: anchors-and-interpolation.yml', () => {
  it('resolves YAML anchors, aliases, and merge keys (<<), ignores x- extensions, and preserves ${VAR:-default} as-is', () => {
    const result = parseCompose(readFixture('anchors-and-interpolation.yml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { model } = result;
    expect(Object.keys(model.services)).toEqual(['worker']);

    const worker = model.services['worker']!;
    // Earlier anchor in `<<: [*base-service, *resource-defaults]` wins for `user`
    expect(worker.user).toBe('1000:1000');
    expect(worker.readOnly).toBe(true);
    expect(worker.securityOpt).toMatchObject([
      { value: 'no-new-privileges:true' },
    ]);
    expect(worker.resourceLimits).toMatchObject({
      memory: '256m',
      cpus: '0.25',
    });

    // Variable interpolations kept verbatim
    expect(worker.image).toBe('ghcr.io/org/worker:${APP_TAG:-1.4.2}');
    expect(worker.ports[0]).toMatchObject({
      hostIp: '${BIND_IP:-127.0.0.1}',
      published: '${HOST_PORT:-9000}',
      target: '9000',
    });
    expect(worker.volumes[0]).toMatchObject({
      type: 'bind',
      source: '${DATA_DIR:-./data}',
      target: '/data',
      readOnly: true,
    });

    // Environment merged from *common-env plus explicit key
    expect(worker.environment).toMatchObject([
      { key: 'TZ', value: '${TZ:-UTC}', syntax: 'map' },
      { key: 'LOG_FORMAT', value: 'json', syntax: 'map' },
      {
        key: 'DATABASE_URL',
        value: 'postgres://${DB_USER:-app}:${DB_PASS}@db:5432/app',
        syntax: 'map',
      },
    ]);
  });
});

describe('Fixture: network-modes-and-security.yml', () => {
  it('handles network_mode values without adding implicit default network and extracts security attributes with lines', () => {
    const result = parseCompose(readFixture('network-modes-and-security.yml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { model } = result;
    const hostMon = model.services['host-monitor']!;
    expect(hostMon.networkMode).toBe('host');
    expect(hostMon.networks).toHaveLength(0);
    expect(hostMon.pid).toBe('host');
    expect(hostMon.ipc).toBe('host');
    expect(hostMon.usernsMode).toBe('host');
    expect(hostMon.privileged).toBe(true);
    expect(hostMon.privilegedLine).toBe(8);
    expect(hostMon.capAdd.map((c) => c.value)).toEqual(['SYS_ADMIN', 'NET_ADMIN']);
    expect(hostMon.capDrop.map((c) => c.value)).toEqual(['ALL']);
    expect(hostMon.securityOpt.map((s) => s.value)).toEqual([
      'seccomp:unconfined',
      'apparmor:unconfined',
    ]);
    expect(hostMon.devices[0]).toMatchObject({
      source: '/dev/ttyUSB0',
      target: '/dev/ttyUSB0',
      permissions: 'rwm',
    });
    expect(hostMon.volumes[0]).toMatchObject({
      type: 'bind',
      source: '/var/run/docker.sock',
      target: '/var/run/docker.sock',
      readOnly: true,
    });

    expect(model.services['isolated-job']?.networkMode).toBe('none');
    expect(model.services['isolated-job']?.networks).toHaveLength(0);
    expect(model.services['sidecar']?.networkMode).toBe('service:host-monitor');
    expect(model.services['ext-attached']?.networkMode).toBe(
      'container:external-proxy',
    );
    expect(model.networks['default']).toBeUndefined();
  });
});

describe('Error handling for invalid YAML and non-Compose documents', () => {
  it('returns line-numbered errors for invalid YAML syntax', () => {
    const result = parseCompose(readFixture('invalid-syntax.yml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.line).toBeGreaterThanOrEqual(5);
  });

  it('returns clear error for valid YAML that is not a Docker Compose file', () => {
    const result = parseCompose(readFixture('not-a-compose.yml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors[0]?.message).toContain('services');
    expect(result.errors[0]?.line).toBe(1);
  });

  it('returns clear error for empty input or scalar root', () => {
    const emptyRes = parseCompose('   \n  ');
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) {
      expect(emptyRes.errors[0]?.line).toBe(1);
    }

    const scalarRes = parseCompose('just a string');
    expect(scalarRes.ok).toBe(false);
    if (!scalarRes.ok) {
      expect(scalarRes.errors[0]?.line).toBe(1);
    }
  });
});
