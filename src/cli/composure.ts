/**
 * Composure command-line interface: the same analysis as the web app, for
 * terminals and CI pipelines. Bundled into dist-cli/composure.mjs.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import {
  ALL_RULES,
  AnalysisResult,
  SEVERITY_ORDER,
  Severity,
  analyzeCompose,
  buildSarifLog,
  generateFindingsMarkdown,
} from '../core';

declare const __COMPOSURE_VERSION__: string;
const VERSION = typeof __COMPOSURE_VERSION__ === 'string' ? __COMPOSURE_VERSION__ : 'dev';

type Format = 'text' | 'json' | 'sarif' | 'markdown';

interface CliOptions {
  files: string[];
  format: Format;
  output?: string;
  failOn: Severity | 'none';
  minSeverity: Severity;
  disabled: string[];
  color: boolean;
  failOnProblems: boolean;
}

const DEFAULT_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

const HELP = `Composure ${VERSION}: security and correctness checks for Docker Compose files

Usage:
  composure [options] [file ...]

Files default to compose.yaml / docker-compose.yml in the current directory.
Use "-" to read from standard input.

Options:
  -f, --format <fmt>       text (default), json, sarif, markdown
  -o, --output <file>      write the report to a file instead of stdout
      --fail-on <level>    exit 1 if a finding is at least this severe:
                           critical, high (default), medium, low, info, none
      --min-severity <lvl> hide findings below this level in text output (default: low)
      --disable <ids>      comma-separated rule IDs to skip, e.g. CMP007,CMP016
      --no-fail-on-problems  do not exit 1 on Compose errors (undefined networks, ...)
      --no-color           disable colored output (also honors NO_COLOR)
      --list-rules         print all rules and exit
  -v, --version            print the version
  -h, --help               show this help

Suppress accepted risks in the file itself:
  # composure-ignore CMP002 -- reason       (next line, or a whole service)
  # composure-ignore-file CMP016            (whole file)

Exit codes: 0 clean, 1 threshold reached or Compose errors, 2 usage or read error.
`;

class UsageError extends Error {}

function parseSeverity(value: string | undefined, flag: string, allowNone: boolean): Severity | 'none' {
  const v = (value ?? '').toLowerCase();
  if ((SEVERITY_ORDER as string[]).includes(v)) return v as Severity;
  if (allowNone && v === 'none') return 'none';
  throw new UsageError(`Invalid value for ${flag}: "${value ?? ''}"`);
}

function parseArgs(argv: string[]): CliOptions | 'help' | 'version' | 'list-rules' {
  const opts: CliOptions = {
    files: [],
    format: 'text',
    failOn: 'high',
    minSeverity: 'low',
    disabled: [],
    color: process.stdout.isTTY === true && !process.env['NO_COLOR'],
    failOnProblems: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const next = () => {
      if (inline !== undefined) return inline;
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`Missing value for ${flag}`);
      return value;
    };
    switch (flag) {
      case '-h':
      case '--help':
        return 'help';
      case '-v':
      case '--version':
        return 'version';
      case '--list-rules':
        return 'list-rules';
      case '-f':
      case '--format': {
        const value = next();
        if (!['text', 'json', 'sarif', 'markdown'].includes(value)) {
          throw new UsageError(`Unknown format "${value}"`);
        }
        opts.format = value as Format;
        break;
      }
      case '-o':
      case '--output':
        opts.output = next();
        break;
      case '--fail-on':
        opts.failOn = parseSeverity(next(), '--fail-on', true);
        break;
      case '--min-severity':
        opts.minSeverity = parseSeverity(next(), '--min-severity', false) as Severity;
        break;
      case '--disable':
        opts.disabled.push(
          ...next()
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        );
        break;
      case '--no-color':
        opts.color = false;
        break;
      case '--no-fail-on-problems':
        opts.failOnProblems = false;
        break;
      default:
        if (arg.startsWith('-') && arg !== '-') throw new UsageError(`Unknown option ${arg}`);
        opts.files.push(arg);
    }
  }

  const known = new Set(ALL_RULES.map((r) => r.id));
  const unknown = opts.disabled.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new UsageError(`Unknown rule ID(s) in --disable: ${unknown.join(', ')}`);

  if (opts.files.length === 0) {
    const found = DEFAULT_FILES.find((f) => existsSync(f));
    if (!found) {
      throw new UsageError('No Compose file given, and none found in the current directory.');
    }
    opts.files.push(found);
  }
  return opts;
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function painter(enabled: boolean) {
  const wrap = (code: string) => (text: string) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : text);
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    red: wrap('31'),
    yellow: wrap('33'),
    blue: wrap('34'),
    magenta: wrap('35'),
    green: wrap('32'),
    gray: wrap('90'),
  };
}

interface FileReport {
  path: string;
  displayPath: string;
  result: AnalysisResult;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function severityRank(sev: Severity): number {
  return SEVERITY_ORDER.length - SEVERITY_ORDER.indexOf(sev);
}

function renderText(reports: FileReport[], opts: CliOptions): string {
  const c = painter(opts.color);
  const sevColor: Record<Severity, (t: string) => string> = {
    critical: (t) => c.bold(c.red(t)),
    high: c.red,
    medium: c.yellow,
    low: c.blue,
    info: c.gray,
  };
  const levelColor = { error: c.red, warning: c.yellow, info: c.gray } as const;
  const out: string[] = [];
  const minRank = severityRank(opts.minSeverity);

  for (const report of reports) {
    const { result } = report;
    if (!result.ok) {
      out.push(c.bold(report.displayPath) + '  ' + c.red('could not be parsed'));
      for (const e of result.errors) {
        out.push(`  ${c.dim(`${e.line}:${e.column ?? 1}`.padEnd(7))} ${c.red('error'.padEnd(8))} ${e.message}`);
      }
      out.push('');
      continue;
    }

    const gradeColor = result.score.grade === 'A' ? c.green : result.score.grade === 'B' || result.score.grade === 'C' ? c.yellow : c.red;
    out.push(
      `${c.bold(report.displayPath)}  ${gradeColor(c.bold(`Grade ${result.score.grade}`))} ${c.dim(`(${result.score.score}/100)`)}  ${c.dim(plural(Object.keys(result.model.services).length, 'service'))}`,
    );

    if (result.diagnostics.length > 0) {
      out.push(c.dim('  Compose problems'));
      for (const d of result.diagnostics) {
        out.push(
          `  ${c.dim(`${d.line}:${d.column ?? 1}`.padEnd(7))} ${levelColor[d.severity](d.severity.padEnd(8))} ${d.message.replace(/`/g, '')} ${c.dim(d.code)}`,
        );
      }
    }

    const visible = result.findings.filter((f) => severityRank(f.severity) >= minRank);
    if (visible.length > 0) {
      out.push(c.dim('  Security findings'));
      for (const f of [...visible].sort((a, b) => a.line - b.line)) {
        out.push(
          `  ${c.dim(String(f.line).padEnd(7))} ${sevColor[f.severity](f.severity.padEnd(8))} ${c.magenta(`[${f.service}]`)} ${f.title}: ${f.message.replace(/`/g, '')} ${c.dim(f.ruleId)}`,
        );
      }
    }
    const hidden = result.findings.length - visible.length;
    if (hidden > 0) out.push(c.dim(`  (${hidden} finding(s) below ${opts.minSeverity} hidden; use --min-severity info)`));
    if (result.suppressed.length > 0) {
      out.push(c.dim(`  ${result.suppressed.length} accepted risk(s) suppressed by composure-ignore comments`));
    }
    out.push('');
  }

  const all = reports.flatMap((r) => (r.result.ok ? r.result.findings : []));
  const counts = SEVERITY_ORDER.map((s) => `${all.filter((f) => f.severity === s).length} ${s}`).join(', ');
  const errors = reports.reduce(
    (n, r) => n + (r.result.ok ? r.result.diagnostics.filter((d) => d.severity === 'error').length : r.result.errors.length),
    0,
  );
  out.push(
    `${all.length === 0 && errors === 0 ? c.green('✔') : c.red('✖')} ${plural(all.length, 'finding')} (${counts}), ${plural(errors, 'Compose error')}`,
  );
  return out.join('\n') + '\n';
}

function renderJson(reports: FileReport[]): string {
  return (
    JSON.stringify(
      {
        tool: { name: 'composure', version: VERSION },
        files: reports.map((r) =>
          r.result.ok
            ? {
                path: r.displayPath,
                ok: true,
                score: r.result.score,
                diagnostics: r.result.diagnostics,
                findings: r.result.findings.map(({ fix: _fix, references, ...rest }) => ({
                  ...rest,
                  references: references.map((ref) => ref.url),
                })),
                suppressed: r.result.suppressed.map((f) => ({
                  ruleId: f.ruleId,
                  service: f.service,
                  line: f.line,
                  severity: f.severity,
                  reason: f.suppression.reason ?? null,
                })),
              }
            : { path: r.displayPath, ok: false, errors: r.result.errors },
        ),
      },
      null,
      2,
    ) + '\n'
  );
}

function renderMarkdown(reports: FileReport[]): string {
  return reports
    .map((r) =>
      r.result.ok
        ? generateFindingsMarkdown(r.result.model, r.result.findings, {
            diagnostics: r.result.diagnostics,
            suppressed: r.result.suppressed,
            score: r.result.score,
            fileName: r.displayPath,
          })
        : `# ${r.displayPath}\n\nCould not be parsed:\n\n${r.result.errors.map((e) => `- Line ${e.line}: ${e.message}`).join('\n')}\n`,
    )
    .join('\n\n---\n\n');
}

function renderSarif(reports: FileReport[]): string {
  const inputs = reports.map((r) =>
    r.result.ok
      ? {
          uri: r.displayPath,
          findings: r.result.findings,
          suppressed: r.result.suppressed,
          diagnostics: r.result.diagnostics,
        }
      : {
          uri: r.displayPath,
          findings: [],
          diagnostics: r.result.errors.map((e) => ({
            code: 'yaml-syntax',
            severity: 'error' as const,
            message: e.message,
            line: e.line,
            ...(e.column ? { column: e.column } : {}),
          })),
        },
  );
  return JSON.stringify(buildSarifLog(inputs, VERSION), null, 2) + '\n';
}

function listRules(): string {
  return (
    ALL_RULES.map((r) => `${r.id}  ${r.severity.padEnd(8)}  ${r.title}\n          ${r.description.replace(/`/g, '')}`).join('\n') +
    '\n'
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function readInput(path: string): string {
  if (path === '-') return readFileSync(0, 'utf-8');
  return readFileSync(path, 'utf-8');
}

export function main(argv: string[]): number {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`composure: ${err.message}\nRun "composure --help" for usage.\n`);
      return 2;
    }
    throw err;
  }
  if (opts === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (opts === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (opts === 'list-rules') {
    process.stdout.write(listRules());
    return 0;
  }

  const reports: FileReport[] = [];
  for (const file of opts.files) {
    let text: string;
    try {
      text = readInput(file);
    } catch (err) {
      process.stderr.write(`composure: cannot read ${file}: ${(err as Error).message}\n`);
      return 2;
    }
    const displayPath =
      file === '-' ? 'stdin' : relative(process.cwd(), resolve(file)).split('\\').join('/') || file;
    reports.push({
      path: file,
      displayPath,
      result: analyzeCompose(text, { disabledRuleIds: opts.disabled }),
    });
  }

  let rendered: string;
  switch (opts.format) {
    case 'json':
      rendered = renderJson(reports);
      break;
    case 'sarif':
      rendered = renderSarif(reports);
      break;
    case 'markdown':
      rendered = renderMarkdown(reports);
      break;
    default:
      rendered = renderText(reports, opts);
  }

  if (opts.output) {
    writeFileSync(opts.output, rendered);
    if (opts.format !== 'text') {
      // Keep a short human summary in CI logs when the report goes to a file
      process.stdout.write(renderText(reports, { ...opts, minSeverity: 'medium' }));
    }
  } else {
    process.stdout.write(rendered);
  }

  const failRank = opts.failOn === 'none' ? Infinity : severityRank(opts.failOn);
  const thresholdHit = reports.some(
    (r) => r.result.ok && r.result.findings.some((f) => severityRank(f.severity) >= failRank),
  );
  const composeErrors = reports.some(
    (r) => !r.result.ok || r.result.diagnostics.some((d) => d.severity === 'error'),
  );
  return thresholdHit || (opts.failOnProblems && composeErrors) ? 1 : 0;
}

// Run only when executed directly (not when imported by tests)
// (resolve symlinks: npm installs bins as links in node_modules/.bin)
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exitCode = main(process.argv.slice(2));
}
