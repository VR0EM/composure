import { describe, expect, it } from 'vitest';
import { ComposeDiagnostic, parseCompose, suggestKey } from '../src/core';

function diagnose(yaml: string): ComposeDiagnostic[] {
  const parsed = parseCompose(yaml);
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('; '));
  return parsed.diagnostics;
}

function codes(yaml: string): string[] {
  return diagnose(yaml).map((d) => d.code);
}

describe('Compose validation', () => {
  it('reports nothing for a correct file', () => {
    const yaml = [
      'name: shop',
      'services:',
      '  web:',
      '    image: nginx:1.27',
      '    ports: ["127.0.0.1:8080:80"]',
      '    networks: [front]',
      '    depends_on:',
      '      api:',
      '        condition: service_healthy',
      '  api:',
      '    build: ./api',
      '    networks: [front, back]',
      '    volumes: [data:/data]',
      '    secrets: [db_password]',
      '    healthcheck:',
      '      test: ["CMD", "true"]',
      'networks:',
      '  front:',
      '  back:',
      '    internal: true',
      'volumes:',
      '  data:',
      'secrets:',
      '  db_password:',
      '    file: ./db_password.txt',
      '',
    ].join('\n');
    expect(diagnose(yaml)).toEqual([]);
  });

  it('flags typos in keys with a suggestion', () => {
    const diags = diagnose('services:\n  web:\n    imge: nginx\n    enviroment: {}\n    port: ["80"]\n');
    const unknown = diags.filter((d) => d.code === 'unknown-key');
    expect(unknown.map((d) => d.message)).toEqual([
      'Unknown service key `imge`. Did you mean `image`?',
      'Unknown service key `enviroment`. Did you mean `environment`?',
      'Unknown service key `port`. Did you mean `ports`?',
    ]);
    expect(unknown[0]).toMatchObject({ line: 3, column: 5, service: 'web', severity: 'warning' });
    // Without image or build, the service cannot be created at all
    expect(diags.some((d) => d.code === 'missing-image')).toBe(true);
  });

  it('flags typos in nested blocks and invalid depends_on conditions', () => {
    const diags = diagnose(
      'services:\n  web:\n    image: x:1\n    healthcheck:\n      tset: ["CMD", "true"]\n    depends_on:\n      db:\n        condition: service_healty\n  db:\n    image: y:1\n',
    );
    expect(diags.map((d) => d.message)).toEqual([
      'Unknown healthcheck key `tset`. Did you mean `test`?',
      'Invalid depends_on condition `service_healty`. Did you mean `service_healthy`? Valid values: service_started, service_healthy, service_completed_successfully.',
    ]);
  });

  it('ignores x- extension keys and merge keys', () => {
    const yaml = 'x-defaults: &d\n  restart: always\nservices:\n  web:\n    <<: *d\n    image: x:1\n    x-note: hi\n';
    expect(codes(yaml)).toEqual([]);
  });

  it('flags duplicate keys, which Compose refuses', () => {
    const diags = diagnose('services:\n  web:\n    image: a:1\n    image: b:1\n');
    expect(diags[0]).toMatchObject({ code: 'duplicate-key', severity: 'error', line: 4 });
  });

  it('flags undefined services, networks, volumes, secrets and configs', () => {
    const yaml = [
      'services:',
      '  web:',
      '    image: x:1',
      '    depends_on: [dbb]',
      '    networks: [nope]',
      '    volumes: [data:/data, ./local:/local, "${DATA}:/data2"]',
      '    secrets: [missing]',
      '    configs: [cfg]',
      '',
    ].join('\n');
    expect(codes(yaml)).toEqual([
      'undefined-service',
      'undefined-network',
      'undefined-volume',
      'undefined-secret',
      'undefined-config',
    ]);
  });

  it('flags self-dependencies and dependency cycles', () => {
    expect(codes('services:\n  a:\n    image: x:1\n    depends_on: [a]\n')).toEqual(['self-dependency']);
    const cycle = diagnose(
      'services:\n  a:\n    image: x:1\n    depends_on: [b]\n  b:\n    image: x:1\n    depends_on: [c]\n  c:\n    image: x:1\n    depends_on: [a]\n',
    );
    expect(cycle).toHaveLength(1);
    expect(cycle[0]?.message).toBe('Circular `depends_on`: a → b → c → a.');
  });

  it('warns when a dependency only exists in another profile', () => {
    const yaml = 'services:\n  api:\n    image: x:1\n    depends_on: [cache]\n  cache:\n    image: redis:7\n    profiles: [cache]\n';
    expect(codes(yaml)).toEqual(['profile-dependency']);
    const optional = yaml.replace('depends_on: [cache]', 'depends_on:\n      cache:\n        condition: service_started\n        required: false');
    expect(codes(optional)).toEqual([]);
  });

  it('flags network_mode conflicts and ignored ports', () => {
    expect(codes('services:\n  a:\n    image: x:1\n    network_mode: host\n    networks: [n]\nnetworks:\n  n:\n')).toEqual([
      'network-mode-conflict',
    ]);
    expect(codes('services:\n  a:\n    image: x:1\n    network_mode: service:ghost\n')).toEqual(['undefined-service']);
    expect(codes('services:\n  a:\n    image: x:1\n    network_mode: host\n    ports: ["80:80"]\n')).toEqual(['ports-ignored']);
  });

  it('validates port numbers, protocols and range sizes', () => {
    const diags = diagnose(
      'services:\n  a:\n    image: x:1\n    ports:\n      - "99999:80"\n      - "8080:80/xyz"\n      - "8000:80-81"\n      - "8000-8010:80"\n      - "${PORT}:80"\n',
    );
    expect(diags.map((d) => d.line)).toEqual([5, 6, 7]);
    expect(diags.every((d) => d.code === 'invalid-port')).toBe(true);
  });

  it('detects host port conflicts across services, respecting interfaces and profiles', () => {
    const conflict = diagnose('services:\n  a:\n    image: x:1\n    ports: ["8080:80"]\n  b:\n    image: y:1\n    ports: ["127.0.0.1:8080:81"]\n');
    expect(conflict.map((d) => d.code)).toEqual(['port-conflict']);
    expect(conflict[0]).toMatchObject({ service: 'b', line: 7 });

    const differentIps = 'services:\n  a:\n    image: x:1\n    ports: ["127.0.0.1:8080:80"]\n  b:\n    image: y:1\n    ports: ["127.0.0.2:8080:81"]\n';
    expect(codes(differentIps)).toEqual([]);

    const udpAndTcp = 'services:\n  a:\n    image: x:1\n    ports: ["53:53/udp", "53:53/tcp"]\n';
    expect(codes(udpAndTcp)).toEqual([]);

    const exclusiveProfiles = 'services:\n  a:\n    image: x:1\n    profiles: [dev]\n    ports: ["8080:80"]\n  b:\n    image: y:1\n    profiles: [prod]\n    ports: ["8080:80"]\n';
    expect(codes(exclusiveProfiles)).toEqual([]);
  });

  it('flags container_name duplicates and replicas', () => {
    const yaml = 'services:\n  a:\n    image: x:1\n    container_name: app\n    deploy:\n      replicas: 2\n  b:\n    image: y:1\n    container_name: app\n';
    expect(codes(yaml)).toEqual(['container-name-replicas', 'duplicate-container-name']);
  });

  it('adds informational notes for version, links, extends and include', () => {
    const yaml = 'version: "3.8"\ninclude: [other.yml]\nservices:\n  a:\n    extends:\n      file: base.yml\n      service: base\n    links: [b]\n  b:\n    image: x:1\n';
    const diags = diagnose(yaml);
    expect(diags.map((d) => d.code)).toEqual([
      'obsolete-version',
      'unresolved-include',
      'unresolved-extends',
      'legacy-links',
    ]);
    expect(diags.every((d) => d.severity === 'info')).toBe(true);
  });

  it('warns about unquoted ports that YAML 1.1 reads as base-60 numbers', () => {
    expect(codes('services:\n  a:\n    image: x:1\n    ports:\n      - 22:22\n      - 8080:80\n      - "2222:22"\n')).toEqual([
      'unquoted-port',
    ]);
  });
});

describe('suggestKey', () => {
  it('suggests close matches only', () => {
    expect(suggestKey('volume', ['volumes', 'networks'])).toBe('volumes');
    expect(suggestKey('Container-Name', ['container_name'])).toBe('container_name');
    expect(suggestKey('banana', ['image', 'ports'])).toBeNull();
  });
});
