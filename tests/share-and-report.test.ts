import { describe, expect, it } from 'vitest';
import {
  buildComposeGraph,
  calculateSecurityScore,
  compressYamlToHash,
  decompressYamlFromHash,
  generateFindingsMarkdown,
  parseCompose,
  runRules,
} from '../src/core';
import { COMPOSE_EXAMPLES } from '../src/ui/examples';
import { renderGraphToSvgString } from '../src/ui/exportDiagram';

describe('URL Hash Compression & Sharing', () => {
  it('round-trips YAML through compressed URL hash payload', async () => {
    const sampleYaml = COMPOSE_EXAMPLES[0]!.yaml;
    const hashPayload = await compressYamlToHash(sampleYaml);
    expect(hashPayload.startsWith('z.') || hashPayload.startsWith('u.')).toBe(
      true,
    );

    const restored = await decompressYamlFromHash(`#compose=${hashPayload}`);
    expect(restored).toBe(sampleYaml);
  });

  it('returns null on corrupted or empty hash payloads', async () => {
    expect(await decompressYamlFromHash('')).toBeNull();
    expect(await decompressYamlFromHash('#compose=z.invalid!!!')).toBeNull();
  });
});

describe('Markdown Security Report & Preset Examples', () => {
  it('validates all preset examples and confirms Insecure vs Hardened scores', () => {
    expect(COMPOSE_EXAMPLES.length).toBeGreaterThanOrEqual(4);

    for (const example of COMPOSE_EXAMPLES) {
      const parsed = parseCompose(example.yaml);
      expect(parsed.ok).toBe(true);
    }

    // Deliberately insecure example triggers critical findings and Grade F
    const insecureParsed = parseCompose(
      COMPOSE_EXAMPLES.find((e) => e.id === 'deliberately-insecure')!.yaml,
    );
    expect(insecureParsed.ok).toBe(true);
    if (insecureParsed.ok) {
      const findings = runRules(insecureParsed.model);
      const score = calculateSecurityScore(findings);
      expect(score.grade).toBe('F');
      expect(score.countsBySeverity.critical).toBeGreaterThan(0);

      const md = generateFindingsMarkdown(insecureParsed.model, findings);
      expect(md).toContain('# Composure: Docker Compose Security Hardening Report');
      expect(md).toContain('CMP001');
      expect(md).toContain('CMP002');
      expect(md).toContain('```yaml');
    }

    // Hardened Zero-Trust example passes all 16 rules with Grade A (100/100)
    const hardenedParsed = parseCompose(
      COMPOSE_EXAMPLES.find((e) => e.id === 'hardened-reference')!.yaml,
    );
    expect(hardenedParsed.ok).toBe(true);
    if (hardenedParsed.ok) {
      const findings = runRules(hardenedParsed.model);
      expect(findings).toHaveLength(0);
      const score = calculateSecurityScore(findings);
      expect(score.score).toBe(100);
      expect(score.grade).toBe('A');

      const md = generateFindingsMarkdown(hardenedParsed.model, findings);
      expect(md).toContain('100/100');
      expect(md).toContain('No security findings detected');
    }
  });

  it('renders a standalone vector SVG string from ComposeGraph', async () => {
    const parsed = parseCompose(COMPOSE_EXAMPLES[0]!.yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const findings = runRules(parsed.model);
    const graph = buildComposeGraph(parsed.model, findings);
    const { svg, width, height } = await renderGraphToSvgString(graph, 'dark');

    expect(svg).toContain('<svg');
    expect(svg).toContain('Architecture diagram');
    expect(svg).toContain('proxy');
    expect(width).toBeGreaterThan(200);
    expect(height).toBeGreaterThan(200);
  });
});
