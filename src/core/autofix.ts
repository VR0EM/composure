import {
  Document,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  Pair,
  parseDocument,
  parse as parseYaml,
  Scalar,
  YAMLMap,
  YAMLSeq,
} from 'yaml';
import { getEffectiveMapPairs, parseShortPort, resolveAstNode, scalarToString } from './normalizer';
import { normalizeCapability } from './rules/CMP006-cap-add';
import { normalizeSecurityOpt } from './rules/CMP008-security-opt-unconfined';
import { AnalyzeOptions, analyzeCompose } from './analyze';
import { Autofix, Finding, FixOperation, ListCompareMode } from './types';

/**
 * Applies structured autofixes as minimal text edits, so comments, quoting,
 * key order and indentation outside the edited lines stay exactly as written.
 *
 * Every function returns the new text, or null when the edit cannot be done
 * safely (for example when the value is inherited through a YAML anchor in a
 * way that an override would change other services). Callers treat null as
 * "fix by hand".
 */

type Range = [number, number, number?];

interface Ctx {
  text: string;
  doc: Document;
  indentUnit: number;
}

interface ServiceCtx {
  svcPair: Pair;
  svcMap: YAMLMap;
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

function rangeOf(node: unknown): Range | null {
  const r = (node as { range?: Range } | null | undefined)?.range;
  return Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number' ? r : null;
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

function lineEnd(text: string, offset: number): number {
  const idx = text.indexOf('\n', offset);
  return idx === -1 ? text.length : idx;
}

function columnOf(text: string, offset: number): number {
  return offset - lineStart(text, offset);
}

/** End of a node's content, ignoring trailing whitespace and newlines. */
function contentEnd(text: string, node: unknown, fallback: number): number {
  const r = rangeOf(node);
  if (!r) return fallback;
  let end = r[1];
  while (end > r[0] && /\s/.test(text[end - 1] ?? '')) end--;
  return end;
}

function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}

/* ------------------------------------------------------------------ */
/* YAML scalar formatting                                              */
/* ------------------------------------------------------------------ */

/** Format a value as a YAML scalar, quoting only when a plain scalar would change meaning. */
export function formatScalar(value: string | boolean | number): string {
  if (typeof value !== 'string') return String(value);
  if (value === '' || value !== value.trim() || /[\n\r\t]/.test(value)) return JSON.stringify(value);
  try {
    const parsed = parseYaml(`k: ${value}\n`) as { k?: unknown } | null;
    if (parsed && parsed.k === value && !value.includes(' #')) return value;
  } catch {
    // fall through to quoting
  }
  return JSON.stringify(value);
}

/** Format a replacement value in the same quoting style as the scalar it replaces. */
function formatLike(original: unknown, value: string, forceQuote = false): string {
  const type = isScalar(original) ? (original as Scalar).type : undefined;
  if (type === 'QUOTE_SINGLE') return `'${value.replace(/'/g, "''")}'`;
  if (type === 'QUOTE_DOUBLE' || forceQuote) return JSON.stringify(value);
  return formatScalar(value);
}

/* ------------------------------------------------------------------ */
/* Structure helpers                                                   */
/* ------------------------------------------------------------------ */

function keyString(pair: Pair): string | null {
  return scalarToString(pair.key);
}

function ownPair(map: YAMLMap, key: string): Pair | undefined {
  let found: Pair | undefined;
  for (const item of map.items) {
    if (isPair(item) && keyString(item) === key) found = item;
  }
  return found;
}

function effectivePair(ctx: Ctx, map: YAMLMap, key: string): Pair | undefined {
  return getEffectiveMapPairs(map, ctx.doc).find((p) => keyString(p) === key);
}

function isBlockMap(node: unknown): node is YAMLMap {
  return isMap(node) && !(node as YAMLMap).flow && (node as YAMLMap).items.length > 0;
}

function findService(ctx: Ctx, name: string): ServiceCtx | null {
  const root = ctx.doc.contents;
  if (!isMap(root)) return null;
  const servicesPair = ownPair(root, 'services');
  if (!servicesPair || !isBlockMap(servicesPair.value)) return null;
  const svcPair = ownPair(servicesPair.value, name);
  if (!svcPair || !isBlockMap(svcPair.value)) return null;
  return { svcPair, svcMap: svcPair.value };
}

function keyIndent(ctx: Ctx, map: YAMLMap): number {
  const first = map.items.find(isPair);
  const r = rangeOf(first?.key);
  return r ? columnOf(ctx.text, r[0]) : 0;
}

function detectIndentUnit(text: string, doc: Document): number {
  const root = doc.contents;
  if (isMap(root)) {
    const servicesPair = ownPair(root, 'services');
    const servicesKey = rangeOf(servicesPair?.key);
    if (servicesPair && isMap(servicesPair.value) && servicesKey) {
      const firstService = servicesPair.value.items.find(isPair);
      const svcKey = rangeOf(firstService?.key);
      if (svcKey) {
        const unit = columnOf(text, svcKey[0]) - columnOf(text, servicesKey[0]);
        if (unit > 0 && unit <= 8) return unit;
      }
    }
  }
  return 2;
}

/** End offset (exclusive, before the newline) of the last line of a pair. */
function pairLineEnd(ctx: Ctx, pair: Pair): number {
  const keyRange = rangeOf(pair.key);
  const fallback = keyRange ? keyRange[1] : 0;
  const end = pair.value ? contentEnd(ctx.text, pair.value, fallback) : fallback;
  return lineEnd(ctx.text, Math.max(end - 1, fallback));
}

/* ------------------------------------------------------------------ */
/* Rendering new YAML blocks                                           */
/* ------------------------------------------------------------------ */

type Render =
  | { scalar: string | boolean | number }
  | { list: string[] }
  | { map: Array<[string, Render]> };

function renderEntry(key: string, value: Render, unit: number): string[] {
  const pad = ' '.repeat(unit);
  if ('scalar' in value) return [`${key}: ${formatScalar(value.scalar)}`];
  if ('list' in value) return [`${key}:`, ...value.list.map((item) => `${pad}- ${formatScalar(item)}`)];
  return [`${key}:`, ...value.map.flatMap(([k, v]) => renderEntry(k, v, unit).map((l) => pad + l))];
}

/** Append new lines at the end of a block map, at the map's key indentation. */
function appendToMap(ctx: Ctx, map: YAMLMap, lines: string[]): string | null {
  const pairs = map.items.filter(isPair);
  const last = pairs[pairs.length - 1];
  if (!last) return null;
  const indent = ' '.repeat(keyIndent(ctx, map));
  const at = pairLineEnd(ctx, last);
  return splice(ctx.text, at, at, lines.map((l) => `\n${indent}${l}`).join(''));
}

/** Replace all lines of a pair with freshly rendered lines (same indentation). */
function replacePairLines(ctx: Ctx, pair: Pair, lines: string[]): string | null {
  const keyRange = rangeOf(pair.key);
  if (!keyRange) return null;
  const start = lineStart(ctx.text, keyRange[0]);
  const indent = ' '.repeat(keyRange[0] - start);
  // Only safe when the key is the first thing on its line
  if (ctx.text.slice(start, keyRange[0]).trim() !== '') return null;
  const end = pairLineEnd(ctx, pair);
  return splice(ctx.text, start, end, lines.map((l) => indent + l).join('\n'));
}

/** Delete the lines of a pair, including its trailing newline. */
function deletePairLines(ctx: Ctx, pair: Pair): string | null {
  const keyRange = rangeOf(pair.key);
  if (!keyRange) return null;
  const start = lineStart(ctx.text, keyRange[0]);
  if (ctx.text.slice(start, keyRange[0]).trim() !== '') return null;
  const end = pairLineEnd(ctx, pair);
  return splice(ctx.text, start, Math.min(ctx.text.length, end + 1), '');
}

function scalarItems(seq: YAMLSeq, ctx: Ctx): string[] | null {
  const values: string[] = [];
  for (const item of seq.items) {
    const resolved = resolveAstNode(item, ctx.doc);
    const str = isScalar(resolved) ? scalarToString(resolved) : null;
    if (str === null) return null;
    values.push(str);
  }
  return values;
}

function itemSource(ctx: Ctx, item: unknown): string | null {
  const r = rangeOf(item);
  return r ? ctx.text.slice(r[0], r[1]).trim() : null;
}

function rewriteFlowSeq(ctx: Ctx, seq: YAMLSeq, items: string[]): string | null {
  const r = rangeOf(seq);
  if (!r) return null;
  return splice(ctx.text, r[0], r[1], `[${items.join(', ')}]`);
}

function listMatches(a: string, b: string, mode: ListCompareMode = 'exact'): boolean {
  switch (mode) {
    case 'capability':
      return normalizeCapability(a) === normalizeCapability(b);
    case 'securityOpt': {
      const norm = (v: string) => {
        const n = normalizeSecurityOpt(v);
        return n === 'no-new-privileges' ? 'no-new-privileges:true' : n;
      };
      return norm(a) === norm(b);
    }
    case 'mountTarget': {
      const target = (v: string) => (v.split(':')[0] ?? '').trim().replace(/\/+$/, '');
      return target(a) === target(b);
    }
    default:
      return a.trim() === b.trim();
  }
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

function setScalar(ctx: Ctx, op: Extract<FixOperation, { kind: 'setScalar' }>): string | null {
  const svc = findService(ctx, op.service);
  if (!svc) return null;
  const own = ownPair(svc.svcMap, op.key);
  if (own) {
    const value = own.value;
    if (isScalar(value) && rangeOf(value) && rangeOf(value)![1] > rangeOf(value)![0]) {
      const r = rangeOf(value)!;
      const formatted =
        typeof op.value === 'string' ? formatLike(value, op.value) : formatScalar(op.value);
      return splice(ctx.text, r[0], r[1], formatted);
    }
    if (value === null || (isScalar(value) && value.value === null)) {
      return replacePairLines(ctx, own, [`${op.key}: ${formatScalar(op.value)}`]);
    }
    return null;
  }
  // Absent or inherited through a merge key: an explicit key overrides it
  return appendToMap(ctx, svc.svcMap, [`${op.key}: ${formatScalar(op.value)}`]);
}

function removeKey(ctx: Ctx, op: Extract<FixOperation, { kind: 'removeKey' }>): string | null {
  const svc = findService(ctx, op.service);
  if (!svc) return null;
  const own = ownPair(svc.svcMap, op.key);
  if (!own) return null; // inherited values cannot be removed without affecting others
  if (svc.svcMap.items.filter(isPair).length <= 1) return null;
  return deletePairLines(ctx, own);
}

function addListItem(ctx: Ctx, op: Extract<FixOperation, { kind: 'addListItem' }>): string | null {
  const svc = findService(ctx, op.service);
  if (!svc) return null;
  const own = ownPair(svc.svcMap, op.key);
  const unit = ctx.indentUnit;

  if (!own) {
    const inherited = effectivePair(ctx, svc.svcMap, op.key);
    let existing: string[] = [];
    if (inherited) {
      const resolved = resolveAstNode(inherited.value, ctx.doc);
      if (isSeq(resolved)) {
        const values = scalarItems(resolved, ctx);
        if (!values) return null;
        existing = values;
      } else if (isScalar(resolved)) {
        const v = scalarToString(resolved);
        if (v) existing = [v];
      }
      if (existing.some((v) => listMatches(v, op.item, op.compare))) return ctx.text;
    }
    return appendToMap(ctx, svc.svcMap, renderEntry(op.key, { list: [...existing, op.item] }, unit));
  }

  const value = own.value;
  if (isAlias(value)) return null;

  if (isSeq(value)) {
    const values = scalarItems(value, ctx);
    if (values?.some((v) => listMatches(v, op.item, op.compare))) return ctx.text;
    if (value.flow || value.items.length === 0) {
      const sources = value.items.map((i) => itemSource(ctx, i));
      if (sources.some((s) => s === null)) return null;
      return rewriteFlowSeq(ctx, value, [...(sources as string[]), formatScalar(op.item)]);
    }
    const last = value.items[value.items.length - 1];
    const lastRange = rangeOf(last);
    if (!lastRange) return null;
    const dashLineStart = lineStart(ctx.text, lastRange[0]);
    const prefix = ctx.text.slice(dashLineStart, lastRange[0]);
    const dashIdx = prefix.lastIndexOf('-');
    if (dashIdx === -1) return null;
    const indent = prefix.slice(0, dashIdx);
    if (indent.trim() !== '') return null;
    const at = lineEnd(ctx.text, Math.max(contentEnd(ctx.text, last, lastRange[1]) - 1, lastRange[0]));
    return splice(ctx.text, at, at, `\n${indent}- ${formatScalar(op.item)}`);
  }

  if (isScalar(value) && value.value !== null) {
    const existing = scalarToString(value);
    if (existing === null) return null;
    if (listMatches(existing, op.item, op.compare)) return ctx.text;
    return replacePairLines(ctx, own, renderEntry(op.key, { list: [existing, op.item] }, unit));
  }

  if (value === null || (isScalar(value) && value.value === null)) {
    return replacePairLines(ctx, own, renderEntry(op.key, { list: [op.item] }, unit));
  }
  return null;
}

function removeListItem(
  ctx: Ctx,
  op: Extract<FixOperation, { kind: 'removeListItem' }>,
): string | null {
  const svc = findService(ctx, op.service);
  if (!svc) return null;
  const own = ownPair(svc.svcMap, op.key);

  if (!own) {
    const inherited = effectivePair(ctx, svc.svcMap, op.key);
    if (!inherited) return ctx.text;
    const resolved = resolveAstNode(inherited.value, ctx.doc);
    if (!isSeq(resolved)) return null;
    const values = scalarItems(resolved, ctx);
    if (!values) return null;
    const remaining = values.filter((v) => !listMatches(v, op.item, op.compare));
    if (remaining.length === values.length) return ctx.text;
    // Override the inherited list for this service only
    return appendToMap(
      ctx,
      svc.svcMap,
      remaining.length > 0 ? renderEntry(op.key, { list: remaining }, ctx.indentUnit) : [`${op.key}: []`],
    );
  }

  const value = own.value;
  if (isAlias(value)) return null;

  if (isScalar(value)) {
    const v = scalarToString(value);
    if (v !== null && listMatches(v, op.item, op.compare)) return removeWholePair(ctx, svc, own);
    return ctx.text;
  }
  if (!isSeq(value)) return null;

  const matches: number[] = [];
  value.items.forEach((item, idx) => {
    const resolved = resolveAstNode(item, ctx.doc);
    const v = isScalar(resolved) ? scalarToString(resolved) : null;
    if (v !== null && listMatches(v, op.item, op.compare)) matches.push(idx);
  });
  if (matches.length === 0) return ctx.text;
  if (matches.length === value.items.length) return removeWholePair(ctx, svc, own);

  if (value.flow) {
    const sources = value.items
      .filter((_, idx) => !matches.includes(idx))
      .map((i) => itemSource(ctx, i));
    if (sources.some((s) => s === null)) return null;
    return rewriteFlowSeq(ctx, value, sources as string[]);
  }

  let text = ctx.text;
  for (const idx of [...matches].reverse()) {
    const item = value.items[idx];
    const r = rangeOf(item);
    if (!r) return null;
    const start = lineStart(text, r[0]);
    if (!/^\s*-\s*$/.test(text.slice(start, r[0]))) return null;
    const end = lineEnd(text, Math.max(contentEnd(text, item, r[1]) - 1, r[0]));
    text = splice(text, start, Math.min(text.length, end + 1), '');
  }
  return text;
}

function removeWholePair(ctx: Ctx, svc: ServiceCtx, pair: Pair): string | null {
  if (svc.svcMap.items.filter(isPair).length <= 1) return null;
  return deletePairLines(ctx, pair);
}

function setEnvValue(ctx: Ctx, op: Extract<FixOperation, { kind: 'setEnvValue' }>): string | null {
  const svc = findService(ctx, op.service);
  if (!svc) return null;
  const envPair = effectivePair(ctx, svc.svcMap, 'environment');
  if (!envPair) return null;
  const env = resolveAstNode(envPair.value, ctx.doc);

  if (isMap(env)) {
    const pair = getEffectiveMapPairs(env, ctx.doc).find((p) => keyString(p) === op.envKey);
    if (!pair || !isScalar(pair.value)) return null;
    const r = rangeOf(pair.value);
    if (!r || r[1] <= r[0]) return null;
    return splice(ctx.text, r[0], r[1], formatLike(pair.value, op.value));
  }

  if (isSeq(env)) {
    for (const item of env.items) {
      if (!isScalar(item)) continue;
      const str = scalarToString(item);
      if (str === null) continue;
      const eq = str.indexOf('=');
      if (eq === -1 || str.slice(0, eq).trim() !== op.envKey) continue;
      const r = rangeOf(item);
      if (!r) return null;
      return splice(ctx.text, r[0], r[1], formatLike(item, `${op.envKey}=${op.value}`));
    }
  }
  return null;
}

function bindPortHostIp(
  ctx: Ctx,
  op: Extract<FixOperation, { kind: 'bindPortHostIp' }>,
): string | null {
  const svc = findService(ctx, op.service);
  if (!svc) return null;
  const portsPair = ownPair(svc.svcMap, 'ports');
  if (!portsPair || !isSeq(portsPair.value)) return null;
  const item = portsPair.value.items[op.index];
  if (!item || isAlias(item)) return null;
  const hostIp = op.hostIp.includes(':') ? `[${op.hostIp}]` : op.hostIp;

  if (isScalar(item)) {
    const raw = scalarToString(item);
    const r = rangeOf(item);
    if (raw === null || !r) return null;
    const port = parseShortPort(raw, { line: 1 });
    const proto = port.protocol !== 'tcp' || /\/tcp$/i.test(raw) ? `/${port.protocol}` : '';
    const spec = `${hostIp}:${port.published ?? ''}:${port.target}${proto}`;
    return splice(ctx.text, r[0], r[1], formatLike(item, spec, true));
  }

  if (isBlockMap(item)) {
    const existing = ownPair(item, 'host_ip');
    if (existing && isScalar(existing.value) && rangeOf(existing.value)) {
      const r = rangeOf(existing.value)!;
      return splice(ctx.text, r[0], r[1], formatLike(existing.value, op.hostIp, true));
    }
    return appendToMap(ctx, item, [`host_ip: ${JSON.stringify(op.hostIp)}`]);
  }
  return null;
}

function setNested(ctx: Ctx, op: Extract<FixOperation, { kind: 'setNested' }>): string | null {
  const svc = findService(ctx, op.service);
  if (!svc || op.path.length === 0) return null;

  let map: YAMLMap = svc.svcMap;
  for (let i = 0; i < op.path.length; i++) {
    const key = op.path[i]!;
    const isLast = i === op.path.length - 1;
    const own = ownPair(map, key);

    if (!own) {
      // Overriding an inherited mapping would drop the keys it inherits
      if (effectivePair(ctx, map, key)) return null;
      let render: Render = { scalar: op.value };
      for (let j = op.path.length - 1; j > i; j--) {
        render = { map: [[op.path[j]!, render]] };
      }
      return appendToMap(ctx, map, renderEntry(key, render, ctx.indentUnit));
    }

    if (isLast) {
      if (isScalar(own.value) && rangeOf(own.value) && own.value.value !== null) {
        const r = rangeOf(own.value)!;
        return splice(ctx.text, r[0], r[1], formatLike(own.value, op.value));
      }
      if (own.value === null || (isScalar(own.value) && own.value.value === null)) {
        return replacePairLines(ctx, own, [`${key}: ${formatScalar(op.value)}`]);
      }
      return null;
    }

    if (own.value === null || (isScalar(own.value) && own.value.value === null)) {
      let render: Render = { scalar: op.value };
      for (let j = op.path.length - 1; j > i; j--) {
        render = { map: [[op.path[j]!, render]] };
      }
      return replacePairLines(ctx, own, renderEntry(key, render, ctx.indentUnit));
    }
    if (!isBlockMap(own.value)) return null;
    map = own.value;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

function createCtx(text: string): Ctx | null {
  const doc = parseDocument(text, { uniqueKeys: false, strict: false });
  if (doc.errors.length > 0) return null;
  return { text, doc, indentUnit: detectIndentUnit(text, doc) };
}

/** Apply one operation; returns the new text or null if it cannot be applied safely. */
export function applyFixOperation(yamlText: string, op: FixOperation): string | null {
  const ctx = createCtx(yamlText);
  if (!ctx) return null;
  switch (op.kind) {
    case 'setScalar':
      return setScalar(ctx, op);
    case 'removeKey':
      return removeKey(ctx, op);
    case 'addListItem':
      return addListItem(ctx, op);
    case 'removeListItem':
      return removeListItem(ctx, op);
    case 'setEnvValue':
      return setEnvValue(ctx, op);
    case 'bindPortHostIp':
      return bindPortHostIp(ctx, op);
    case 'setNested':
      return setNested(ctx, op);
  }
}

/**
 * Apply all operations of an autofix in order. Returns null if any step
 * fails or the result is no longer valid YAML, so a fix is all-or-nothing.
 */
export function applyAutofix(yamlText: string, autofix: Autofix): string | null {
  let text = yamlText;
  for (const op of autofix.operations) {
    const next = applyFixOperation(text, op);
    if (next === null) return null;
    text = next;
  }
  const check = parseDocument(text, { uniqueKeys: false, strict: false });
  if (check.errors.length > 0) return null;
  return text;
}

/** Apply a finding's autofix, or return null when it has none or it cannot be applied. */
export function applyFindingFix(yamlText: string, finding: Finding): string | null {
  if (!finding.autofix) return null;
  return applyAutofix(yamlText, finding.autofix);
}

/* ------------------------------------------------------------------ */
/* Fix all                                                             */
/* ------------------------------------------------------------------ */

/** Stable identity of a finding across re-analysis (line numbers shift as fixes land). */
export function findingKey(finding: Finding): string {
  return `${finding.ruleId}|${finding.service}|${finding.message}`;
}

export interface BulkFixResult {
  text: string;
  applied: Finding[];
  /** Selected findings whose fix could not be applied safely */
  skipped: Finding[];
}

/**
 * Apply many autofixes at once. Fixes are applied one at a time with a fresh
 * analysis in between, because each edit shifts lines and list indexes.
 * Only findings whose key is in `selected` are fixed (all fixable ones when
 * `selected` is omitted).
 */
export function applyAutofixes(
  yamlText: string,
  options: AnalyzeOptions & { selected?: ReadonlySet<string> } = {},
): BulkFixResult {
  let text = yamlText;
  const applied: Finding[] = [];
  const done = new Set<string>();
  const skipped = new Map<string, Finding>();

  for (let guard = 0; guard < 500; guard++) {
    const result = analyzeCompose(text, options);
    if (!result.ok) break;
    const next = result.findings.find((f) => {
      if (!f.autofix) return false;
      const key = findingKey(f);
      if (done.has(key) || skipped.has(key)) return false;
      return !options.selected || options.selected.has(key);
    });
    if (!next) break;
    const key = findingKey(next);
    const fixed = applyFindingFix(text, next);
    if (fixed === null || fixed === text) {
      skipped.set(key, next);
      continue;
    }
    text = fixed;
    done.add(key);
    applied.push(next);
  }

  return { text, applied, skipped: Array.from(skipped.values()) };
}
