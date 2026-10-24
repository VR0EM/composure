import { describe, expect, it, vi } from 'vitest';
import {
  addSuppressionComment,
  analyzeCompose,
  buildSarifLog,
  diffLines,
  generateFindingsMarkdown,
  parseSuppressions,
} from '../src/core';
import { main } from '../src/cli/composure';

const BASE = [
  'services:',
  '  proxy:',
  '    image: traefik:v3.2',
  '    volumes:',
  '      # composure-ignore CMP002 -- Traefik reads container labels',
  '      - /var/run/docker.sock:/var/run/docker.sock:ro',
  '    ports:',
  '      - "80:80"  # composure-ignore CMP004',
  '',
].join('\n');

describe('inline suppressions', () => {
  it('parses own-line and trailing directives with reasons', () => {
    const directives = parseSuppressions(BASE);
    expect(directives).toEqual([
      { line: 5, targetLine: 6, ruleIds: ['CMP002'], scope: 'line', reason: 'Traefik reads container labels' },
      { line: 8, targetLine: 8, ruleIds: ['CMP004'], scope: 'line' },
    ]);
  });

  it('moves suppressed findings out of the score', () => {
    const result = analyzeCompose(BASE);
    if (!result.ok) throw new Error('parse');
    expect(result.findings.some((f) => f.ruleId === 'CMP002' || f.ruleId === 'CMP004')).toBe(false);
    expect(result.suppressed.map((f) => f.ruleId).sort()).toEqual(['CMP002', 'CMP004']);
    expect(result.suppressed.find((f) => f.ruleId === 'CMP002')?.suppression.reason).toBe(
      'Traefik reads container labels',
    );
    // Without criticals and highs the score is no longer capped
    expect(result.score.score).toBeGreaterThan(59);
  });

  it('applies to a whole service when placed on the service line', () => {
    const yaml = 'services:\n  legacy:  # composure-ignore\n    image: node\n    privileged: true\n';
    const result = analyzeCompose(yaml);
    expect(result.ok && result.findings).toEqual([]);
  });

  it('supports file-wide directives for specific rules', () => {
    const yaml = '# composure-ignore-file CMP016 CMP020\nservices:\n  a:\n    image: x:1\n  b:\n    image: y:1\n';
    const result = analyzeCompose(yaml);
    if (!result.ok) throw new Error('parse');
    expect(result.findings.some((f) => f.ruleId === 'CMP016' || f.ruleId === 'CMP020')).toBe(false);
    expect(result.suppressed).toHaveLength(4);
  });

  it('reports directives that match nothing', () => {
    const yaml = 'services:\n  a:\n    # composure-ignore CMP001\n    image: x:1\n';
    const result = analyzeCompose(yaml);
    expect(result.ok && result.diagnostics.map((d) => d.code)).toEqual(['unused-suppression']);
  });

  it('inserts and extends ignore comments at the right indentation', () => {
    const yaml = 'services:\n  web:\n    ports:\n      - "80:80"\n';
    const once = addSuppressionComment(yaml, 4, 'CMP004', 'behind a firewall');
    expect(once).toBe('services:\n  web:\n    ports:\n      # composure-ignore CMP004 -- behind a firewall\n      - "80:80"\n');
    const twice = addSuppressionComment(once, 5, 'CMP002');
    expect(twice).toContain('      # composure-ignore CMP004 CMP002 -- behind a firewall\n');
    expect(addSuppressionComment(twice, 5, 'CMP004')).toBe(twice);
  });
});

