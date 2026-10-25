import { ALL_RULES } from './rules';
import { SuppressedFinding } from './suppressions';
import { ComposeDiagnostic, Finding, Rule, Severity } from './types';

/**
 * SARIF 2.1.0 output, understood by GitHub code scanning, GitLab, and most
 * CI security dashboards. Findings and Compose problems become results with
 * file/line locations; suppressed findings are kept with a suppression record.
 */

export interface SarifInput {
  /** Path of the analyzed file, relative to the repository root */
  uri: string;
  findings: Finding[];
  suppressed?: SuppressedFinding[];
  diagnostics?: ComposeDiagnostic[];
}

const SECURITY_SEVERITY: Record<Severity, string> = {
  critical: '9.5',
  high: '8.0',
  medium: '5.5',
  low: '3.0',
  info: '1.0',
};

function sarifLevel(severity: Severity): 'error' | 'warning' | 'note' {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

function ruleDescriptor(rule: Rule) {
  return {
    id: rule.id,
    name: rule.title.replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/ (\w)/g, (_, c: string) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase()),
    shortDescription: { text: rule.title },
    fullDescription: { text: rule.description.replace(/`/g, '') },
    help: { text: rule.fix.replace(/```yaml\n?|```/g, ''), markdown: rule.fix },
    helpUri: rule.references[0]?.url,
    defaultConfiguration: { level: sarifLevel(rule.severity) },
    properties: {
      tags: ['security', 'docker-compose'],
      'security-severity': SECURITY_SEVERITY[rule.severity],
    },
  };
}

function location(uri: string, line: number, column?: number) {
  return [
    {
      physicalLocation: {
        artifactLocation: { uri },
        region: { startLine: Math.max(1, line), ...(column ? { startColumn: column } : {}) },
      },
    },
  ];
}

export function buildSarifLog(inputs: SarifInput[], toolVersion = '0.3.0'): object {
  const diagnosticCodes = new Set<string>();
  for (const input of inputs) {
    for (const d of input.diagnostics ?? []) diagnosticCodes.add(d.code);
  }

  const rules = [
    ...ALL_RULES.map(ruleDescriptor),
    ...Array.from(diagnosticCodes).sort().map((code) => ({
      id: `compose/${code}`,
      name: code.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()),
      shortDescription: { text: `Compose problem: ${code}` },
      properties: { tags: ['correctness', 'docker-compose'] },
    })),
  ];

  const results = inputs.flatMap((input) => [
    ...input.findings.map((f) => findingResult(input.uri, f)),
    ...(input.suppressed ?? []).map((f) => ({
      ...findingResult(input.uri, f),
      suppressions: [
        {
          kind: 'inSource',
          justification: f.suppression.reason ?? 'Suppressed with a composure-ignore comment',
        },
      ],
    })),
    ...(input.diagnostics ?? []).map((d) => ({
      ruleId: `compose/${d.code}`,
      level: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'note',
      message: { text: d.message.replace(/`/g, "'") },
      locations: location(input.uri, d.line, d.column),
    })),
  ]);

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Composure',
            informationUri: 'https://github.com/VR0EM/composure',
            version: toolVersion,
            rules,
          },
        },
        results,
      },
    ],
  };
}

function findingResult(uri: string, f: Finding) {
  return {
    ruleId: f.ruleId,
    level: sarifLevel(f.severity),
    message: { text: `[${f.service}] ${f.title}: ${f.message.replace(/`/g, "'")}` },
    locations: location(uri, f.line),
    partialFingerprints: { composureFinding: `${f.ruleId}:${f.service}:${f.message}` },
    properties: { severity: f.severity, service: f.service },
  };
}
