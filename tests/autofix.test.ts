import { describe, expect, it } from 'vitest';
import {
  Finding,
  analyzeCompose,
  applyAutofix,
  applyAutofixes,
  applyFindingFix,
  applyFixOperation,
  findingKey,
  formatScalar,
} from '../src/core';
import { COMPOSE_EXAMPLES } from '../src/ui/examples';

/** Apply the first fixable finding of a rule and return the new text. */
function fixFirst(yaml: string, ruleId: string, service?: string): string {
  const result = analyzeCompose(yaml);
  if (!result.ok) throw new Error('parse failed');
  const finding = result.findings.find(
    (f) => f.ruleId === ruleId && f.autofix && (!service || f.service === service),
  );
  if (!finding) throw new Error(`no fixable ${ruleId} finding`);
  const fixed = applyFindingFix(yaml, finding);
  if (fixed === null) throw new Error(`fix for ${ruleId} returned null`);
  return fixed;
}

function remaining(yaml: string, ruleId: string): Finding[] {
  const result = analyzeCompose(yaml);
  if (!result.ok) throw new Error('fixed YAML no longer parses');
  return result.findings.filter((f) => f.ruleId === ruleId);
}

describe('autofix keeps the rest of the file intact', () => {
  it('replaces one environment value without touching the others (regression: map was overwritten)', () => {
    const yaml = [
      'services:',
      '  db:',
      '    image: postgres:16',
      '    environment:',
      '      POSTGRES_USER: app',
      '      POSTGRES_DB: app  # keep this comment',
      '      POSTGRES_PASSWORD: "hunter2"',
      '',
    ].join('\n');
    const fixed = fixFirst(yaml, 'CMP012');
    expect(fixed).toBe(yaml.replace('"hunter2"', '"${POSTGRES_PASSWORD}"'));
    expect(remaining(fixed, 'CMP012')).toHaveLength(0);
  });

  it('rewrites list-syntax environment entries in place', () => {
    const yaml = 'services:\n  db:\n    image: postgres:16\n    environment:\n      - POSTGRES_USER=app\n      - POSTGRES_PASSWORD=hunter2\n';
    expect(fixFirst(yaml, 'CMP012')).toBe(yaml.replace('=hunter2', '=${POSTGRES_PASSWORD}'));
  });

  it('binds a port to loopback instead of adding a conflicting second binding (regression)', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n      - 9000:9000/udp\n';
    let fixed = fixFirst(yaml, 'CMP004');
    fixed = fixFirst(fixed, 'CMP004');
    expect(fixed).toContain('- "127.0.0.1:8080:80"');
    expect(fixed).toContain('- "127.0.0.1:9000:9000/udp"');
    expect(fixed).not.toContain('- "8080:80"');
    expect(remaining(fixed, 'CMP004')).toHaveLength(0);
    const result = analyzeCompose(fixed);
    expect(result.ok && result.diagnostics.filter((d) => d.code === 'port-conflict')).toEqual([]);
  });

  it('sets host_ip on long-syntax ports', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - target: 443\n        published: 8443\n';
    const fixed = fixFirst(yaml, 'CMP004');
    expect(fixed).toBe(`${yaml}        host_ip: "127.0.0.1"\n`);
    expect(remaining(fixed, 'CMP004')).toHaveLength(0);
  });

  it('removes a dangerous capability from block and flow lists', () => {
    const block = 'services:\n  web:\n    image: nginx:1.27\n    cap_add:\n      - NET_BIND_SERVICE\n      - SYS_ADMIN\n    restart: always\n';
    expect(fixFirst(block, 'CMP006')).toBe(block.replace('      - SYS_ADMIN\n', ''));

    const flow = 'services:\n  web:\n    image: nginx:1.27\n    cap_add: [SYS_ADMIN, NET_BIND_SERVICE]\n';
    expect(fixFirst(flow, 'CMP006')).toContain('cap_add: [NET_BIND_SERVICE]');
  });

  it('removes the whole key when the last list item goes', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n    cap_add:\n      - SYS_ADMIN\n    restart: always\n';
    expect(fixFirst(yaml, 'CMP006')).toBe('services:\n  web:\n    image: nginx:1.27\n    restart: always\n');
  });

  it('adds list items at the right indentation, also for 4-space files', () => {
    const yaml = 'services:\n    web:\n        image: nginx:1.27\n        security_opt:\n            - label=type:svirt_t\n';
    const fixed = fixFirst(yaml, 'CMP009');
    expect(fixed).toBe(`${yaml}            - no-new-privileges:true\n`);
  });

  it('creates a new list key when it is missing', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n';
    expect(fixFirst(yaml, 'CMP007')).toBe(`${yaml}    cap_drop:\n      - ALL\n`);
  });

  it('works when the file has no trailing newline', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27';
    expect(fixFirst(yaml, 'CMP009')).toBe(`${yaml}\n    security_opt:\n      - no-new-privileges:true`);
  });

  it('inserts after block scalars without changing them', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n    command: |\n      echo hi\n      echo there\n\n  db:\n    image: postgres:16\n';
    const fixed = fixFirst(yaml, 'CMP009', 'web');
    expect(fixed).toBe(
      'services:\n  web:\n    image: nginx:1.27\n    command: |\n      echo hi\n      echo there\n    security_opt:\n      - no-new-privileges:true\n\n  db:\n    image: postgres:16\n',
    );
  });

  it('caps logging and pins the json-file driver', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n';
    const fixed = fixFirst(yaml, 'CMP017');
    expect(fixed).toBe(
      `${yaml}    logging:\n      driver: json-file\n      options:\n        max-size: 10m\n        max-file: "3"\n`,
    );
    expect(remaining(fixed, 'CMP017')).toHaveLength(0);
  });

  it('adds max-size to an existing logging block and keeps max-file', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n    logging:\n      options:\n        max-file: "5"\n';
    const fixed = fixFirst(yaml, 'CMP017');
    expect(fixed).toContain('        max-file: "5"\n        max-size: 10m\n');
    expect(fixed).toContain('      driver: json-file');
  });

  it('turns on read_only and adds /tmp to an existing scalar tmpfs', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n    tmpfs: /run\n';
    const fixed = fixFirst(yaml, 'CMP016');
    expect(fixed).toContain('    tmpfs:\n      - /run\n      - /tmp\n');
    expect(fixed).toContain('    read_only: true');
  });

  it('flips privileged and removes host namespaces', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n    privileged: true\n    pid: host\n';
    let fixed = fixFirst(yaml, 'CMP001');
    fixed = fixFirst(fixed, 'CMP005');
    expect(fixed).toBe('services:\n  web:\n    image: nginx:1.27\n    privileged: false\n');
  });
});

