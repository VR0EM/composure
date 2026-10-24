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
  ComposeModel,
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

describe('Hardening Rules (CMP001 - CMP016)', () => {
  const positiveModel = loadModel('rules-positive.yml');
  const negativeModel = loadModel('rules-negative.yml');

  it('exports all 16 rules with required metadata (id, title, severity, description, fix, references)', () => {
    expect(ALL_RULES).toHaveLength(16);
    for (const rule of ALL_RULES) {
      expect(rule.id).toMatch(/^CMP0(0[1-9]|1[0-6])$/);
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
    expect(pos).toHaveLength(2);
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

    expect(CMP003.check(negativeModel)).toHaveLength(0);
  });

  it('CMP004: detects ports bound to 0.0.0.0 with higher severity for DB/cache ports (positive) and passes 127.0.0.1 (negative)', () => {
    const pos = CMP004.check(positiveModel);
    expect(pos).toHaveLength(2);
    expect(pos[0]).toMatchObject({
      ruleId: 'CMP004',
      severity: 'medium',
      service: 'insecure-all',
      line: 10,
    });
    expect(pos[1]).toMatchObject({
      ruleId: 'CMP004',
      severity: 'high',
      service: 'insecure-all',
      line: 11,
    });

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

  it('CMP007: detects missing cap_drop: [ALL] (positive) and passes when ALL is dropped (negative)', () => {
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
    expect(pos).toHaveLength(2);
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
    expect(pos).toHaveLength(2);
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
    expect(pos).toHaveLength(2);
    expect(pos[0]?.message).toContain('memory or CPU');
    expect(pos[1]?.message).toContain('CPU');

    expect(CMP014.check(negativeModel)).toHaveLength(0);
  });

  it('CMP015: detects missing or disabled healthcheck (positive) and passes active healthcheck (negative)', () => {
    const pos = CMP015.check(positiveModel);
    expect(pos).toHaveLength(2);

    expect(CMP015.check(negativeModel)).toHaveLength(0);
  });

  it('CMP016: detects missing read_only: true (positive) and passes read_only: true (negative)', () => {
    const pos = CMP016.check(positiveModel);
    expect(pos).toHaveLength(2);
    expect(pos.every((f) => f.severity === 'info')).toBe(true);

    expect(CMP016.check(negativeModel)).toHaveLength(0);
  });

  it('Rule engine supports toggling rules off and computes score/grade', () => {
    const allNegativeFindings = runRules(negativeModel);
    expect(allNegativeFindings).toHaveLength(0);
    const perfectScore = calculateSecurityScore(allNegativeFindings);
    expect(perfectScore.score).toBe(100);
    expect(perfectScore.grade).toBe('A');

    // Verify exact penalty weights: critical -25, high -10, medium -4, low -1, info 0
    const sampleScore = calculateSecurityScore([
      {
        ruleId: 'CMP003',
        title: 'info',
        severity: 'info',
        service: 's',
        line: 1,
        description: '',
        message: '',
        fix: '',
        references: [],
      },
      {
        ruleId: 'CMP007',
        title: 'low',
        severity: 'low',
        service: 's',
        line: 1,
        description: '',
        message: '',
        fix: '',
        references: [],
      },
      {
        ruleId: 'CMP009',
        title: 'medium',
        severity: 'medium',
        service: 's',
        line: 1,
        description: '',
        message: '',
        fix: '',
        references: [],
      },
    ]);
    // 100 - (0 + 1 + 4) = 95 -> Grade A
    expect(sampleScore.score).toBe(95);
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
