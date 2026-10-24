# Contributing to Composure

Thank you for your interest in contributing to **Composure**! This document explains how the codebase is structured and how to add a new security hardening rule, an automatic fix, or a Compose correctness check.

---

## Architectural Principles

1. **100% Client-Side & Zero Telemetry**: never introduce external network requests, analytics, or backend dependencies. The production build enforces this with a Content-Security-Policy (see `vite.config.ts`); don't loosen it.
2. **Pure `src/core/`**: everything in `src/core/` stays pure TypeScript with **no React or DOM imports**. The web app and the CLI (`src/cli/`) both use it.
3. **Strict TypeScript**: all code must pass `tsc -b` with `strict: true` and `noUncheckedIndexedAccess: true` (tests included).
4. **Low false positives**: a finding should be something a careful reviewer would also flag. If a pattern is common and harmless (for example `/etc/localtime:ro`), allow it explicitly and add a test.

---

## How to Add a New Hardening Rule

Every rule lives in its own file in `src/core/rules/` and implements the `Rule` interface from `src/core/types.ts`.

### Step 1: Check the normalized model (`src/core/types.ts` & `src/core/normalizer.ts`)
See whether the Compose field you need is already on `NormalizedService` (or `ComposeModel`).
If you add a field, also record its 1-based line number in `normalizer.ts` so findings jump to the right line in the editor.

### Step 2: Create the rule file (`src/core/rules/CMP0XX-<slug>.ts`)

```ts
import { ComposeModel, Finding, Rule } from '../types';
import { cis, fixWithYaml } from './shared';

function buildFix(serviceName: string): string {
  return fixWithYaml(
    'One sentence on how to fix it:',
    `
services:
  ${serviceName}:
    # the recommended configuration`,
  );
}

export const CMP022: Rule = {
  id: 'CMP022',
  title: 'Short, clear title', // at most 26 characters
  severity: 'medium', // 'critical' | 'high' | 'medium' | 'low' | 'info'
  description: 'Why this configuration is a risk, in one sentence.',
  fix: buildFix('app'),
  references: [
    cis('5.x', 'Exact CIS Docker Benchmark v1.6.0 recommendation title'),
    { title: 'Docker Docs: ...', url: 'https://docs.docker.com/...' },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];
    for (const service of Object.values(model.services)) {
      // if (problem) findings.push({
      //   ruleId: this.id,
      //   title: this.title,
      //   severity: this.severity,
      //   service: service.name,
      //   line: service.fieldLines['your_field'] ?? service.line,
      //   description: this.description,
      //   message: `What exactly is wrong in this service.`,
      //   fix: buildFix(service.name),
      //   references: this.references,
      // });
    }
    return findings;
  },
};
```

Check CIS numbers against the v1.6.0 list in [docker-bench-security](https://github.com/docker/docker-bench-security/blob/master/tests/5_container_runtime.sh). Don't guess them.

### Step 3 (optional): Add a safe autofix
If the fix is mechanical and safe, attach an `autofix` with structured operations (`FixOperation` in `types.ts`):

```ts
autofix: {
  label: 'Add no-new-privileges:true',
  operations: [
    { kind: 'addListItem', service: service.name, key: 'security_opt', item: 'no-new-privileges:true', compare: 'securityOpt' },
  ],
},
```

`src/core/autofix.ts` applies these as minimal text edits and returns `null` whenever an edit would be unsafe (for example editing a shared YAML anchor). Only add an autofix when it cannot break a working setup in a way the user wouldn't expect; values that depend on the application (memory limits, healthcheck commands, image digests) should stay manual.

### Step 4: Register the rule (`src/core/rules/index.ts`)
Export it and append it to `ALL_RULES`.

### Step 5: Tests (`tests/`)
Every rule **must** have a positive and a negative case:
1. Fixture-based tests in `tests/rules.test.ts` (`rules-positive.yml` triggers, `rules-negative.yml` stays clean).
2. Targeted snippets for edge cases and false positives in `tests/rules-detection.test.ts`.
3. If you added an autofix, cover it in `tests/autofix.test.ts`. The "never breaks any example file" test runs every autofix on every example.

### Step 6: Document & verify
1. Add the rule to the rules table in `README.md`.
2. Run:
   ```bash
   npm test
   npm run build
   npm run build:cli && node dist-cli/composure.mjs tests/fixtures/rules-positive.yml
   ```

---

## Adding a Compose Correctness Check

- Checks that need the raw YAML (unknown keys, duplicate keys) go in `src/core/astDiagnostics.ts`; known keys live in `src/core/composeSchema.ts`.
- Checks on the normalized model (references, conflicts) go in `src/core/validator.ts`.
- Use `error` only for things `docker compose` rejects, `warning` for things it silently gets wrong, and `info` for housekeeping. Add cases to `tests/validator.test.ts`, including one that proves a correct file stays clean.