describe('autofix and YAML anchors', () => {
  const anchored = [
    'x-base: &base',
    '  cap_add:',
    '    - SYS_ADMIN',
    '    - NET_BIND_SERVICE',
    'services:',
    '  a:',
    '    <<: *base',
    '    image: nginx:1.27',
    '  b:',
    '    <<: *base',
    '    image: nginx:1.27',
    '',
  ].join('\n');

  it('overrides an inherited list for one service instead of editing the shared anchor', () => {
    const fixed = fixFirst(anchored, 'CMP006', 'a');
    // The anchor is untouched, so service b keeps its (still flagged) configuration
    expect(fixed.startsWith('x-base: &base\n  cap_add:\n    - SYS_ADMIN\n')).toBe(true);
    expect(fixed).toContain('    image: nginx:1.27\n    cap_add:\n      - NET_BIND_SERVICE\n  b:');
    const left = remaining(fixed, 'CMP006');
    expect(left.map((f) => f.service)).toEqual(['b']);
  });

  it('refuses to override an inherited mapping it would partially drop', () => {
    const yaml = 'x-log: &log\n  logging:\n    driver: json-file\nservices:\n  a:\n    <<: *log\n    image: nginx:1.27\n';
    const result = analyzeCompose(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finding = result.findings.find((f) => f.ruleId === 'CMP017')!;
    expect(applyFindingFix(yaml, finding)).toBeNull();
  });
});

describe('autofix safety', () => {
  it('returns null for findings without an autofix (no more guessing from YAML snippets)', () => {
    const yaml = 'services:\n  web:\n    image: nginx:latest\n';
    const result = analyzeCompose(yaml);
    if (!result.ok) throw new Error('parse');
    const tagFinding = result.findings.find((f) => f.ruleId === 'CMP003')!;
    expect(tagFinding.autofix).toBeUndefined();
    expect(applyFindingFix(yaml, tagFinding)).toBeNull();
  });

  it('returns null for unknown services, flow-style services and invalid YAML', () => {
    const op = { kind: 'addListItem' as const, service: 'web', key: 'cap_drop', item: 'ALL' };
    expect(applyFixOperation('services:\n  other:\n    image: x:1\n', op)).toBeNull();
    expect(applyFixOperation('services:\n  web: {image: "x:1"}\n', op)).toBeNull();
    expect(applyFixOperation('services:\n  web:\n    image: [\n', op)).toBeNull();
  });

  it('is idempotent: applying an add twice changes nothing the second time', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n';
    const fix = {
      label: 'x',
      operations: [{ kind: 'addListItem' as const, service: 'web', key: 'cap_drop', item: 'ALL' }],
    };
    const once = applyAutofix(yaml, fix)!;
    expect(applyAutofix(once, fix)).toBe(once);
  });

  it('never breaks any example file, whichever fix is applied', () => {
    for (const example of COMPOSE_EXAMPLES) {
      const result = analyzeCompose(example.yaml);
      if (!result.ok) throw new Error(example.id);
      for (const finding of result.findings.filter((f) => f.autofix)) {
        const fixed = applyFindingFix(example.yaml, finding);
        if (fixed === null) continue;
        const after = analyzeCompose(fixed);
        expect(after.ok, `${example.id} ${finding.ruleId}`).toBe(true);
        if (!after.ok) continue;
        expect(
          after.diagnostics.filter((d) => d.severity === 'error'),
          `${example.id} ${finding.ruleId}`,
        ).toEqual([]);
        // The same service must no longer have the exact same finding
        const stillThere = after.findings.some(
          (f) => f.ruleId === finding.ruleId && f.service === finding.service && f.message === finding.message,
        );
        expect(stillThere, `${example.id} ${finding.ruleId} ${finding.message}`).toBe(false);
      }
    }
  });
});

