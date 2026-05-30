# Agentic Reporter Hardening and Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Playwright reporter safe for no-human autonomous e2e workflows, machine-parseable, accurately documented, and guarded by 100% test coverage.

**Architecture:** Keep the current small-module structure and avoid a broad rewrite. Add deterministic policy/options to `types.ts`, keep serialization hardening in `formatter.ts`, keep reporter orchestration in `reporter.ts`, and validate behavior through unit tests plus one real Playwright integration fixture.

**Tech Stack:** TypeScript, `@playwright/test` Reporter API, Vitest, V8 coverage provider, ESLint, CommonJS package output.

---

## File Structure

- Modify `package.json`: add coverage scripts and coverage dependency.
- Modify `vitest.config.ts` or create it if absent: enforce 100% coverage thresholds for `src/**/*.ts`.
- Modify `src/types.ts`: add deterministic options (`existingReportPolicy`, `customHintPatterns`, optional machine output mode if chosen).
- Modify `src/formatter.ts`: make CDATA safe or move machine output to JSON serialization.
- Modify `src/reporter.ts`: remove interactive stdin and direct `process.exit()`, wire custom hints, validate options, keep file I/O policy deterministic.
- Modify `src/index.ts`: export any new public types/helpers.
- Modify `README.md`: document actual file I/O, deterministic policies, schema, coverage badge/command, and autonomous-agent usage.
- Modify `tests/*.ts`: add missing branch/edge tests until coverage reaches 100%.
- Create `tests/e2e/fixtures/*` and `tests/reporter.integration.test.ts`: run a real Playwright fixture and assert parseable output/artifacts.

## Task 1: Coverage Metrics Baseline

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Add coverage script and dependency**

Add scripts:

```json
{
  "scripts": {
    "coverage": "vitest run --coverage",
    "coverage:check": "vitest run --coverage --coverage.thresholds.100=true"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.1.9"
  }
}
```

- [ ] **Step 2: Add coverage config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
```

- [ ] **Step 3: Run baseline coverage and capture gaps**

Run: `npm run coverage`

Expected: tests pass, coverage likely below 100%; record uncovered lines/branches before adding tests.

## Task 2: Fill Existing Coverage Gaps Before Behavior Changes

**Files:**
- Modify: `tests/formatter.test.ts`
- Modify: `tests/logProcessor.spec.ts`
- Modify: `tests/hints.test.ts`
- Modify: `tests/reporter.test.ts`

- [ ] **Step 1: Write failing/missing formatter tests**

Add tests for:
- XML escaping no-op fast path.
- `formatFailure()` with and without `detailsPath`.
- CDATA breaker input containing `]]>` (expected to fail until Task 4).
- `sanitizeId()` collision/empty/unicode behavior, documenting current behavior.

- [ ] **Step 2: Write missing log processor tests**

Add tests for:
- `maxChars` equal to output length.
- `maxLines = 0` and invalid/negative values after validation task.
- Empty stdout/stderr arrays.

- [ ] **Step 3: Write missing reporter branch tests**

Add tests for:
- `includeAttachments` true/false.
- Attachments with missing `path` are skipped.
- Invalid numeric options warn and fall back.
- `fs.writeFileSync` failure warns but still emits stdout failure.
- `fs.unlinkSync` failure is swallowed.
- Previous report directory missing returns without prompt.

- [ ] **Step 4: Run coverage**

Run: `npm run coverage`

Expected: coverage gaps shrink; CDATA and future-behavior tests may fail until corresponding implementation tasks.

## Task 3: Remove Interactive and Abrupt Exit Behavior

**Files:**
- Modify: `src/types.ts`
- Modify: `src/reporter.ts`
- Modify: `tests/reporter.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing tests for deterministic previous-report policy**

Add an option:

```ts
existingReportPolicy?: 'overwrite' | 'fail' | 'append' | 'unique';
```

Expected behaviors:
- Default policy does not read from stdin.
- `fail` emits structured failure metadata and sets reporter state, but does not call `process.exit()`.
- `overwrite` continues without prompt.
- `unique` writes detailed reports under a unique run folder.

- [ ] **Step 2: Implement minimal policy handling**

Remove `fs.readSync(0, ...)` from `checkForExistingReports()`.

