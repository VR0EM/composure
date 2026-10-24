import {
  Document,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  Pair,
  Scalar,
  YAMLMap,
} from 'yaml';
import {
  BUILD_KEYS,
  DEPENDS_ON_CONDITIONS,
  DEPENDS_ON_KEYS,
  DEPLOY_KEYS,
  HEALTHCHECK_KEYS,
  LOGGING_KEYS,
  NETWORK_KEYS,
  SERVICE_KEYS,
  TOP_LEVEL_KEYS,
  VOLUME_KEYS,
  suggestKey,
} from './composeSchema';
import { ComposeDiagnostic } from './types';

/**
 * Diagnostics that need the raw YAML syntax tree rather than the normalized
 * model: unknown keys (typos), duplicate keys, and YAML 1.1 port pitfalls.
 */
export function collectAstDiagnostics(
  doc: Document,
  lineCounter: LineCounter,
): ComposeDiagnostic[] {
  const diagnostics: ComposeDiagnostic[] = [];
  const root = doc.contents;
  if (!isMap(root)) return diagnostics;

  const locate = (node: unknown) => {
    const range = (node as { range?: [number, number, number?] } | null)?.range;
    if (!range) return { line: 1 };
    const pos = lineCounter.linePos(range[0]);
    return { line: pos.line, column: pos.col };
  };

  const keyOf = (pair: Pair): string | null => {
    if (!isScalar(pair.key)) return null;
    const key = pair.key as Scalar;
    // With `merge: true`, the yaml library turns `<<` into a symbol
    if (typeof key.value === 'symbol' || key.source === '<<') return '<<';
    return key.value === null || key.value === undefined ? null : String(key.value);
  };

  const checkKeys = (
    map: YAMLMap,
    known: readonly string[],
    context: string,
    service?: string,
  ) => {
    for (const item of map.items) {
      if (!isPair(item)) continue;
      const key = keyOf(item);
      if (key === null || key === '<<' || key.startsWith('x-')) continue;
      if ((known as readonly string[]).includes(key)) continue;
      const suggestion = suggestKey(key, known);
      diagnostics.push({
        code: 'unknown-key',
        severity: 'warning',
        message: suggestion
          ? `Unknown ${context} key \`${key}\`. Did you mean \`${suggestion}\`?`
          : `Unknown ${context} key \`${key}\`. Docker Compose rejects keys that are not in the Compose Specification.`,
        ...locate(item.key),
        ...(service ? { service } : {}),
      });
    }
  };

  const findPair = (map: YAMLMap, key: string): Pair | undefined => {
    let found: Pair | undefined;
    for (const item of map.items) {
      if (isPair(item) && keyOf(item) === key) found = item;
    }
    return found;
  };

  // 1. Duplicate keys anywhere in the document (Compose's YAML parser rejects them)
  const visit = (node: unknown, seen: Set<unknown>) => {
    if (!node || typeof node !== 'object' || isAlias(node) || seen.has(node)) return;
    seen.add(node);
    if (isMap(node)) {
      const firstLine = new Map<string, number>();
      for (const item of node.items) {
        if (!isPair(item)) continue;
        const key = keyOf(item);
        if (key !== null && key !== '<<') {
          const loc = locate(item.key);
          const previous = firstLine.get(key);
          if (previous !== undefined) {
            diagnostics.push({
              code: 'duplicate-key',
              severity: 'error',
              message: `Duplicate key \`${key}\` (first defined on line ${previous}). Docker Compose refuses files with duplicate keys.`,
              ...loc,
            });
          } else {
            firstLine.set(key, loc.line);
          }
        }
        visit(item.value, seen);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) visit(item, seen);
    }
  };
  visit(root, new Set());

  // 2. Unknown top-level keys
  checkKeys(root, TOP_LEVEL_KEYS, 'top-level');

  // 3. Unknown keys in services and common nested blocks
  const servicesPair = findPair(root, 'services');
  if (servicesPair && isMap(servicesPair.value)) {
    for (const svcItem of servicesPair.value.items) {
      if (!isPair(svcItem)) continue;
      const serviceName = keyOf(svcItem);
      if (!serviceName || serviceName.startsWith('x-')) continue;
      const svc = svcItem.value;
      if (!isMap(svc)) continue;
      checkKeys(svc, SERVICE_KEYS, 'service', serviceName);

      const nested: Array<[string, readonly string[], string]> = [
        ['healthcheck', HEALTHCHECK_KEYS, 'healthcheck'],
        ['logging', LOGGING_KEYS, 'logging'],
        ['deploy', DEPLOY_KEYS, 'deploy'],
        ['build', BUILD_KEYS, 'build'],
      ];
      for (const [key, known, label] of nested) {
        const pair = findPair(svc, key);
        if (pair && isMap(pair.value)) checkKeys(pair.value, known, label, serviceName);
      }

      const depends = findPair(svc, 'depends_on');
      if (depends && isMap(depends.value)) {
        for (const dep of depends.value.items) {
          if (!isPair(dep) || !isMap(dep.value)) continue;
          checkKeys(dep.value, DEPENDS_ON_KEYS, 'depends_on', serviceName);
          const cond = findPair(dep.value, 'condition');
          if (cond && isScalar(cond.value)) {
            const value = String(cond.value.value ?? '');
            if (
              value &&
              !value.includes('${') &&
              !(DEPENDS_ON_CONDITIONS as readonly string[]).includes(value)
            ) {
              const suggestion = suggestKey(value, DEPENDS_ON_CONDITIONS);
              diagnostics.push({
                code: 'invalid-value',
                severity: 'error',
                message: `Invalid depends_on condition \`${value}\`.${suggestion ? ` Did you mean \`${suggestion}\`?` : ''} Valid values: ${DEPENDS_ON_CONDITIONS.join(', ')}.`,
                ...locate(cond.value),
                service: serviceName,
              });
            }
          }
        }
      }

      // YAML 1.1 parsers read unquoted `22:22` as a base-60 number
      const ports = findPair(svc, 'ports');
      if (ports && isSeq(ports.value)) {
        for (const item of ports.value.items) {
          if (!isScalar(item) || item.type !== 'PLAIN') continue;
          const raw = item.source ?? String(item.value);
          if (/^[1-9][0-9_]*(:[0-5]?[0-9])+$/.test(raw)) {
            diagnostics.push({
              code: 'unquoted-port',
              severity: 'warning',
              message: `Quote the port mapping \`${raw}\`: YAML 1.1 parsers read unquoted \`xx:yy\` values below 60 as a base-60 number.`,
              ...locate(item),
              service: serviceName,
            });
          }
        }
      }
    }
  }

  // 4. Unknown keys in top-level networks / volumes entries
  for (const [section, known] of [
    ['networks', NETWORK_KEYS],
    ['volumes', VOLUME_KEYS],
  ] as const) {
    const pair = findPair(root, section);
    if (!pair || !isMap(pair.value)) continue;
    for (const entry of pair.value.items) {
      if (isPair(entry) && isMap(entry.value)) {
        checkKeys(entry.value, known, section === 'networks' ? 'network' : 'volume');
      }
    }
  }

  return diagnostics;
}