describe('formatScalar', () => {
  it('quotes values that YAML would otherwise read as another type', () => {
    expect(formatScalar('3')).toBe('"3"');
    expect(formatScalar('true')).toBe('"true"');
    expect(formatScalar('10m')).toBe('10m');
    expect(formatScalar('no-new-privileges:true')).toBe('no-new-privileges:true');
    expect(formatScalar('a #b')).toBe('"a #b"');
    expect(formatScalar(true)).toBe('true');
  });
});

describe('applyAutofixes (fix all)', () => {
  it('applies every fixable finding without breaking the file', () => {
    const insecure = COMPOSE_EXAMPLES.find((e) => e.id === 'deliberately-insecure')!.yaml;
    const before = analyzeCompose(insecure);
    const result = applyAutofixes(insecure);
    const after = analyzeCompose(result.text);
    if (!before.ok || !after.ok) throw new Error('parse');
    expect(result.applied.length).toBeGreaterThan(20);
    expect(result.skipped).toEqual([]);
    expect(after.findings.filter((f) => f.autofix)).toEqual([]);
    expect(after.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(after.score.score).toBeGreaterThan(before.score.score);
    // Findings that need a human decision stay
    expect(after.findings.some((f) => f.ruleId === 'CMP002')).toBe(true);
  });

  it('only applies the selected fixes', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n';
    const before = analyzeCompose(yaml);
    if (!before.ok) throw new Error('parse');
    const port = before.findings.find((f) => f.ruleId === 'CMP004')!;
    const result = applyAutofixes(yaml, { selected: new Set([findingKey(port)]) });
    expect(result.applied.map((f) => f.ruleId)).toEqual(['CMP004']);
    expect(result.text).toBe(yaml.replace('"8080:80"', '"127.0.0.1:8080:80"'));
  });

  it('respects muted rules', () => {
    const yaml = 'services:\n  web:\n    image: nginx:1.27\n';
    const result = applyAutofixes(yaml, { disabledRuleIds: ['CMP007', 'CMP009', 'CMP016', 'CMP017', 'CMP022'] });
    expect(result.applied).toEqual([]);
    expect(result.text).toBe(yaml);
  });
});
