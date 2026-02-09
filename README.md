# AgenticStream Playwright Reporter

A high-density, token-efficient Playwright reporter designed for autonomous AI coding agents.

## Features

- **Zero-Latency**: Streams to stdout, no file I/O
- **Token Efficiency**: "Silence on Success" - passing tests emit nothing
- **High-Signal**: Captures stack traces, console logs, attachments
- **Overflow Protection**: Truncates after N failures to prevent context exhaustion
- **Smart Analysis**: Detects flaky tests, slow tests, and skipped tests
- **AI Summary**: Generates a `test-results/ai-start-here.md` file with a high-level overview
- **Extensible**: Custom hint patterns and output streams

## Installation

```bash
npm install @looted/agentic-reporter
```

## Usage

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { agenticReporter } from '@looted/agentic-reporter';

export default defineConfig({
  reporter: [
    agenticReporter({
      maxFailures: 5,
      maxSlowTestThreshold: 5, // 5 standard deviations
      enableDetailedReport: true,
    }),
  ],
});
```

## Options

| Option                       | Type           | Default | Description                                                |
| ---------------------------- | -------------- | ------- | ---------------------------------------------------------- |
| `maxFailures`                | number/boolean | false   | Max failures before stopping execution                     |
| `maxStackFrames`             | number         | 8       | Stack trace depth                                          |
| `maxLogLines`                | number         | 5       | Console log lines                                          |
| `maxLogChars`                | number         | 500     | Max log characters                                         |
| `maxSlowTestThreshold`       | number         | 5       | Threshold (standard deviations) for slow test detection    |
| `includeAttachments`         | boolean        | true    | Include trace/screenshot paths                             |
| `enableDetailedReport`       | boolean        | true    | Generate detailed XML/Log files for failures               |
| `checkPreviousReports`       | boolean        | false   | Prompt to continue if previous failures exist              |
| `outputStream`               | WritableStream | stdout  | Custom output stream                                       |
| `getReproduceCommand`        | function       | -       | Custom callback to generate reproduce command              |

### AI Start Here Summary

The reporter automatically generates a `test-results/ai-start-here.md` file after each run. this file contains:

- **Failures**: Direct links to detailed failure reports.
- **Flaky Tests**: Tests that failed initially but passed on retry (with links to initial failure logs).
- **Slow Tests**: Tests that are significantly slower than the average (configurable via `maxSlowTestThreshold`).
- **Skipped Tests**: List of skipped tests.
- **Console Warnings**: Warnings emitted by passing tests.

### Custom Reproduce Command

You can customize the reproduce command output by providing a callback function. This is useful for wrapping the Playwright command in a shell script or custom runner.

```typescript
import { defineConfig } from '@playwright/test';
import { agenticReporter } from '@looted/agentic-reporter';

export default defineConfig({
  reporter: [
    agenticReporter({
      getReproduceCommand: ({ file, line, project }) => {
        return `./run-e2e.sh ${file}:${line} --project=${project}`;
      },
    }),
  ],
});
```

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
    <details_file>test-results/auth_login-details.xml</details_file>
  </failure>

  <result_summary status="failed" passed="43" failed="2" skipped="0" duration="14520ms" />
</test_run>
```

## License

MIT
