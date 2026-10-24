# Contributing to Composure

Thank you for your interest in contributing to **Composure**! This document explains how the codebase is structured and how to add a new security hardening rule.

---

## Architectural Principles

1. **100% Client-Side & Zero Telemetry**: Never introduce external network requests, analytics, or backend dependencies.
2. **Pure `src/core/` Separation**: Everything inside `src/core/` must remain pure TypeScript with **no React or DOM imports** so `src/core/` can be packaged into a standalone CLI or GitHub Action.
3. **Strict TypeScript**: All code must pass `tsc -b` with `strict: true` and `noUncheckedIndexedAccess: true`.

---

## How to Add a New Hardening Rule

Every hardening rule lives in its own file inside `src/core/rules/` and implements the `Rule` interface from `src/core/types.ts`.

### Step 1: Check Normalized Fields (`src/core/types.ts` & `src/core/normalizer.ts`)
Verify whether the Compose field you want to inspect is already present on `NormalizedService` (or `ComposeModel`) in `src/core/types.ts`.
- If you need to add a new field to `NormalizedService`, also record its 1-based YAML line number in `src/core/normalizer.ts` so findings can jump to the exact line in the editor.

### Step 2: Create the Rule File (`src/core/rules/CMP0XX-<slug>.ts`)
Create a new file named `src/core/rules/CMP017-your-rule-name.ts`:

```ts
import { ComposeModel, Finding, Rule } from '../types';

export const CMP017: Rule = {
  id: 'CMP017',
  title: 'Short, clear title of the finding',
  severity: 'medium', // 'critical' | 'high' | 'medium' | 'low' | 'info'
  description:
    'Explain why this configuration is a security or reliability risk.',
  fix: `Provide a concrete remediation explanation and a YAML snippet:
\`\`\`yaml
services:
  app:
    # Show the recommended secure configuration
\`\`\``,
  references: [
    {
      title: 'CIS Docker Benchmark / Official Docker Docs Reference',
      url: 'https://docs.docker.com/...',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      // Inspect normalized service fields
      // When an issue is detected, push a Finding with the 1-based line number:
      // findings.push({
      //   ruleId: this.id,
      //   title: this.title,
      //   severity: this.severity,
      //   service: service.name,
      //   line: service.fieldLines['your_field'] ?? service.line,
      //   description: this.description,
      //   message: `Service "${service.name}" ...`,
      //   fix: this.fix,
      //   references: this.references,
      // });
    }

    return findings;
  },
};
```

### Step 3: Register the Rule (`src/core/rules/index.ts`)
Export your rule and append it to `ALL_RULES` in `src/core/rules/index.ts`.

### Step 4: Add Positive and Negative Test Fixtures (`tests/`)
Every rule **must** have at least one positive test case (triggers the finding) and one negative test case (compliant configuration that produces zero findings):
1. Add a triggering case to `tests/fixtures/rules-positive.yml` (or a dedicated fixture file).
2. Ensure `tests/fixtures/rules-negative.yml` remains compliant with your new rule.
3. Add a unit test in `tests/rules.test.ts` verifying the rule ID, severity, affected service name, and 1-based line number.

### Step 5: Document & Verify
1. Add the rule to the rules table in `README.md`.
2. Run tests and build:
   ```bash
   npm test
   npm run build
   ```
