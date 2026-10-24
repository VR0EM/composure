import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_RULES,
  CMP001,
  CMP002,
  CMP003,
  CMP004,
  CMP005,
  CMP006,
  CMP007,
  CMP008,
  CMP009,
  CMP010,
  CMP011,
  CMP012,
  CMP013,
  CMP014,
  CMP015,
  CMP016,
  CMP017,
  CMP018,
  CATEGORY_ORDER,
  ComposeModel,
  Finding,
  calculateSecurityScore,
  groupFindingsBySeverity,
  parseCompose,
  runRules,
} from '../src/core';

function loadModel(fixtureName: string): ComposeModel {
  const raw = readFileSync(join(__dirname, 'fixtures', fixtureName), 'utf-8');
  const parsed = parseCompose(raw);
  if (!parsed.ok) {
    throw new Error(
      `Failed to parse fixture ${fixtureName}: ${parsed.errors.map((e) => e.message).join(', ')}`,
    );
  }
  return parsed.model;
}

describe('Hardening Rules (CMP001 - CMP022)', () => {
  const positiveModel = loadModel('rules-positive.yml');
  const negativeModel = loadModel('rules-negative.yml');

  it('exports all 22 rules with required metadata (id, title, severity, category, description, fix, references)', () => {
    expect(ALL_RULES).toHaveLength(22);
    expect(new Set(ALL_RULES.map((r) => r.id)).size).toBe(22);
    for (const rule of ALL_RULES) {
      expect(rule.id).toMatch(/^CMP0(0[1-9]|1[0-9]|2[0-2])$/);
      expect(CATEGORY_ORDER).toContain(rule.category);
      expect(rule.title.length).toBeGreaterThan(3);
      expect(rule.title.length).toBeLessThanOrEqual(26);
      expect(rule.description.length).toBeGreaterThan(10);
      expect(rule.fix).toContain('```yaml');
      expect(rule.references.length).toBeGreaterThan(0);
    }
    const emitted = runRules(positiveModel);
    for (const f of emitted) {
      expect(f.title.length).toBeLessThanOrEqual(26);
    }
  });

  it('CMP001: detects privileged: true (positive) and passes privileged: false (negative)', () => {
    const pos = CMP001.check(positiveModel);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP001',
      severity: 'critical',
      service: 'insecure-all',
      line: 4,
    });

    expect(CMP001.check(negativeModel)).toHaveLength(0);
  });

  it('CMP002: detects Docker socket mount even when :ro (positive) and passes safe mounts (negative)', () => {
    const pos = CMP002.check(positiveModel);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP002',
      severity: 'critical',
      service: 'insecure-all',
      line: 25,
    });
    expect(pos[0]?.message).toContain(':ro');

    expect(CMP002.check(negativeModel)).toHaveLength(0);
  });

  it('CMP003: detects :latest/untagged as medium, tagged without digest as info (positive), and passes @sha256 digest (negative)', () => {
    const pos = CMP003.check(positiveModel);
    expect(pos).toHaveLength(3);
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP003',
      severity: 'medium',
      service: 'insecure-all',
      line: 3,
    });
    expect(pos[1]).toMatchObject({
      ruleId: 'CMP003',
      severity: 'info',
      service: 'list-env-and-tag-no-digest',
      line: 33,
    });
    expect(pos[2]).toMatchObject({ severity: 'info', service: 'published', line: 46 });

    expect(CMP003.check(negativeModel)).toHaveLength(0);
  });

  it('CMP004: detects ports bound to 0.0.0.0 with higher severity for DB/cache ports (positive) and passes 127.0.0.1 (negative)', () => {
    const pos = CMP004.check(positiveModel);
    // insecure-all also lists ports, but with network_mode: host they are ignored by Docker
    expect(pos).toHaveLength(2);
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP004',
      severity: 'medium',
      service: 'published',
      line: 49,
    });
    expect(pos[1]).toMatchObject({
      ruleId: 'CMP004',
      severity: 'high',
      service: 'published',
      line: 50,
    });
    expect(pos.every((f) => f.autofix?.operations[0]?.kind === 'bindPortHostIp')).toBe(true);

    expect(CMP004.check(negativeModel)).toHaveLength(0);
  });

  it('CMP005: detects network_mode: host, pid: host, ipc: host, userns_mode: host (positive) and passes isolated (negative)', () => {
    const pos = CMP005.check(positiveModel);
    expect(pos).toHaveLength(4);
    expect(pos.map((f) => f.line)).toEqual([5, 6, 7, 8]);
    expect(pos.every((f) => f.severity === 'high')).toBe(true);

    expect(CMP005.check(negativeModel)).toHaveLength(0);
  });

  it('CMP006: detects ALL and dangerous capabilities in cap_add (positive) and passes NET_BIND_SERVICE (negative)', () => {
    const pos = CMP006.check(positiveModel);
    expect(pos).toHaveLength(6);
    expect(pos[0]?.severity).toBe('critical'); // ALL
    expect(pos.slice(1).every((f) => f.severity === 'high')).toBe(true);

    expect(CMP006.check(negativeModel)).toHaveLength(0);
  });

  it('CMP007: detects missing cap_drop: [ALL] (positive, skipping privileged services where cap_drop is ignored) and passes when ALL is dropped (negative)', () => {
    const pos = CMP007.check(positiveModel);
    expect(pos).toHaveLength(2);
    expect(pos[0]?.ruleId).toBe('CMP007');

    expect(CMP007.check(negativeModel)).toHaveLength(0);
  });

  it('CMP008: detects seccomp:unconfined and apparmor:unconfined (positive) and passes confined (negative)', () => {
    const pos = CMP008.check(positiveModel);
    expect(pos).toHaveLength(2);
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP008',
      severity: 'high',
      line: 20,
    });
    expect(pos[1]).toMatchObject({
      ruleId: 'CMP008',
      severity: 'high',
      line: 21,
    });

    expect(CMP008.check(negativeModel)).toHaveLength(0);
  });

  it('CMP009: detects missing no-new-privileges (positive) and passes when set (negative)', () => {
    const pos = CMP009.check(positiveModel);
    expect(pos).toHaveLength(3);
    expect(pos[0]?.ruleId).toBe('CMP009');

    expect(CMP009.check(negativeModel)).toHaveLength(0);
  });

  it('CMP010: detects sensitive host paths with higher severity for read-write (positive) and passes safe mounts (negative)', () => {
    const pos = CMP010.check(positiveModel);
    expect(pos).toHaveLength(2);
    // /etc mounted rw -> critical
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP010',
      severity: 'critical',
      line: 26,
    });
    // /root mounted ro -> high
    expect(pos[1]).toMatchObject({
      ruleId: 'CMP010',
      severity: 'high',
      line: 27,
    });

    expect(CMP010.check(negativeModel)).toHaveLength(0);
  });

  it('CMP011: detects mapped host devices (positive) and passes when no devices are mapped (negative)', () => {
    const pos = CMP011.check(positiveModel);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP011',
      severity: 'medium',
      line: 23,
    });

    expect(CMP011.check(negativeModel)).toHaveLength(0);
  });

  it('CMP012: detects literal secrets in both map and list environment syntax (positive) and passes ${VAR} / _FILE (negative)', () => {
    const pos = CMP012.check(positiveModel);
    expect(pos).toHaveLength(4);
    expect(pos.map((f) => f.line)).toEqual([29, 30, 36, 37]);

    expect(CMP012.check(negativeModel)).toHaveLength(0);
  });

  it('CMP013: detects missing user as info and explicit root user as medium (positive) and passes non-root user (negative)', () => {
    const pos = CMP013.check(positiveModel);
    expect(pos).toHaveLength(3);
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP013',
      severity: 'info',
      service: 'insecure-all',
    });
    expect(pos[1]).toMatchObject({
      ruleId: 'CMP013',
      severity: 'medium',
      service: 'list-env-and-tag-no-digest',
      line: 34,
    });

    expect(CMP013.check(negativeModel)).toHaveLength(0);
  });

  it('CMP014: detects missing memory or CPU limits (positive) and passes when both are set (negative)', () => {
    const pos = CMP014.check(positiveModel);
    expect(pos).toHaveLength(3);
    expect(pos[0]?.message).toContain('memory or CPU');
    expect(pos[1]?.message).toContain('CPU');

    expect(CMP014.check(negativeModel)).toHaveLength(0);
  });

  it('CMP015: detects missing or disabled healthcheck (positive) and passes active healthcheck (negative)', () => {
    const pos = CMP015.check(positiveModel);
    expect(pos).toHaveLength(3);

    expect(CMP015.check(negativeModel)).toHaveLength(0);
  });

  it('CMP016: detects missing read_only: true (positive) and passes read_only: true (negative)', () => {
    const pos = CMP016.check(positiveModel);
    expect(pos).toHaveLength(3);
    expect(pos.every((f) => f.severity === 'info')).toBe(true);

    expect(CMP016.check(negativeModel)).toHaveLength(0);
  });

  it('CMP017: detects missing max-size logging (positive) and passes configured max-size (negative)', () => {
    const pos = CMP017.check(positiveModel);
    expect(pos).toHaveLength(3);
    expect(pos.every((f) => f.ruleId === 'CMP017' && f.severity === 'low')).toBe(
      true,
    );

    expect(CMP017.check(negativeModel)).toHaveLength(0);
  });

  it('CMP018: detects the legacy docker0 bridge (network_mode: bridge) and passes isolated custom network (negative)', () => {
    const pos = CMP018.check(positiveModel);
    // Compose's implicit `default` network is a project-scoped user-defined bridge,
    // not docker0, so only network_mode: bridge is a real finding here.
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP018',
      service: 'published',
      severity: 'medium',
      line: 47,
    });

    expect(CMP018.check(negativeModel)).toHaveLength(0);
  });

  it('Rule engine supports toggling rules off and computes score/grade', () => {
    const allNegativeFindings = runRules(negativeModel);
    expect(allNegativeFindings).toHaveLength(0);
    const perfectScore = calculateSecurityScore(allNegativeFindings);
    expect(perfectScore.score).toBe(100);
    expect(perfectScore.grade).toBe('A');

    // Per-service penalties: critical 30, high 15, medium 6, low 2, info 0
    const sampleScore = calculateSecurityScore([
      fakeFinding('info', 's'),
      fakeFinding('low', 's'),
      fakeFinding('medium', 's'),
    ]);
    // 100 - (0 + 2 + 6) = 92 -> Grade A
    expect(sampleScore.score).toBe(92);
    expect(sampleScore.grade).toBe('A');

    const allPositiveFindings = runRules(positiveModel);
    expect(allPositiveFindings.length).toBeGreaterThan(20);
    const badScore = calculateSecurityScore(allPositiveFindings);
    expect(badScore.grade).toBe('F');

    const grouped = groupFindingsBySeverity(allPositiveFindings);
    expect(grouped.critical.length).toBeGreaterThan(0);

    // Disable CMP001 and CMP002
    const filteredFindings = runRules(positiveModel, {
      disabledRuleIds: ['CMP001', 'CMP002'],
    });
    expect(
      filteredFindings.some(
        (f) => f.ruleId === 'CMP001' || f.ruleId === 'CMP002',
      ),
    ).toBe(false);
  });
});

