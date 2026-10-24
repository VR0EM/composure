import { ComposeDiagnostic, ComposeModel, Finding } from './types';

/**
 * Inline suppression comments, so accepted risks stop counting against the
 * score without disabling a rule everywhere:
 *
 *   - /var/run/docker.sock:/var/run/docker.sock:ro  # composure-ignore CMP002 -- Traefik needs it
 *
 *   # composure-ignore CMP004
 *   - "8080:80"
 *
 *   traefik:  # composure-ignore            (whole service, all rules)
 *
 *   # composure-ignore-file CMP016 CMP020  (whole file)
 *
 * A comment on its own line applies to the next non-empty, non-comment line.
 * Placed on (or above) a service name, it applies to every finding of that service.
 */
export interface SuppressionDirective {
  /** Line the comment is on (1-based) */
  line: number;
  /** Line the directive applies to (same as `line` for trailing comments) */
  targetLine: number;
  /** Rule IDs, or empty for "all rules" */
  ruleIds: string[];
  scope: 'line' | 'file';
  reason?: string;
}

export interface SuppressedFinding extends Finding {
  suppression: SuppressionDirective;
}

const DIRECTIVE = /(^|\s)#\s*composure-ignore(-file)?\b:?(.*)$/i;

export function parseSuppressions(yamlText: string): SuppressionDirective[] {
  const lines = yamlText.split(/\r?\n/);
  const directives: SuppressionDirective[] = [];

  lines.forEach((text, idx) => {
    const match = DIRECTIVE.exec(text);
    if (!match) return;
    const lineNo = idx + 1;
    const [argsPart, ...reasonParts] = (match[3] ?? '').split(/\s--\s?/);
    const ruleIds = Array.from(
      new Set(((argsPart ?? '').match(/\bCMP\d{3}\b/gi) ?? []).map((r) => r.toUpperCase())),
    );
    const reason = reasonParts.join(' -- ').trim() || undefined;
    const scope = match[2] ? 'file' : 'line';

    let targetLine = lineNo;
    const ownLine = text.slice(0, match.index + (match[1]?.length ?? 0)).trim() === '';
    if (scope === 'line' && ownLine) {
      targetLine = -1;
      for (let j = idx + 1; j < lines.length; j++) {
        const next = lines[j]!.trim();
        if (next === '' || next.startsWith('#')) continue;
        targetLine = j + 1;
        break;
      }
      if (targetLine === -1) return;
    }

    directives.push({
      line: lineNo,
      targetLine,
      ruleIds,
      scope,
      ...(reason ? { reason } : {}),
    });
  });

  return directives;
}

function covers(directive: SuppressionDirective, ruleId: string): boolean {
  return directive.ruleIds.length === 0 || directive.ruleIds.includes(ruleId);
}

export interface SuppressionResult {
  active: Finding[];
  suppressed: SuppressedFinding[];
  /** Directives that matched nothing, reported so stale comments get cleaned up */
  unused: ComposeDiagnostic[];
}

export function applySuppressions(
  findings: Finding[],
  directives: SuppressionDirective[],
  model: ComposeModel,
): SuppressionResult {
  if (directives.length === 0) return { active: findings, suppressed: [], unused: [] };

  const serviceLines = new Map<string, number>();
  for (const svc of Object.values(model.services)) serviceLines.set(svc.name, svc.line);

  const used = new Set<SuppressionDirective>();
  const active: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];

  for (const finding of findings) {
    const serviceLine = serviceLines.get(finding.service);
    const directive = directives.find((d) => {
      if (!covers(d, finding.ruleId)) return false;
      if (d.scope === 'file') return true;
      return d.targetLine === finding.line || d.targetLine === serviceLine;
    });
    if (directive) {
      used.add(directive);
      suppressed.push({ ...finding, suppression: directive });
    } else {
      active.push(finding);
    }
  }

  const unused: ComposeDiagnostic[] = directives
    .filter((d) => !used.has(d))
    .map((d) => ({
      code: 'unused-suppression',
      severity: 'info' as const,
      message: `This composure-ignore comment${d.ruleIds.length > 0 ? ` (${d.ruleIds.join(', ')})` : ''} does not match any finding. Remove it, or check the rule ID and placement.`,
      line: d.line,
    }));

  return { active, suppressed, unused };
}

/**
 * Insert a `# composure-ignore <rule>` comment above a line, at the same
 * indentation, so a finding becomes an accepted risk. If the line above is
 * already an ignore comment, the rule is added to it instead.
 */
export function addSuppressionComment(
  yamlText: string,
  line: number,
  ruleId: string,
  reason?: string,
): string {
  const lines = yamlText.split('\n');
  const idx = Math.max(0, Math.min(line - 1, lines.length - 1));
  const target = lines[idx] ?? '';
  const indent = target.slice(0, target.length - target.trimStart().length);

  const above = idx > 0 ? lines[idx - 1]! : null;
  const existing = above !== null ? /^(\s*)#\s*composure-ignore\b:?([^\n]*)$/.exec(above) : null;
  if (existing && above !== null) {
    const [args, ...rest] = (existing[2] ?? '').split(/\s--\s?/);
    const ids = new Set(((args ?? '').match(/\bCMP\d{3}\b/gi) ?? []).map((r) => r.toUpperCase()));
    // An empty rule list already ignores everything
    if (ids.size === 0 || ids.has(ruleId)) return yamlText;
    ids.add(ruleId);
    const reasonText = rest.join(' -- ').trim();
    lines[idx - 1] =
      `${existing[1]}# composure-ignore ${Array.from(ids).join(' ')}${reasonText ? ` -- ${reasonText}` : ''}`;
    return lines.join('\n');
  }

  const comment = `${indent}# composure-ignore ${ruleId}${reason ? ` -- ${reason}` : ''}`;
  lines.splice(idx, 0, comment);
  return lines.join('\n');
}
