import {
  Document,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  Pair,
  YAMLMap,
} from 'yaml';
import {
  BuildConfig,
  ComposeModel,
  ComposeParseError,
  DeviceMapping,
  EnvironmentEntry,
  ExposePort,
  HealthcheckConfig,
  LocatedString,
  NormalizedNetwork,
  NormalizedService,
  NormalizedVolume,
  PortMapping,
  ResourceLimits,
  ServiceDependency,
  ServiceNetwork,
  SourceLocation,
  VolumeMount,
  VolumeMountType,
} from './types';

/**
 * Extract 1-based line and column locations from any YAML AST node or Pair.
 */
export function getNodeLocation(
  node: unknown,
  lineCounter: LineCounter,
  fallbackLine = 1,
): SourceLocation {
  if (!node || typeof node !== 'object') {
    return { line: fallbackLine };
  }

  if (isPair(node)) {
    const keyLoc = getNodeLocation(node.key, lineCounter, fallbackLine);
    const valLoc = node.value
      ? getNodeLocation(node.value, lineCounter, keyLoc.line)
      : keyLoc;
    return {
      line: keyLoc.line,
      column: keyLoc.column,
      endLine: valLoc.endLine ?? valLoc.line,
    };
  }

  const range = (node as { range?: [number, number, number?] }).range;
  if (Array.isArray(range) && typeof range[0] === 'number') {
    const start = lineCounter.linePos(range[0]);
    const endOffset =
      typeof range[1] === 'number' && range[1] > range[0]
        ? range[1] - 1
        : range[0];
    const end = lineCounter.linePos(endOffset);
    return {
      line: start.line,
      column: start.col,
      endLine: Math.max(start.line, end.line),
    };
  }

  return { line: fallbackLine };
}

/**
 * Resolve YAML Alias nodes recursively with cycle protection.
 */
export function resolveAstNode(
  node: unknown,
  doc: Document,
  visited = new Set<unknown>(),
): unknown {
  if (!node || typeof node !== 'object') {
    return node;
  }
  if (visited.has(node)) {
    return null;
  }
  if (isAlias(node)) {
    visited.add(node);
    const resolved = node.resolve(doc);
    return resolveAstNode(resolved, doc, visited);
  }
  return node;
}

function isMergePairKey(keyNode: unknown): boolean {
  if (!keyNode || typeof keyNode !== 'object') return false;
  if (isScalar(keyNode)) {
    if (keyNode.value === '<<') return true;
    if ((keyNode as { source?: string }).source === '<<') return true;
  }
  return false;
}

/**
 * Expand a YAMLMap into its effective Pair list, resolving `<<` merge keys
 * and aliases while preserving explicit key overrides and source locations.
 */
export function getEffectiveMapPairs(
  mapNode: YAMLMap,
  doc: Document,
  visited = new Set<unknown>(),
): Pair[] {
  if (visited.has(mapNode)) {
    return [];
  }
  visited.add(mapNode);

  const explicitPairs: Pair[] = [];
  const mergedPairsList: Pair[][] = [];

  for (const item of mapNode.items) {
    if (!isPair(item)) continue;
    if (isMergePairKey(item.key)) {
      const resolvedVal = resolveAstNode(item.value, doc);
      if (isMap(resolvedVal)) {
        mergedPairsList.push(
          getEffectiveMapPairs(resolvedVal, doc, new Set(visited)),
        );
      } else if (isSeq(resolvedVal)) {
        for (const seqItem of resolvedVal.items) {
          const resolvedSeqItem = resolveAstNode(seqItem, doc);
          if (isMap(resolvedSeqItem)) {
            mergedPairsList.push(
              getEffectiveMapPairs(resolvedSeqItem, doc, new Set(visited)),
            );
          }
        }
      }
    } else {
      const keyStr = scalarToString(item.key);
      if (keyStr !== null) {
        explicitPairs.push(item);
      }
    }
  }

  // Deduplicate explicit pairs (last wins in YAML override)
  const finalExplicitByKey = new Map<string, Pair>();
  for (const pair of explicitPairs) {
    const k = scalarToString(pair.key);
    if (k !== null) {
      finalExplicitByKey.set(k, pair);
    }
  }

  const seenKeys = new Set<string>(finalExplicitByKey.keys());
  const inheritedPairs: Pair[] = [];

  // In YAML merge spec, earlier items in `<<: [*a, *b]` take precedence over later ones
  for (const mergedGroup of mergedPairsList) {
    for (const pair of mergedGroup) {
      const k = scalarToString(pair.key);
      if (k !== null && !seenKeys.has(k)) {
        seenKeys.add(k);
        inheritedPairs.push(pair);
      }
    }
  }

  return [... inheritedPairs, ...Array.from(finalExplicitByKey.values())];
}

export function scalarToString(node: unknown): string | null {
  if (node === null || node === undefined) return null;
  if (isScalar(node)) {
    if (node.value === null || node.value === undefined) return null;
    return String(node.value);
  }
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }
  return null;
}

export function scalarToBoolean(node: unknown): boolean | undefined {
  if (isScalar(node)) {
    if (typeof node.value === 'boolean') return node.value;
    if (typeof node.value === 'string') {
      const lower = node.value.toLowerCase().trim();
      if (lower === 'true' || lower === 'yes' || lower === 'on') return true;
      if (lower === 'false' || lower === 'no' || lower === 'off') return false;
    }
  }
  if (typeof node === 'boolean') return node;
  return undefined;
}

/**
 * Splits a string on colons `:` that are outside `${...}` variable interpolation
 * blocks, `[...]` IPv6 address brackets, and Windows drive letters.
 */
