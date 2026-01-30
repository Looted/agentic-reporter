# AgenticStream Playwright Reporter

A high-density, token-efficient Playwright reporter designed for autonomous AI coding agents.

## Features

- **Zero-Latency**: Streams to stdout, no file I/O
- **Token Efficiency**: "Silence on Success" - passing tests emit nothing
- **High-Signal**: Captures stack traces, console logs, attachments
- **Overflow Protection**: Truncates after N failures to prevent context exhaustion
- **Extensible**: Custom hint patterns and output streams

## Installation

```bash
npm install @align/agentic-reporter
```

## Usage

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: process.env['AGENTIC_REPORTER']
    ? [['@align/agentic-reporter', { maxFailures: 5 }]]
    : [['html', { open: 'never' }]],
});
```

## Options

| Option               | Type           | Default | Description                     |
| -------------------- | -------------- | ------- | ------------------------------- |
| `maxFailures`        | number         | 5       | Max failures before suppression |
| `maxStackFrames`     | number         | 8       | Stack trace depth               |
| `maxLogLines`        | number         | 5       | Console log lines               |
| `maxLogChars`        | number         | 500     | Max log characters              |
| `includeAttachments` | boolean        | true    | Include trace/screenshot paths  |
| `outputStream`       | WritableStream | stdout  | Custom output stream            |

## Output Format

```xml
<test_run>
  <suite_info total="45" workers="4" project="chromium" />

  <failure id="auth_login" type="timeout" file="auth.spec.ts" line="24">
    <error_summary>TimeoutError: Timeout 5000ms exceeded.</error_summary>
    <context_markdown><![CDATA[
**Test:** should login successfully
**File:** `auth.spec.ts:24`

**Error Stack:**
\`\`\`text
at tests/auth.spec.ts:24:20
\`\`\`

**Hint:** Selector missing/hidden? Check element visibility.
    ]]></context_markdown>
    <reproduce_command>npx playwright test auth.spec.ts:24 --project=chromium</reproduce_command>
  </failure>

  <result_summary status="failed" passed="43" failed="2" skipped="0" duration="14520ms" />
</test_run>
```

## License

MIT
