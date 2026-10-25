import { describe, expect, it } from 'vitest';
import {
  CMP002,
  CMP003,
  CMP004,
  CMP005,
  CMP006,
  CMP008,
  CMP010,
  CMP011,
  CMP012,
  CMP017,
  CMP018,
  CMP019,
  CMP020,
  CMP021,
  CMP022,
  ComposeModel,
  Rule,
  parseCompose,
} from '../src/core';

function model(yaml: string): ComposeModel {
  const parsed = parseCompose(yaml);
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('; '));
  return parsed.model;
}

/** Wrap service lines (indented 4 spaces) in a one-service Compose file. */
function svc(body: string, extra = ''): ComposeModel {
  return model(`services:\n  app:\n    image: nginx:1.27\n${body}${extra}`);
}

function check(rule: Rule, m: ComposeModel) {
  return rule.check(m);
}

describe('False positives that are now avoided', () => {
  it('CMP010 allows read-only time zone, CA bundle and os-release mounts', () => {
    const m = svc(
      [
        '    volumes:',
        '      - /etc/localtime:/etc/localtime:ro',
        '      - /etc/timezone:/etc/timezone:ro',
        '      - /usr/share/zoneinfo:/usr/share/zoneinfo:ro',
        '      - /etc/ssl/certs:/etc/ssl/certs:ro',
        '      - /etc/os-release:/host/etc/os-release:ro',
        '',
      ].join('\n'),
    );
    expect(check(CMP010, m)).toHaveLength(0);
  });

  it('CMP010 still flags those paths when mounted read-write', () => {
    const m = svc('    volumes:\n      - /etc/localtime:/etc/localtime\n');
    expect(check(CMP010, m)).toHaveLength(1);
  });

  it('CMP010 does not flag ordinary project folders under /home', () => {
    const m = svc('    volumes:\n      - /home/pi/sonarr/config:/config\n      - ~/media:/media\n');
    expect(check(CMP010, m)).toHaveLength(0);
  });

  it('CMP012 ignores flag-like values and settings about secrets', () => {
    const m = svc(
      [
        '    environment:',
        '      MYSQL_ALLOW_EMPTY_PASSWORD: "no"',
        '      MYSQL_RANDOM_ROOT_PASSWORD: "yes"',
        '      PASSWORD_MIN_LENGTH: "12"',
        '      TOKEN_TTL_SECONDS: "3600"',
        '      SECRET_KEY_FILE: /run/secrets/key',
        '      GOOGLE_APPLICATION_CREDENTIALS: /secrets/gcp.json',
        '      PWD: /app',
        '      DB_PASSWORD: ${DB_PASSWORD:?required}',
        '',
      ].join('\n'),
    );
    expect(check(CMP012, m)).toHaveLength(0);
  });

  it('CMP017 skips log drivers that rotate or ship logs elsewhere', () => {
    for (const driver of ['local', 'journald', 'syslog', 'fluentd', 'gelf', 'awslogs', 'none']) {
      const m = svc(`    logging:\n      driver: ${driver}\n`);
      expect(check(CMP017, m), driver).toHaveLength(0);
    }
    expect(check(CMP017, svc('    logging:\n      driver: json-file\n'))).toHaveLength(1);
  });

  it('CMP018 does not treat the implicit Compose network as the docker0 bridge', () => {
    const m = model('services:\n  a:\n    image: x:1\n  b:\n    image: y:1\n');
    const findings = check(CMP018, m);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
    expect(findings[0]?.title).toBe('Flat project network');
  });

  it('CMP003 does not guess about fully interpolated images, but catches a :latest fallback', () => {
    expect(check(CMP003, model('services:\n  a:\n    image: ${APP_IMAGE}\n'))).toHaveLength(0);
    const latestFallback = check(CMP003, model('services:\n  a:\n    image: app:${TAG:-latest}\n'));
    expect(latestFallback[0]).toMatchObject({ severity: 'medium' });
    const pinnedFallback = check(CMP003, model('services:\n  a:\n    image: app:${TAG:-1.4.2}\n'));
    expect(pinnedFallback[0]).toMatchObject({ severity: 'info' });
  });

  it('CMP004 skips host-networked services, where ports are ignored', () => {
    expect(check(CMP004, svc('    network_mode: host\n    ports:\n      - "80:80"\n'))).toHaveLength(0);
  });

  it('CMP004 treats a loopback fallback in an interpolated host IP as bound', () => {
    expect(check(CMP004, svc('    ports:\n      - "${BIND_IP:-127.0.0.1}:8080:80"\n'))).toHaveLength(0);
    expect(check(CMP004, svc('    ports:\n      - "${BIND_IP:-0.0.0.0}:8080:80"\n'))).toHaveLength(1);
  });
});