export function splitColonOutsideInterpolation(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '{') {
      braceDepth++;
      current += ch;
    } else if (ch === '}') {
      if (braceDepth > 0) braceDepth--;
      current += ch;
    } else if (ch === '[') {
      bracketDepth++;
      current += ch;
    } else if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
      current += ch;
    } else if (ch === ':' && braceDepth === 0 && bracketDepth === 0) {
      const isWindowsDrive =
        current.length === 1 &&
        /^[a-zA-Z]$/.test(current) &&
        (input[i + 1] === '\\' || input[i + 1] === '/');
      if (isWindowsDrive) {
        current += ch;
      } else {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  parts.push(current);
  return parts;
}

/**
 * Parse a short-syntax port string, e.g.:
 * - "80"
 * - "8080:80"
 * - "8080:80/udp"
 * - "127.0.0.1:8080:80"
 * - "127.0.0.1::80"
 * - "[::1]:8080:80"
 * - "8080-8085:80-85/tcp"
 * - "${HOST_IP:-127.0.0.1}:${PORT:-8080}:80"
 */
export function parseShortPort(
  rawInput: string,
  loc: SourceLocation,
): PortMapping {
  const raw = rawInput.trim();
  const parts = splitColonOutsideInterpolation(raw);

  const lastPart = parts[parts.length - 1] ?? '';
  let target = lastPart;
  let protocol = 'tcp';

  const protoMatch = /^(.*)\/([a-zA-Z0-9_-]+)$/.exec(lastPart);
  if (protoMatch && protoMatch[1] !== undefined && protoMatch[2] !== undefined) {
    target = protoMatch[1];
    protocol = protoMatch[2].toLowerCase();
  }

  let hostIp: string | undefined;
  let published: string | undefined;

  if (parts.length === 1) {
    published = undefined;
  } else if (parts.length === 2) {
    published = parts[0] !== '' ? parts[0] : undefined;
  } else if (parts.length >= 3) {
    const rawIp = parts.slice(0, parts.length - 2).join(':');
    hostIp =
      rawIp.startsWith('[') && rawIp.endsWith(']')
        ? rawIp.slice(1, -1)
        : rawIp || undefined;
    const pubPart = parts[parts.length - 2];
    published = pubPart !== '' ? pubPart : undefined;
  }

  return {
    ...loc,
    ...(hostIp !== undefined ? { hostIp } : {}),
    ...(published !== undefined ? { published } : {}),
    target,
    protocol,
    raw,
    syntax: 'short',
  };
}

/**
 * Parse an expose entry, e.g. "3000" or "5432/tcp".
 */
export function parseExposePort(
  rawInput: string,
  loc: SourceLocation,
): ExposePort {
  const raw = rawInput.trim();
  const protoMatch = /^(.*)\/([a-zA-Z0-9_-]+)$/.exec(raw);
  if (protoMatch && protoMatch[1] !== undefined && protoMatch[2] !== undefined) {
    return {
      ...loc,
      port: protoMatch[1],
      protocol: protoMatch[2].toLowerCase(),
    };
  }
  return {
    ...loc,
    port: raw,
    protocol: 'tcp',
  };
}

/**
 * Determine whether a volume mount source string refers to a host bind path
 * rather than a named Docker volume.
 */
export function isBindMountSource(
  source: string,
  declaredVolumes: Set<string>,
): boolean {
  if (declaredVolumes.has(source)) {
    return false;
  }
  if (
    source === '.' ||
    source === '..' ||
    source.startsWith('/') ||
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('~') ||
    source.includes('/') ||
    source.includes('\\')
  ) {
    return true;
  }
  return false;
}

/**
 * Parse a short-syntax volume string, e.g.:
 * - "/var/lib/mysql" (anonymous volume)
 * - "db_data:/var/lib/postgresql/data" (named volume)
 * - "./config:/etc/config:ro" (bind mount, read-only)
 * - "/var/run/docker.sock:/var/run/docker.sock:ro,z" (bind mount, read-only)
 */
export function parseShortVolume(
  rawInput: string,
  loc: SourceLocation,
  declaredVolumes: Set<string>,
): VolumeMount {
  const raw = rawInput.trim();
  const parts = splitColonOutsideInterpolation(raw);

  if (parts.length === 1) {
    return {
      ...loc,
      type: 'volume',
      target: parts[0] ?? raw,
      readOnly: false,
      syntax: 'short',
    };
  }

  const source = parts[0] ?? '';
  const target = parts[1] ?? '';
  const modeStr = parts.length >= 3 ? parts.slice(2).join(':') : undefined;

  const modes = modeStr
    ? modeStr
        .split(',')
        .map((m) => m.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const readOnly = modes.includes('ro') || modes.includes('readonly');
  const type: VolumeMountType = isBindMountSource(source, declaredVolumes)
    ? 'bind'
    : 'volume';

  return {
    ...loc,
    type,
    source,
    target,
    readOnly,
    ...(modeStr !== undefined ? { mode: modeStr } : {}),
    syntax: 'short',
  };
}

/**
 * Parse a `tmpfs` mount entry, e.g. "/run" or "/tmp:ro,size=64m".
 */
export function parseTmpfsEntry(
  rawInput: string,
  loc: SourceLocation,
): VolumeMount {
  const raw = rawInput.trim();
  const parts = splitColonOutsideInterpolation(raw);
  const target = parts[0] ?? raw;
  const modeStr = parts.length >= 2 ? parts.slice(1).join(':') : undefined;
  const modes = modeStr
    ? modeStr
        .split(',')
        .map((m) => m.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const readOnly = modes.includes('ro') || modes.includes('readonly');

  return {
    ...loc,
    type: 'tmpfs',
    target,
    readOnly,
    ...(modeStr !== undefined ? { mode: modeStr } : {}),
    syntax: 'tmpfs',
  };
}

/**
 * Parse a short-syntax device mapping, e.g. "/dev/ttyUSB0:/dev/ttyUSB0:rwm".
 */
export function parseShortDevice(
  rawInput: string,
  loc: SourceLocation,
): DeviceMapping {
  const raw = rawInput.trim();
  const parts = splitColonOutsideInterpolation(raw);
  const source = parts[0] ?? raw;
  const target = parts[1];
  const permissions = parts[2];

  return {
    ...loc,
    source,
    ...(target !== undefined ? { target } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
    raw,
  };
}

function getMapFieldMap(
  mapNode: YAMLMap,
  doc: Document,
): Map<string, Pair> {
  const pairs = getEffectiveMapPairs(mapNode, doc);
  const result = new Map<string, Pair>();
  for (const pair of pairs) {
    const key = scalarToString(pair.key);
    if (key !== null) {
      result.set(key, pair);
    }
  }
  return result;
}

function normalizePorts(
  node: unknown,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): PortMapping[] {
  const resolved = resolveAstNode(node, doc);
  if (!isSeq(resolved)) return [];

  const ports: PortMapping[] = [];
  for (const item of resolved.items) {
    const resolvedItem = resolveAstNode(item, doc);
    const loc = getNodeLocation(item, lineCounter, fallbackLine);

    if (isScalar(resolvedItem)) {
      const str = scalarToString(resolvedItem);
      if (str !== null && str.trim() !== '') {
        ports.push(parseShortPort(str, loc));
      }
    } else if (isMap(resolvedItem)) {
      const fields = getMapFieldMap(resolvedItem, doc);
      const targetStr = scalarToString(
        resolveAstNode(fields.get('target')?.value, doc),
      );
      if (!targetStr) continue;

      const publishedStr = scalarToString(
        resolveAstNode(fields.get('published')?.value, doc),
      );
      const hostIpStr = scalarToString(
        resolveAstNode(fields.get('host_ip')?.value, doc),
      );
      const protocolStr =
        scalarToString(resolveAstNode(fields.get('protocol')?.value, doc))?.toLowerCase() ??
        'tcp';
      const modeStr = scalarToString(
        resolveAstNode(fields.get('mode')?.value, doc),
      );

      const rawParts = [
        hostIpStr ? `${hostIpStr}:` : '',
        publishedStr ? `${publishedStr}:` : '',
        targetStr,
        protocolStr !== 'tcp' ? `/${protocolStr}` : '',
      ];

      ports.push({
        ...loc,
        ...(hostIpStr ? { hostIp: hostIpStr } : {}),
        ...(publishedStr ? { published: publishedStr } : {}),
        target: targetStr,
        protocol: protocolStr,
        ...(modeStr ? { mode: modeStr } : {}),
        raw: rawParts.join(''),
        syntax: 'long',
      });
    }
  }
  return ports;
}

function normalizeExpose(
  node: unknown,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): ExposePort[] {
  const resolved = resolveAstNode(node, doc);
  if (!isSeq(resolved)) return [];

  const result: ExposePort[] = [];
  for (const item of resolved.items) {
    const resolvedItem = resolveAstNode(item, doc);
    const str = scalarToString(resolvedItem);
    if (str !== null && str.trim() !== '') {
      const loc = getNodeLocation(item, lineCounter, fallbackLine);
      result.push(parseExposePort(str, loc));
    }
  }
  return result;
}

function normalizeVolumes(
  volumesNode: unknown,
  tmpfsNode: unknown,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
  declaredVolumes: Set<string>,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];

  const resolvedVolumes = resolveAstNode(volumesNode, doc);
  if (isSeq(resolvedVolumes)) {
    for (const item of resolvedVolumes.items) {
      const resolvedItem = resolveAstNode(item, doc);
      const loc = getNodeLocation(item, lineCounter, fallbackLine);

      if (isScalar(resolvedItem)) {
        const str = scalarToString(resolvedItem);
        if (str !== null && str.trim() !== '') {
          mounts.push(parseShortVolume(str, loc, declaredVolumes));
        }
      } else if (isMap(resolvedItem)) {
        const fields = getMapFieldMap(resolvedItem, doc);
        const rawType = scalarToString(
          resolveAstNode(fields.get('type')?.value, doc),
        )?.toLowerCase();
        const source =
          scalarToString(resolveAstNode(fields.get('source')?.value, doc)) ??
          scalarToString(resolveAstNode(fields.get('src')?.value, doc)) ??
          undefined;
        const target =
          scalarToString(resolveAstNode(fields.get('target')?.value, doc)) ??
          scalarToString(resolveAstNode(fields.get('destination')?.value, doc)) ??
          scalarToString(resolveAstNode(fields.get('dst')?.value, doc));

        if (!target) continue;

        let type: VolumeMountType = 'volume';
        if (rawType === 'bind') {
          type = 'bind';
        } else if (rawType === 'tmpfs') {
          type = 'tmpfs';
        } else if (rawType === 'volume') {
          type = 'volume';
        } else if (source && isBindMountSource(source, declaredVolumes)) {
          type = 'bind';
        }

        const readOnlyVal =
          scalarToBoolean(resolveAstNode(fields.get('read_only')?.value, doc)) ??
          false;

        mounts.push({
          ...loc,
          type,
          ...(source !== undefined && type !== 'tmpfs' ? { source } : {}),
          target,
          readOnly: readOnlyVal,
          syntax: 'long',
        });
      }
    }
  }

  const resolvedTmpfs = resolveAstNode(tmpfsNode, doc);
  if (isScalar(resolvedTmpfs)) {
    const str = scalarToString(resolvedTmpfs);
    if (str !== null && str.trim() !== '') {
      const loc = getNodeLocation(tmpfsNode, lineCounter, fallbackLine);
      mounts.push(parseTmpfsEntry(str, loc));
    }
  } else if (isSeq(resolvedTmpfs)) {
    for (const item of resolvedTmpfs.items) {
      const resolvedItem = resolveAstNode(item, doc);
      const str = scalarToString(resolvedItem);
      if (str !== null && str.trim() !== '') {
        const loc = getNodeLocation(item, lineCounter, fallbackLine);
        mounts.push(parseTmpfsEntry(str, loc));
      }
    }
  }

  return mounts;
}

function normalizeServiceNetworks(
  node: unknown,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): ServiceNetwork[] {
  const resolved = resolveAstNode(node, doc);
  if (!resolved) return [];

  const networks: ServiceNetwork[] = [];

  if (isSeq(resolved)) {
    for (const item of resolved.items) {
      const resolvedItem = resolveAstNode(item, doc);
      const name = scalarToString(resolvedItem);
      if (name) {
        const loc = getNodeLocation(item, lineCounter, fallbackLine);
        networks.push({
          ...loc,
          name,
          syntax: 'short',
        });
      }
    }
  } else if (isMap(resolved)) {
    const pairs = getEffectiveMapPairs(resolved, doc);
    for (const pair of pairs) {
      const name = scalarToString(pair.key);
      if (!name || name.startsWith('x-')) continue;
      const loc = getNodeLocation(pair, lineCounter, fallbackLine);
      const val = resolveAstNode(pair.value, doc);

      let aliases: string[] | undefined;
      let ipv4Address: string | undefined;
      let ipv6Address: string | undefined;

      if (isMap(val)) {
        const netFields = getMapFieldMap(val, doc);
        const aliasesNode = resolveAstNode(netFields.get('aliases')?.value, doc);
        if (isSeq(aliasesNode)) {
          aliases = aliasesNode.items
            .map((a) => scalarToString(resolveAstNode(a, doc)))
            .filter((a): a is string => a !== null);
        }
        ipv4Address =
          scalarToString(resolveAstNode(netFields.get('ipv4_address')?.value, doc)) ??
          undefined;
        ipv6Address =
          scalarToString(resolveAstNode(netFields.get('ipv6_address')?.value, doc)) ??
          undefined;
      }

      networks.push({
        ...loc,
        name,
        ...(aliases && aliases.length > 0 ? { aliases } : {}),
        ...(ipv4Address ? { ipv4Address } : {}),
        ...(ipv6Address ? { ipv6Address } : {}),
        syntax: 'long',
      });
    }
  }

  return networks;
}

function normalizeEnvironment(
  node: unknown,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): EnvironmentEntry[] {
  const resolved = resolveAstNode(node, doc);
  if (!resolved) return [];

  const entries: EnvironmentEntry[] = [];

  if (isSeq(resolved)) {
    for (const item of resolved.items) {
      const resolvedItem = resolveAstNode(item, doc);
      const raw = scalarToString(resolvedItem);
      if (raw === null) continue;
      const loc = getNodeLocation(item, lineCounter, fallbackLine);
      const eqIdx = raw.indexOf('=');
      if (eqIdx === -1) {
        entries.push({
          ...loc,
          key: raw.trim(),
          value: null,
          syntax: 'list',
        });
      } else {
        const key = raw.slice(0, eqIdx).trim();
        const value = raw.slice(eqIdx + 1);
        entries.push({
          ...loc,
          key,
          value,
          syntax: 'list',
        });
      }
    }
  } else if (isMap(resolved)) {
    const pairs = getEffectiveMapPairs(resolved, doc);
    for (const pair of pairs) {
      const key = scalarToString(pair.key);
      if (!key) continue;
      const loc = getNodeLocation(pair, lineCounter, fallbackLine);
      const resolvedVal = resolveAstNode(pair.value, doc);
      const value = scalarToString(resolvedVal);
      entries.push({
        ...loc,
        key,
        value,
        syntax: 'map',
      });
    }
  }

  return entries;
}

function normalizeDependsOn(
  node: unknown,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): ServiceDependency[] {
  const resolved = resolveAstNode(node, doc);
  if (!resolved) return [];

  const deps: ServiceDependency[] = [];

  if (isSeq(resolved)) {
    for (const item of resolved.items) {
      const resolvedItem = resolveAstNode(item, doc);
      const target = scalarToString(resolvedItem);
      if (target) {
        const loc = getNodeLocation(item, lineCounter, fallbackLine);
        deps.push({
          ...loc,
          target,
          condition: 'service_started',
          syntax: 'short',
        });
      }
    }
  } else if (isMap(resolved)) {
    const pairs = getEffectiveMapPairs(resolved, doc);
    for (const pair of pairs) {
      const target = scalarToString(pair.key);
      if (!target || target.startsWith('x-')) continue;
      const loc = getNodeLocation(pair, lineCounter, fallbackLine);
      const val = resolveAstNode(pair.value, doc);

      let condition = 'service_started';
      let restart: boolean | undefined;
      let required: boolean | undefined;

      if (isMap(val)) {
        const fields = getMapFieldMap(val, doc);
        const condStr = scalarToString(
          resolveAstNode(fields.get('condition')?.value, doc),
        );
        if (condStr) condition = condStr;
        restart = scalarToBoolean(
          resolveAstNode(fields.get('restart')?.value, doc),
        );
        required = scalarToBoolean(
          resolveAstNode(fields.get('required')?.value, doc),
        );
      }

      deps.push({
        ...loc,
        target,
        condition,
        ...(restart !== undefined ? { restart } : {}),
        ...(required !== undefined ? { required } : {}),
        syntax: 'long',
      });
    }
  }

  return deps;
}

function normalizeLocatedStringList(
  node: unknown,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): LocatedString[] {
  const resolved = resolveAstNode(node, doc);
  if (!resolved) return [];

  if (isScalar(resolved)) {
    const val = scalarToString(resolved);
    if (val !== null) {
      return [{ ...getNodeLocation(node, lineCounter, fallbackLine), value: val }];
    }
    return [];
  }

  if (isSeq(resolved)) {
    const items: LocatedString[] = [];
    for (const item of resolved.items) {
      const resolvedItem = resolveAstNode(item, doc);
      const val = scalarToString(resolvedItem);
      if (val !== null) {
        items.push({
          ...getNodeLocation(item, lineCounter, fallbackLine),
          value: val,
        });
      }
    }
    return items;
  }

  return [];
}

function normalizeEnvFile(
  node: unknown,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): LocatedString[] {
  const resolved = resolveAstNode(node, doc);
  if (!resolved) return [];

  if (isScalar(resolved)) {
    const val = scalarToString(resolved);
    return val
      ? [{ ...getNodeLocation(node, lineCounter, fallbackLine), value: val }]
      : [];
  }

  if (isSeq(resolved)) {
    const result: LocatedString[] = [];
    for (const item of resolved.items) {
      const resolvedItem = resolveAstNode(item, doc);
      const loc = getNodeLocation(item, lineCounter, fallbackLine);
      if (isScalar(resolvedItem)) {
        const val = scalarToString(resolvedItem);
        if (val) result.push({ ...loc, value: val });
      } else if (isMap(resolvedItem)) {
        const fields = getMapFieldMap(resolvedItem, doc);
        const pathVal = scalarToString(
          resolveAstNode(fields.get('path')?.value, doc),
        );
        if (pathVal) result.push({ ...loc, value: pathVal });
      }
    }
    return result;
  }

  return [];
}

function normalizeDevices(
  node: unknown,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): DeviceMapping[] {
  const resolved = resolveAstNode(node, doc);
  if (!isSeq(resolved)) return [];

  const devices: DeviceMapping[] = [];
  for (const item of resolved.items) {
    const resolvedItem = resolveAstNode(item, doc);
    const loc = getNodeLocation(item, lineCounter, fallbackLine);
    if (isScalar(resolvedItem)) {
      const str = scalarToString(resolvedItem);
      if (str) {
        devices.push(parseShortDevice(str, loc));
      }
    } else if (isMap(resolvedItem)) {
      const fields = getMapFieldMap(resolvedItem, doc);
      const source = scalarToString(
        resolveAstNode(fields.get('source')?.value, doc),
      );
      if (!source) continue;
      const target =
        scalarToString(resolveAstNode(fields.get('target')?.value, doc)) ??
        undefined;
      const permissions =
        scalarToString(resolveAstNode(fields.get('permissions')?.value, doc)) ??
        undefined;
      devices.push({
        ...loc,
        source,
        ...(target ? { target } : {}),
        ...(permissions ? { permissions } : {}),
        raw: [source, target, permissions].filter(Boolean).join(':'),
      });
    }
  }
  return devices;
}

function normalizeHealthcheck(
  pair: Pair,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): HealthcheckConfig | undefined {
  const resolved = resolveAstNode(pair.value, doc);
  if (!isMap(resolved)) return undefined;

  const loc = getNodeLocation(pair, lineCounter, fallbackLine);
  const fields = getMapFieldMap(resolved, doc);

  const disable = scalarToBoolean(
    resolveAstNode(fields.get('disable')?.value, doc),
  );
  const testNode = resolveAstNode(fields.get('test')?.value, doc);
  let test: string | string[] | undefined;
  if (isScalar(testNode)) {
    test = scalarToString(testNode) ?? undefined;
  } else if (isSeq(testNode)) {
    test = testNode.items
      .map((i) => scalarToString(resolveAstNode(i, doc)))
      .filter((s): s is string => s !== null);
  }

  const interval =
    scalarToString(resolveAstNode(fields.get('interval')?.value, doc)) ??
    undefined;
  const timeout =
    scalarToString(resolveAstNode(fields.get('timeout')?.value, doc)) ??
    undefined;
  const startPeriod =
    scalarToString(resolveAstNode(fields.get('start_period')?.value, doc)) ??
    undefined;
  const retriesRaw = scalarToString(
    resolveAstNode(fields.get('retries')?.value, doc),
  );
  const retries =
    retriesRaw !== null && !Number.isNaN(Number(retriesRaw))
      ? Number(retriesRaw)
      : undefined;

  return {
    ...loc,
    ...(test !== undefined ? { test } : {}),
    ...(interval !== undefined ? { interval } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(retries !== undefined ? { retries } : {}),
    ...(startPeriod !== undefined ? { startPeriod } : {}),
    ...(disable !== undefined ? { disable } : {}),
  };
}

function normalizeResourceLimits(
  serviceFields: Map<string, Pair>,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): ResourceLimits | undefined {
  let memory: string | undefined;
  let cpus: string | undefined;
  let memoryLine: number | undefined;
  let cpusLine: number | undefined;
  let baseLoc: SourceLocation | undefined;

  // Check service-level mem_limit / cpus first
  const memLimitPair = serviceFields.get('mem_limit');
  if (memLimitPair) {
    const val = scalarToString(resolveAstNode(memLimitPair.value, doc));
    if (val) {
      const loc = getNodeLocation(memLimitPair, lineCounter, fallbackLine);
      memory = val;
      memoryLine = loc.line;
      baseLoc = loc;
    }
  }

  const cpusPair = serviceFields.get('cpus');
  if (cpusPair) {
    const val = scalarToString(resolveAstNode(cpusPair.value, doc));
    if (val) {
      const loc = getNodeLocation(cpusPair, lineCounter, fallbackLine);
      cpus = val;
      cpusLine = loc.line;
      baseLoc = baseLoc ?? loc;
    }
  }

  // Check deploy.resources.limits.{memory, cpus}
  const deployPair = serviceFields.get('deploy');
  if (deployPair) {
    const deployMap = resolveAstNode(deployPair.value, doc);
    if (isMap(deployMap)) {
      const deployFields = getMapFieldMap(deployMap, doc);
      const resourcesPair = deployFields.get('resources');
      const resourcesMap = resolveAstNode(resourcesPair?.value, doc);
      if (isMap(resourcesMap)) {
        const resFields = getMapFieldMap(resourcesMap, doc);
        const limitsPair = resFields.get('limits');
        const limitsMap = resolveAstNode(limitsPair?.value, doc);
        if (isMap(limitsMap) && limitsPair) {
          const limitsLoc = getNodeLocation(limitsPair, lineCounter, fallbackLine);
          baseLoc = baseLoc ?? limitsLoc;
          const limitFields = getMapFieldMap(limitsMap, doc);

          const memPair = limitFields.get('memory');
          if (memPair) {
            const val = scalarToString(resolveAstNode(memPair.value, doc));
            if (val) {
              const loc = getNodeLocation(memPair, lineCounter, limitsLoc.line);
              memory = val;
              memoryLine = loc.line;
            }
          }

          const cpuPair = limitFields.get('cpus');
          if (cpuPair) {
            const val = scalarToString(resolveAstNode(cpuPair.value, doc));
            if (val) {
              const loc = getNodeLocation(cpuPair, lineCounter, limitsLoc.line);
              cpus = val;
              cpusLine = loc.line;
            }
          }
        }
      }
    }
  }

  if (!memory && !cpus) {
    return undefined;
  }

  return {
    ...(baseLoc ?? { line: fallbackLine }),
    ...(memory !== undefined ? { memory } : {}),
    ...(cpus !== undefined ? { cpus } : {}),
    ...(memoryLine !== undefined ? { memoryLine } : {}),
    ...(cpusLine !== undefined ? { cpusLine } : {}),
  };
}

function normalizeBuild(
  pair: Pair,
  doc: Document,
  lineCounter: LineCounter,
  fallbackLine: number,
): BuildConfig | undefined {
  const loc = getNodeLocation(pair, lineCounter, fallbackLine);
  const resolved = resolveAstNode(pair.value, doc);
  if (isScalar(resolved)) {
    const context = scalarToString(resolved);
    return context ? { ...loc, context } : undefined;
  }
  if (isMap(resolved)) {
    const fields = getMapFieldMap(resolved, doc);
    const context =
      scalarToString(resolveAstNode(fields.get('context')?.value, doc)) ??
      undefined;
    const dockerfile =
      scalarToString(resolveAstNode(fields.get('dockerfile')?.value, doc)) ??
      undefined;
    return {
      ...loc,
      ...(context ? { context } : {}),
      ...(dockerfile ? { dockerfile } : {}),
    };
  }
  return undefined;
}

/**
 * Normalize an entire parsed YAML Document into a ComposeModel.
 */
export function normalizeComposeDocument(
  doc: Document,
  lineCounter: LineCounter,
): { model?: ComposeModel; errors: ComposeParseError[]; warnings: ComposeParseError[] } {
  const errors: ComposeParseError[] = [];
  const warnings: ComposeParseError[] = [];

  const root = resolveAstNode(doc.contents, doc);
  if (!root || !isMap(root)) {
    const loc = getNodeLocation(doc.contents, lineCounter, 1);
    errors.push({
      message: 'Document must be a YAML mapping representing a Docker Compose file.',
      line: loc.line,
      column: loc.column,
    });
    return { errors, warnings };
  }

  const rootFields = getMapFieldMap(root, doc);

  const servicesPair = rootFields.get('services');
  if (!servicesPair) {
    const loc = getNodeLocation(root, lineCounter, 1);
    errors.push({
      message: 'Missing required top-level "services" key in Docker Compose file.',
      line: loc.line,
      column: loc.column,
    });
    return { errors, warnings };
  }

  const servicesNode = resolveAstNode(servicesPair.value, doc);
  if (!servicesNode || !isMap(servicesNode)) {
    const loc = getNodeLocation(servicesPair, lineCounter, 1);
    errors.push({
      message: 'Top-level "services" must be a mapping of service names to configurations.',
      line: loc.line,
      column: loc.column,
    });
    return { errors, warnings };
  }

  const version =
    scalarToString(resolveAstNode(rootFields.get('version')?.value, doc)) ??
    undefined;
  const name =
    scalarToString(resolveAstNode(rootFields.get('name')?.value, doc)) ??
    undefined;

  // 1. Parse top-level networks
  const networks: Record<string, NormalizedNetwork> = {};
  const networksPair = rootFields.get('networks');
  if (networksPair) {
    const networksMap = resolveAstNode(networksPair.value, doc);
    if (isMap(networksMap)) {
      const pairs = getEffectiveMapPairs(networksMap, doc);
      for (const pair of pairs) {
        const netName = scalarToString(pair.key);
        if (!netName || netName.startsWith('x-')) continue;
        const loc = getNodeLocation(pair, lineCounter, 1);
        const val = resolveAstNode(pair.value, doc);
        let driver: string | undefined;
        let external: boolean | undefined;
        let internal: boolean | undefined;

        if (isMap(val)) {
          const f = getMapFieldMap(val, doc);
          driver =
            scalarToString(resolveAstNode(f.get('driver')?.value, doc)) ??
            undefined;
          external = scalarToBoolean(
            resolveAstNode(f.get('external')?.value, doc),
          ) ?? (isMap(resolveAstNode(f.get('external')?.value, doc)) ? true : undefined);
          internal = scalarToBoolean(
            resolveAstNode(f.get('internal')?.value, doc),
          );
        }

        networks[netName] = {
          ...loc,
          name: netName,
          ...(driver ? { driver } : {}),
          ...(external !== undefined ? { external } : {}),
          ...(internal !== undefined ? { internal } : {}),
          implicit: false,
        };
      }
    }
  }

  // 2. Parse top-level volumes
  const volumes: Record<string, NormalizedVolume> = {};
  const declaredVolumes = new Set<string>();
  const volumesPair = rootFields.get('volumes');
  if (volumesPair) {
    const volumesMap = resolveAstNode(volumesPair.value, doc);
    if (isMap(volumesMap)) {
      const pairs = getEffectiveMapPairs(volumesMap, doc);
      for (const pair of pairs) {
        const volName = scalarToString(pair.key);
        if (!volName || volName.startsWith('x-')) continue;
        declaredVolumes.add(volName);
        const loc = getNodeLocation(pair, lineCounter, 1);
        const val = resolveAstNode(pair.value, doc);
        let driver: string | undefined;
        let external: boolean | undefined;

        if (isMap(val)) {
          const f = getMapFieldMap(val, doc);
          driver =
            scalarToString(resolveAstNode(f.get('driver')?.value, doc)) ??
            undefined;
          external = scalarToBoolean(
            resolveAstNode(f.get('external')?.value, doc),
          ) ?? (isMap(resolveAstNode(f.get('external')?.value, doc)) ? true : undefined);
        }

        volumes[volName] = {
          ...loc,
          name: volName,
          ...(driver ? { driver } : {}),
          ...(external !== undefined ? { external } : {}),
          implicit: false,
        };
      }
    }
  }

  // 3. Parse services
  const services: Record<string, NormalizedService> = {};
  const servicePairs = getEffectiveMapPairs(servicesNode, doc);
  let usesImplicitDefaultNetwork = false;

  for (const servicePair of servicePairs) {
    const serviceName = scalarToString(servicePair.key);
    if (!serviceName || serviceName.startsWith('x-')) continue;

    const serviceLoc = getNodeLocation(servicePair, lineCounter, 1);
    const serviceVal = resolveAstNode(servicePair.value, doc);

    if (!serviceVal || !isMap(serviceVal)) {
      errors.push({
        message: `Service "${serviceName}" must be a YAML mapping.`,
        line: serviceLoc.line,
        column: serviceLoc.column,
      });
      continue;
    }

    const sFields = getMapFieldMap(serviceVal, doc);
    const fieldLines: Record<string, number> = {};
    for (const [k, pair] of sFields.entries()) {
      fieldLines[k] = getNodeLocation(pair, lineCounter, serviceLoc.line).line;
    }

    const imagePair = sFields.get('image');
    const image =
      scalarToString(resolveAstNode(imagePair?.value, doc)) ?? undefined;
    const imageLine = imagePair ? fieldLines['image'] : undefined;

    const buildPair = sFields.get('build');
    const build = buildPair
      ? normalizeBuild(buildPair, doc, lineCounter, serviceLoc.line)
      : undefined;

    const containerName =
      scalarToString(resolveAstNode(sFields.get('container_name')?.value, doc)) ??
      undefined;

    const ports = normalizePorts(
      sFields.get('ports')?.value,
      doc,
      lineCounter,
      fieldLines['ports'] ?? serviceLoc.line,
    );

    const expose = normalizeExpose(
      sFields.get('expose')?.value,
      doc,
      lineCounter,
      fieldLines['expose'] ?? serviceLoc.line,
    );

    const serviceVolumes = normalizeVolumes(
      sFields.get('volumes')?.value,
      sFields.get('tmpfs')?.value,
      doc,
      lineCounter,
      fieldLines['volumes'] ?? serviceLoc.line,
      declaredVolumes,
    );

    // Register any named volumes referenced by services that weren't in top-level volumes
    for (const mount of serviceVolumes) {
      if (mount.type === 'volume' && mount.source && !volumes[mount.source]) {
        volumes[mount.source] = {
          name: mount.source,
          line: mount.line,
          implicit: true,
        };
      }
    }

    const networkModePair = sFields.get('network_mode');
    const networkMode =
      scalarToString(resolveAstNode(networkModePair?.value, doc)) ?? undefined;
    const networkModeLine = networkModePair
      ? fieldLines['network_mode']
      : undefined;

    let serviceNetworks = normalizeServiceNetworks(
      sFields.get('networks')?.value,
      doc,
      lineCounter,
      fieldLines['networks'] ?? serviceLoc.line,
    );

    // Handle implicit "default" network when no `networks` and no `network_mode` are set
    if (serviceNetworks.length === 0 && !networkMode) {
      serviceNetworks = [
        {
          name: 'default',
          line: serviceLoc.line,
          implicit: true,
          syntax: 'implicit',
        },
      ];
      usesImplicitDefaultNetwork = true;
    } else {
      for (const net of serviceNetworks) {
        if (!networks[net.name]) {
          networks[net.name] = {
            name: net.name,
            line: net.line,
            implicit: true,
          };
        }
      }
    }

    const environment = normalizeEnvironment(
      sFields.get('environment')?.value,
      doc,
      lineCounter,
      fieldLines['environment'] ?? serviceLoc.line,
    );

    const envFile = normalizeEnvFile(
      sFields.get('env_file')?.value,
      doc,
      lineCounter,
      fieldLines['env_file'] ?? serviceLoc.line,
    );

    const dependsOn = normalizeDependsOn(
      sFields.get('depends_on')?.value,
      doc,
      lineCounter,
      fieldLines['depends_on'] ?? serviceLoc.line,
    );

    const profilesLocList = normalizeLocatedStringList(
      sFields.get('profiles')?.value,
      doc,
      lineCounter,
      fieldLines['profiles'] ?? serviceLoc.line,
    );
    const profiles = profilesLocList.map((p) => p.value);
    const profilesLine = sFields.has('profiles')
      ? fieldLines['profiles']
      : undefined;

    const privilegedPair = sFields.get('privileged');
    const privileged = privilegedPair
      ? scalarToBoolean(resolveAstNode(privilegedPair.value, doc))
      : undefined;
    const privilegedLine = privilegedPair
      ? fieldLines['privileged']
      : undefined;

    const readOnlyPair = sFields.get('read_only');
    const readOnly = readOnlyPair
      ? scalarToBoolean(resolveAstNode(readOnlyPair.value, doc))
      : undefined;
    const readOnlyLine = readOnlyPair ? fieldLines['read_only'] : undefined;

    const userPair = sFields.get('user');
    const user =
      scalarToString(resolveAstNode(userPair?.value, doc)) ?? undefined;
    const userLine = userPair ? fieldLines['user'] : undefined;

    const pidPair = sFields.get('pid');
    const pid =
      scalarToString(resolveAstNode(pidPair?.value, doc)) ?? undefined;
    const pidLine = pidPair ? fieldLines['pid'] : undefined;

    const ipcPair = sFields.get('ipc');
    const ipc =
      scalarToString(resolveAstNode(ipcPair?.value, doc)) ?? undefined;
    const ipcLine = ipcPair ? fieldLines['ipc'] : undefined;

    const usernsModePair = sFields.get('userns_mode');
    const usernsMode =
      scalarToString(resolveAstNode(usernsModePair?.value, doc)) ?? undefined;
    const usernsModeLine = usernsModePair
      ? fieldLines['userns_mode']
      : undefined;

    const capAdd = normalizeLocatedStringList(
      sFields.get('cap_add')?.value,
      doc,
      lineCounter,
      fieldLines['cap_add'] ?? serviceLoc.line,
    );
    const capAddLine = sFields.has('cap_add') ? fieldLines['cap_add'] : undefined;

    const capDrop = normalizeLocatedStringList(
      sFields.get('cap_drop')?.value,
      doc,
      lineCounter,
      fieldLines['cap_drop'] ?? serviceLoc.line,
    );
    const capDropLine = sFields.has('cap_drop')
      ? fieldLines['cap_drop']
      : undefined;

    const securityOpt = normalizeLocatedStringList(
      sFields.get('security_opt')?.value,
      doc,
      lineCounter,
      fieldLines['security_opt'] ?? serviceLoc.line,
    );
    const securityOptLine = sFields.has('security_opt')
      ? fieldLines['security_opt']
      : undefined;

    const devices = normalizeDevices(
      sFields.get('devices')?.value,
      doc,
      lineCounter,
      fieldLines['devices'] ?? serviceLoc.line,
    );
    const devicesLine = sFields.has('devices')
      ? fieldLines['devices']
      : undefined;

    const healthcheckPair = sFields.get('healthcheck');
    const healthcheck = healthcheckPair
      ? normalizeHealthcheck(
          healthcheckPair,
          doc,
          lineCounter,
          serviceLoc.line,
        )
      : undefined;

    const resourceLimits = normalizeResourceLimits(
      sFields,
      doc,
      lineCounter,
      serviceLoc.line,
    );

    services[serviceName] = {
      ...serviceLoc,
      name: serviceName,
      ...(image !== undefined ? { image } : {}),
      ...(imageLine !== undefined ? { imageLine } : {}),
      ...(build !== undefined ? { build } : {}),
      ...(containerName !== undefined ? { containerName } : {}),
      ports,
      expose,
      volumes: serviceVolumes,
      networks: serviceNetworks,
      ...(networkMode !== undefined ? { networkMode } : {}),
      ...(networkModeLine !== undefined ? { networkModeLine } : {}),
      environment,
      envFile,
      dependsOn,
      profiles,
      ...(profilesLine !== undefined ? { profilesLine } : {}),
      ...(privileged !== undefined ? { privileged } : {}),
      ...(privilegedLine !== undefined ? { privilegedLine } : {}),
      ...(readOnly !== undefined ? { readOnly } : {}),
      ...(readOnlyLine !== undefined ? { readOnlyLine } : {}),
      ...(user !== undefined ? { user } : {}),
      ...(userLine !== undefined ? { userLine } : {}),
      ...(pid !== undefined ? { pid } : {}),
      ...(pidLine !== undefined ? { pidLine } : {}),
      ...(ipc !== undefined ? { ipc } : {}),
      ...(ipcLine !== undefined ? { ipcLine } : {}),
      ...(usernsMode !== undefined ? { usernsMode } : {}),
      ...(usernsModeLine !== undefined ? { usernsModeLine } : {}),
      capAdd,
      ...(capAddLine !== undefined ? { capAddLine } : {}),
      capDrop,
      ...(capDropLine !== undefined ? { capDropLine } : {}),
      securityOpt,
      ...(securityOptLine !== undefined ? { securityOptLine } : {}),
      devices,
      ...(devicesLine !== undefined ? { devicesLine } : {}),
      ...(healthcheck !== undefined ? { healthcheck } : {}),
      ...(resourceLimits !== undefined ? { resourceLimits } : {}),
      fieldLines,
    };
  }

  if (errors.length > 0) {
    return { errors, warnings };
  }

  if (Object.keys(services).length === 0) {
    const loc = getNodeLocation(servicesPair, lineCounter, 1);
    errors.push({
      message: 'The "services" section must define at least one service.',
      line: loc.line,
      column: loc.column,
    });
    return { errors, warnings };
  }

  if (usesImplicitDefaultNetwork && !networks['default']) {
    networks['default'] = {
      name: 'default',
      line: 1,
      implicit: true,
    };
  }

  return {
    model: {
      ...(version !== undefined ? { version } : {}),
      ...(name !== undefined ? { name } : {}),
      services,
      networks,
      volumes,
    },
    errors,
    warnings,
  };
}