describe('diffLines', () => {
  it('shows removed lines before added lines with context', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng';
    const after = 'a\nb\nc\nD\ne\nf\ng';
    expect(diffLines(before, after, 1)).toEqual([
      { type: 'context', text: 'c', oldLine: 3, newLine: 3 },
      { type: 'removed', text: 'd', oldLine: 4 },
      { type: 'added', text: 'D', newLine: 4 },
      { type: 'context', text: 'e', oldLine: 5, newLine: 5 },
    ]);
  });

  it('marks gaps between distant changes', () => {
    const lines = diffLines('1\n2\n3\n4\n5\n6\n7\n8', 'x\n2\n3\n4\n5\n6\n7\ny', 1);
    expect(lines.some((l) => l.type === 'gap')).toBe(true);
  });
});

describe('reports', () => {
  it('builds SARIF with rules, security severities, locations and suppressions', () => {
    const result = analyzeCompose(BASE);
    if (!result.ok) throw new Error('parse');
    const sarif = buildSarifLog([
      { uri: 'deploy/compose.yaml', findings: result.findings, suppressed: result.suppressed, diagnostics: result.diagnostics },
    ]) as {
      version: string;
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string; properties: Record<string, unknown> }> } };
        results: Array<{ ruleId: string; level: string; suppressions?: unknown[]; locations: Array<{ physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }> }>;
      }>;
    };
    expect(sarif.version).toBe('2.1.0');
    const run = sarif.runs[0]!;
    expect(run.tool.driver.rules.find((r) => r.id === 'CMP002')?.properties['security-severity']).toBe('9.5');
    const socket = run.results.find((r) => r.ruleId === 'CMP002')!;
    expect(socket.suppressions).toHaveLength(1);
    expect(socket.level).toBe('error');
    expect(socket.locations[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: 'deploy/compose.yaml' },
      region: { startLine: 6 },
    });
  });

  it('includes problems, per-service scores and accepted risks in Markdown', () => {
    const yaml = `${BASE}  app:\n    image: x:1\n    networks: [missing]\n`;
    const result = analyzeCompose(yaml);
    if (!result.ok) throw new Error('parse');
    const md = generateFindingsMarkdown(result.model, result.findings, {
      diagnostics: result.diagnostics,
      suppressed: result.suppressed,
      score: result.score,
      fileName: 'compose.yaml',
    });
    expect(md).toContain('## Compose Problems');
    expect(md).toContain('undefined network');
    expect(md).toContain('## Score by Service');
    expect(md).toContain('## Accepted Risks (suppressed)');
    expect(md).toContain('Traefik reads container labels');
  });
});

describe('CLI', () => {
  function run(args: string[]): { code: number; out: string; err: string } {
    let out = '';
    let err = '';
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    try {
      return { code: main(args), out, err };
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
  }

  it('exits 1 when the threshold is reached and 0 when it is not', () => {
    const positive = run(['--no-color', 'tests/fixtures/rules-positive.yml']);
    expect(positive.code).toBe(1);
    expect(positive.out).toContain('Grade F');
    expect(run(['--no-color', '--fail-on', 'none', 'tests/fixtures/rules-positive.yml']).code).toBe(0);
    expect(run(['--no-color', 'tests/fixtures/rules-negative.yml']).code).toBe(0);
  });

  it('prints machine-readable JSON', () => {
    const { out } = run(['--format', 'json', '--disable', 'CMP003', 'tests/fixtures/rules-positive.yml']);
    const parsed = JSON.parse(out) as { files: Array<{ ok: boolean; findings: Array<{ ruleId: string }> }> };
    expect(parsed.files[0]?.ok).toBe(true);
    expect(parsed.files[0]?.findings.some((f) => f.ruleId === 'CMP003')).toBe(false);
  });

  it('rejects unknown options and rule IDs with exit code 2', () => {
    expect(run(['--nope']).code).toBe(2);
    const bad = run(['--disable', 'CMP999', 'tests/fixtures/rules-negative.yml']);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('CMP999');
  });

  it('fails on YAML syntax errors', () => {
    const { code, out } = run(['--no-color', 'tests/fixtures/invalid-syntax.yml']);
    expect(code).toBe(1);
    expect(out).toContain('could not be parsed');
  });
});
