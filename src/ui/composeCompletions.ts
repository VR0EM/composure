import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
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
} from '../core';

/** Value suggestions for keys with a small, fixed set of valid values. */
const VALUE_OPTIONS: Record<string, readonly string[]> = {
  restart: ['no', 'always', 'on-failure', 'unless-stopped'],
  condition: DEPENDS_ON_CONDITIONS,
  network_mode: ['bridge', 'host', 'none', 'service:', 'container:'],
  pull_policy: ['always', 'never', 'missing', 'build', 'daily', 'weekly'],
  driver: ['json-file', 'local', 'journald', 'syslog', 'bridge', 'overlay', 'macvlan'],
  read_only: ['true', 'false'],
  privileged: ['false', 'true'],
  init: ['true', 'false'],
  internal: ['true', 'false'],
  external: ['true', 'false'],
  required: ['true', 'false'],
};

/**
 * Work out the chain of parent keys for a line by walking up to lines with
 * smaller indentation, e.g. ["services", "web", "healthcheck"].
 */
function parentPath(context: CompletionContext, lineNumber: number, indent: number): string[] {
  const path: string[] = [];
  let currentIndent = indent;
  for (let n = lineNumber - 1; n >= 1 && currentIndent > 0; n--) {
    const text = context.state.doc.line(n).text;
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const lineIndent = text.length - text.trimStart().length;
    if (lineIndent >= currentIndent) continue;
    const isSeqItem = /^-\s/.test(trimmed);
    const keyMatch = /^(?:-\s+)?(["']?)([^\s:#"'][^:#"']*?)\1\s*:/.exec(trimmed);
    path.unshift(isSeqItem ? `[]${keyMatch ? `.${keyMatch[2]}` : ''}` : (keyMatch?.[2] ?? '?'));
    currentIndent = lineIndent;
  }
  return path;
}

function keysForPath(path: string[]): readonly string[] | null {
  const [first, , third, fourth] = path;
  if (path.length === 0) return TOP_LEVEL_KEYS;
  if (first === 'services') {
    if (path.length === 2) return SERVICE_KEYS;
    if (path.length === 3) {
      switch (third) {
        case 'healthcheck':
          return HEALTHCHECK_KEYS;
        case 'logging':
          return LOGGING_KEYS;
        case 'deploy':
          return DEPLOY_KEYS;
        case 'build':
          return BUILD_KEYS;
        default:
          return null;
      }
    }
    if (path.length === 4 && third === 'depends_on') return DEPENDS_ON_KEYS;
    if (path.length === 4 && third === 'deploy' && fourth === 'resources') return ['limits', 'reservations'];
    if (path.length === 5 && third === 'deploy' && fourth === 'resources') {
      return ['cpus', 'memory', 'pids', 'devices'];
    }
  }
  if (path.length === 2 && first === 'networks') return NETWORK_KEYS;
  if (path.length === 2 && first === 'volumes') return VOLUME_KEYS;
  return null;
}

export function composeCompletionSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);

  // Value completion: `key: <cursor>`
  const valueMatch = /^(\s*)(?:-\s+)?([\w.-]+):\s+([\w:-]*)$/.exec(before);
  if (valueMatch) {
    const options = VALUE_OPTIONS[valueMatch[2]!];
    if (!options) return null;
    const typed = valueMatch[3] ?? '';
    if (!context.explicit && typed.length === 0) return null;
    return {
      from: context.pos - typed.length,
      options: options.map((v) => ({ label: v, type: 'enum' })),
      validFor: /^[\w:-]*$/,
    };
  }

  // Key completion at the start of a line
  const keyMatch = /^(\s*)([\w.-]*)$/.exec(before);
  if (!keyMatch) return null;
  const indent = keyMatch[1]!.length;
  const typed = keyMatch[2] ?? '';
  if (!context.explicit && typed.length === 0) return null;

  const keys = keysForPath(parentPath(context, line.number, indent));
  if (!keys) return null;

  return {
    from: line.from + indent,
    options: keys.map((k) => ({ label: k, type: 'property', apply: `${k}: ` })),
    validFor: /^[\w.-]*$/,
  };
}
