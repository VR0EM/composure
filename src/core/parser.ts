import { LineCounter, parseDocument } from 'yaml';
import { normalizeComposeDocument } from './normalizer';
import { ComposeParseError, ParseResult } from './types';
import { validateComposeModel } from './validator';

/**
 * Parse and normalize a Docker Compose YAML string into a normalized ComposeModel.
 * Never throws; returns structured errors with 1-based line numbers on invalid input.
 */
export function parseCompose(yamlText: string): ParseResult {
  if (!yamlText || yamlText.trim().length === 0) {
    return {
      ok: false,
      errors: [
        {
          message: 'Compose file is empty.',
          line: 1,
          column: 1,
        },
      ],
    };
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(yamlText, {
    lineCounter,
    merge: true,
    uniqueKeys: false,
    strict: false,
  });

  if (doc.errors.length > 0) {
    const errors: ComposeParseError[] = doc.errors.map((err) => {
      const startPos =
        err.linePos?.[0] ??
        (Array.isArray(err.pos) && typeof err.pos[0] === 'number'
          ? lineCounter.linePos(err.pos[0])
          : { line: 1, col: 1 });
      const endPos =
        err.linePos?.[1] ??
        (Array.isArray(err.pos) && typeof err.pos[1] === 'number'
          ? lineCounter.linePos(err.pos[1])
          : startPos);

      // Strip redundant "at line X, column Y" suffix from yaml error message if needed, or keep concise
      const cleanMessage = (err.message.split('\n')[0] ?? err.message).trim();

      return {
        message: cleanMessage,
        line: startPos.line,
        column: startPos.col,
        endLine: Math.max(startPos.line, endPos.line),
      };
    });

    return {
      ok: false,
      errors,
    };
  }

  const { model, errors, diagnostics } = normalizeComposeDocument(doc, lineCounter);

  if (!model || errors.length > 0) {
    return {
      ok: false,
      errors:
        errors.length > 0
          ? errors
          : [{ message: 'Invalid Docker Compose file.', line: 1 }],
    };
  }

  const allDiagnostics = [...diagnostics, ...validateComposeModel(model)].sort(
    (a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0),
  );

  return {
    ok: true,
    model,
    diagnostics: allDiagnostics,
  };
}