function fakeFinding(severity: Finding['severity'], service: string): Finding {
  return {
    ruleId: 'CMP000',
    title: severity,
    severity,
    service,
    line: 1,
    description: '',
    message: '',
    fix: '',
    references: [],
  };
}

describe('Security score', () => {
  it('does not punish projects for having many services', () => {
    const findings = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((svc) => [
      fakeFinding('medium', svc),
      fakeFinding('low', svc),
    ]);
    const score = calculateSecurityScore(findings, { services: ['a', 'b', 'c', 'd', 'e', 'f'] });
    // Each service scores 92; six alike services score the same as one
    expect(score.score).toBe(92);
    expect(score.serviceScores['a']).toBe(92);
  });

  it('weighs the weakest service and counts clean services as 100', () => {
    const score = calculateSecurityScore(
      [fakeFinding('medium', 'web'), fakeFinding('medium', 'web'), fakeFinding('medium', 'web')],
      { services: ['web', 'db', 'cache'] },
    );
    // web = 82, mean = (82 + 100 + 100) / 3 = 94; (82 + 94) / 2 = 88
    expect(score.score).toBe(88);
    expect(score.grade).toBe('B');
  });

  it('caps the grade while critical or high findings are open', () => {
    const critical = calculateSecurityScore([fakeFinding('critical', 'a')], {
      services: ['a', 'b', 'c', 'd'],
    });
    expect(critical.score).toBeLessThanOrEqual(59);
    expect(critical.grade).toBe('D');

    const high = calculateSecurityScore([fakeFinding('high', 'a')], { services: ['a', 'b', 'c'] });
    expect(high.score).toBe(74);
    expect(high.grade).toBe('C');
  });

  it('breaks the score down by rule category', () => {
    const score = calculateSecurityScore(
      [
        { ...fakeFinding('critical', 'web'), ruleId: 'CMP001' },
        { ...fakeFinding('medium', 'web'), ruleId: 'CMP004' },
      ],
      { services: ['web', 'db'] },
    );
    expect(score.categoryScores.privileges).toMatchObject({ findings: 1, worst: 'critical' });
    // web 70, db 100 -> (70 + 85) / 2 = 78 (rounded)
    expect(score.categoryScores.privileges.score).toBe(78);
    expect(score.categoryScores.network).toMatchObject({ findings: 1, worst: 'medium', score: 96 });
    expect(score.categoryScores.secrets).toMatchObject({ findings: 0, worst: 'none', score: 100 });
  });

  it('scores an empty finding list as a perfect 100', () => {
    expect(calculateSecurityScore([], { services: ['a'] })).toMatchObject({ score: 100, grade: 'A' });
  });
});