- [ ] **Step 3: Write failing tests for max failure handling without `process.exit()`**

Expected: when `exitOnExceedingMaxFailures` or its replacement is enabled, reporter emits overflow metadata and suppresses further details without direct process termination.

- [ ] **Step 4: Implement non-exit behavior**

Prefer Playwright-native max failure configuration in docs. If reporter must signal failure, expose it in summary metadata rather than terminating the process.

## Task 4: Machine-Parse-Safe Serialization

**Files:**
- Modify: `src/formatter.ts`
- Modify: `src/types.ts` if adding JSON mode
- Modify: `tests/formatter.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing CDATA safety test**

Input stack/log: `before ]]> after`.

Expected XML context contains safe split CDATA, e.g. `]]]]><![CDATA[>` or an escaped non-CDATA representation.

- [ ] **Step 2: Implement CDATA-safe helper**

Add:

```ts
export function escapeCdata(str: string): string {
  return str.replace(/]]>/g, ']]]]><![CDATA[>');
}
```

Use it inside `formatFailure()` around markdown content.

- [ ] **Step 3: Add optional JSON artifact plan if needed**

If implementing now, add `outputFormat?: 'xml' | 'json'` and a `formatFailureJson()` path with schema version.

## Task 5: Custom Hints and Option Validation

**Files:**
- Modify: `src/types.ts`
- Modify: `src/reporter.ts`
- Modify: `tests/hints.test.ts`
- Modify: `tests/reporter.test.ts`

- [ ] **Step 1: Write failing test for reporter-level custom hint patterns**

Instantiate `AgenticReporter({ customHintPatterns: [...] })` and assert output includes custom `type` and hint.

- [ ] **Step 2: Expand `ErrorType` safely**

Either allow `custom` through a generic/custom string type or keep `ErrorType` closed and add `CustomHintPattern` with known labels.

- [ ] **Step 3: Implement wiring**

Pass `this.options.customHintPatterns` to `classifyError()`.

- [ ] **Step 4: Write failing tests for numeric option validation**

Cover `maxLogLines`, `maxLogChars`, `maxFailures`, `maxStackFrames` with `0`, negative numbers, `NaN`, and `Infinity`.

- [ ] **Step 5: Implement shared positive integer resolver**

Keep warnings concise and write to configured output or a testable warning adapter.

## Task 6: Real Playwright Integration Test

**Files:**
- Create: `tests/e2e/fixtures/playwright.config.ts`
- Create: `tests/e2e/fixtures/sample.spec.ts`
- Create: `tests/reporter.integration.test.ts`

- [ ] **Step 1: Write integration fixture**

Create a failing Playwright test that logs stdout/stderr, attaches an artifact, and throws text containing XML-sensitive characters.

- [ ] **Step 2: Write integration assertion**

Run `npx playwright test` in the fixture with this reporter and assert:
- Exit code reflects test failure.
- Reporter output contains one root machine-readable report or documented event stream.
- Generated XML/JSON parses successfully.
- Artifact paths exist or are explicitly marked missing.

- [ ] **Step 3: Make integration test pass**

Adjust reporter code only as needed after the failing test proves the gap.

## Task 7: Documentation and Agent Workflow UX

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document autonomous defaults**

Explain no stdin, no prompts, deterministic artifact policy, and no direct process exits.

- [ ] **Step 2: Document full options table**

Include `enableDetailedReport`, `existingReportPolicy`, custom hints, output format, and coverage command.

- [ ] **Step 3: Document output schema**

Show XML/JSON fields, schema version if present, examples for failure, overflow, summary, and detailed report.

## Task 8: Final Verification Gate

**Files:**
- All modified files

- [ ] **Step 1: Run diagnostics**

Run LSP diagnostics on `src`, `tests`, and config files.

- [ ] **Step 2: Run test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Run coverage**

Run: `npm run coverage`

Expected: 100% statements, branches, functions, and lines for `src/**/*.ts`.

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: zero lint errors. Expand lint scope to tests if practical.

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: TypeScript build succeeds and `dist/` matches source changes.

---

## Notes

- Do not add `as any`, `@ts-ignore`, or `@ts-expect-error` while implementing this plan.
- Keep implementation incremental: tests first, watch red, implement, verify green.
- Prefer deterministic automation over human-facing prompts everywhere.