describe('Risks that were previously missed', () => {
  it('CMP005 flags uts: host and cgroup: host', () => {
    const findings = check(CMP005, svc('    uts: host\n    cgroup: host\n'));
    expect(findings.map((f) => f.title)).toEqual(['Host UTS shared', 'Host cgroup shared']);
    expect(findings[0]?.autofix?.operations[0]).toMatchObject({ kind: 'removeKey', key: 'uts' });
  });

  it('CMP002 flags other container runtime sockets', () => {
    const findings = check(
      CMP002,
      svc(
        '    volumes:\n      - /run/containerd/containerd.sock:/run/containerd/containerd.sock\n      - /run/podman/podman.sock:/var/run/docker.sock\n',
      ),
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]?.message).toContain('containerd');
    expect(findings.every((f) => f.severity === 'critical')).toBe(true);
  });

  it('CMP008 flags SELinux label:disable and unmasked system paths', () => {
    const findings = check(CMP008, svc('    security_opt:\n      - label:disable\n      - systempaths=unconfined\n'));
    expect(findings.map((f) => f.title)).toEqual(['SELinux labels disabled', 'System paths unmasked']);
  });

  it('CMP006 knows more dangerous capabilities', () => {
    const findings = check(CMP006, svc('    cap_add:\n      - CAP_SYS_RAWIO\n      - BPF\n      - CHOWN\n'));
    expect(findings).toHaveLength(2);
  });

  it('CMP010 flags credential folders, whole home directories and runtime dirs', () => {
    const findings = check(
      CMP010,
      svc(
        '    volumes:\n      - ~/.ssh:/root/.ssh:ro\n      - /home/alice:/home/alice\n      - /var/run:/var/run\n      - /boot:/boot:ro\n',
      ),
    );
    expect(findings).toHaveLength(4);
  });

  it('CMP011 rates raw disk and memory devices higher', () => {
    const findings = check(CMP011, svc('    devices:\n      - /dev/sda:/dev/sda\n      - /dev/mem\n      - /dev/ttyUSB0\n'));
    expect(findings.map((f) => f.severity)).toEqual(['high', 'high', 'medium']);
  });

  it('CMP012 finds credentials in URLs, known token formats and hardcoded fallbacks', () => {
    const findings = check(
      CMP012,
      svc(
        [
          '    environment:',
          '      DATABASE_URL: postgres://admin:SuperSecret1@db:5432/app',
          '      SAFE_URL: postgres://admin:${DB_PASSWORD}@db:5432/app',
          '      GH: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
          '      AWS_ACCESS_KEY_ID: AKIAABCDEFGHIJKLMNOP',
          '      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-changeme}',
          '',
        ].join('\n'),
      ),
    );
    expect(findings.map((f) => f.title)).toEqual([
      'Credentials in URL',
      'Secret in environment',
      'Secret in environment',
      'Hardcoded secret fallback',
    ]);
    expect(findings[3]?.severity).toBe('medium');
    // Only literal key/value secrets get an automatic fix
    expect(findings[0]?.autofix).toBeUndefined();
    expect(findings[1]?.autofix?.operations[0]).toMatchObject({ kind: 'setEnvValue', value: '${GH}' });
  });

  it('CMP019 flags datastores with authentication turned off, critical when published', () => {
    const internal = check(CMP019, model('services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_HOST_AUTH_METHOD: trust\n'));
    expect(internal[0]).toMatchObject({ severity: 'high', line: 5 });

    const published = check(
      CMP019,
      model('services:\n  db:\n    image: mysql:8\n    ports: ["3306:3306"]\n    environment:\n      - MYSQL_ALLOW_EMPTY_PASSWORD=yes\n'),
    );
    expect(published[0]?.severity).toBe('critical');

    const es = check(CMP019, model('services:\n  es:\n    image: elasticsearch:8.15.0\n    environment:\n      - xpack.security.enabled=false\n'));
    expect(es).toHaveLength(1);
  });

  it('CMP020 flags missing or unlimited PIDs limits', () => {
    expect(check(CMP020, svc(''))).toHaveLength(1);
    expect(check(CMP020, svc('    pids_limit: -1\n'))).toHaveLength(1);
    expect(check(CMP020, svc('    pids_limit: 100\n'))).toHaveLength(0);
    expect(check(CMP020, svc('    deploy:\n      resources:\n        limits:\n          pids: 100\n'))).toHaveLength(0);
  });

  it('CMP021 flags shared mount propagation in short and long syntax', () => {
    const findings = check(
      CMP021,
      svc(
        '    volumes:\n      - ./a:/a:rshared\n      - type: bind\n        source: ./b\n        target: /b\n        bind:\n          propagation: shared\n      - ./c:/c:rprivate\n',
      ),
    );
    expect(findings).toHaveLength(2);
  });

  it('CMP022 flags a missing restart policy, accepting deploy.restart_policy', () => {
    expect(check(CMP022, svc(''))[0]?.autofix?.operations[0]).toMatchObject({ key: 'restart', value: 'unless-stopped' });
    expect(check(CMP022, svc('    restart: "no"\n'))).toHaveLength(0);
    expect(check(CMP022, svc('    deploy:\n      restart_policy:\n        condition: on-failure\n'))).toHaveLength(0);
  });

  it('CMP004 treats SSH, RDP and VNC as sensitive ports', () => {
    const findings = check(CMP004, svc('    ports:\n      - "2222:22"\n      - "3389:3389"\n'));
    expect(findings.map((f) => f.severity)).toEqual(['high', 'high']);
  });
});
