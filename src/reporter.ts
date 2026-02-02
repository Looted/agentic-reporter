/**
 * AgenticStream Playwright Reporter v2.0
 *
 * A specialized, high-density reporter for autonomous AI coding agents.
 * Outputs structured XML with Markdown payloads for machine-reliable parsing
 * while maximizing LLM natural language reasoning.
 *
 * Features:
 * - Zero-Latency: Streams to stdout (or custom stream), no file I/O
 * - Token Efficiency: "Silence on Success" - passing tests emit nothing
 * - High-Signal: Captures stack traces, console logs, attachments
 * - Overflow Protection: Truncates after N failures to prevent context exhaustion
 * - Library-Ready: Extractable as external npm package
 *
 * @example
 * ```typescript
 * // playwright.config.ts
 * import { defineConfig } from '@playwright/test';
 * import { agenticReporter } from '@looted/agentic-reporter';
 *
 * export default defineConfig({
 *   reporter: [
 *     agenticReporter({ maxFailures: 5 })
 *   ],
 * });
 * ```
 */

import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as path from 'path';
import * as fs from 'fs';

import type { AgenticReporterOptions, ResolvedOptions, FailureContext } from './types';
import { classifyError } from './hints';
import {
  formatHeader,
  formatFailure,
  formatOverflowWarning,
  formatSummary,
  cleanStack,
  sanitizeId,
} from './formatter';
import { getConsoleLogs } from './logProcessor';

/** Default configuration values */
const DEFAULTS: ResolvedOptions = {
  maxFailures: 5,
  maxStackFrames: 8,
  maxLogLines: 5,
  maxLogChars: 500,
  includeAttachments: true,
  enableDetailedReport: true,
  checkPreviousReports: false,
  exitOnExceedingMaxFailures: false,
  outputStream: process.stdout,
};

/**
 * Validate and resolve options with defaults.
 */
function resolveOptions(options: AgenticReporterOptions = {}): ResolvedOptions {
  const resolved: ResolvedOptions = {
    maxFailures: options.maxFailures ?? DEFAULTS.maxFailures,
    maxStackFrames: options.maxStackFrames ?? DEFAULTS.maxStackFrames,
    maxLogLines: options.maxLogLines ?? DEFAULTS.maxLogLines,
    maxLogChars: options.maxLogChars ?? DEFAULTS.maxLogChars,
    includeAttachments: options.includeAttachments ?? DEFAULTS.includeAttachments,
    enableDetailedReport: options.enableDetailedReport ?? DEFAULTS.enableDetailedReport,
    checkPreviousReports: options.checkPreviousReports ?? DEFAULTS.checkPreviousReports,
    exitOnExceedingMaxFailures:
      options.exitOnExceedingMaxFailures ?? DEFAULTS.exitOnExceedingMaxFailures,
    outputStream: options.outputStream ?? DEFAULTS.outputStream,
  };

  // Runtime validation
  if (resolved.maxFailures < 1) {
    console.warn('[AgenticReporter] maxFailures must be >= 1, using default');
    resolved.maxFailures = DEFAULTS.maxFailures;
  }
  if (resolved.maxStackFrames < 1) {
    console.warn('[AgenticReporter] maxStackFrames must be >= 1, using default');
    resolved.maxStackFrames = DEFAULTS.maxStackFrames;
  }

  return resolved;
}

class AgenticReporter implements Reporter {
  private readonly options: ResolvedOptions;
  private failureCount = 0;
  private passedCount = 0;
  private skippedCount = 0;
  private totalDuration = 0;
  private projectName = 'chromium';
  private suppressedCount = 0;
  private outputDir = 'test-results';

  constructor(options: AgenticReporterOptions = {}) {
    this.options = resolveOptions(options);
  }

  onBegin(config: FullConfig, suite: Suite): void {
    const totalTests = suite.allTests().length;
    const workers = config.workers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.outputDir = (config as any).outputDir || 'test-results';

    // Get project name from first project if available
    if (config.projects.length > 0) {
      this.projectName = config.projects[0].name || 'chromium';
    }

    // Check for previous failures if enabled
    if (this.options.checkPreviousReports) {
      this.checkForExistingReports();
    }

    this.write(formatHeader(totalTests, workers, this.projectName));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStdOut(chunk: string | Buffer, test?: TestCase, result?: TestResult): void {
    // Swallow logs - they are captured in result.stdout and reported on failure
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStdErr(chunk: string | Buffer, test?: TestCase, result?: TestResult): void {
    // Swallow logs - they are captured in result.stderr and reported on failure
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.totalDuration += result.duration;

    // Silence on Success: emit nothing for passing/skipped tests
    if (result.status === 'passed') {
      this.passedCount++;
      this.deleteFailureReport(test);
      return;
    }

    if (result.status === 'skipped') {
      this.skippedCount++;
      return;
    }

    // Count as failure (includes 'failed', 'timedOut', 'interrupted')
    this.failureCount++;

    // Overflow Guard: stop emitting details if too many failures
    if (this.failureCount > this.options.maxFailures) {
      this.suppressedCount++;
      if (this.options.exitOnExceedingMaxFailures) {
        this.write(
          `\n[AgenticReporter] Max failures (${this.options.maxFailures}) reached. Exiting immediately to save tokens.`
        );
        process.exit(1);
      }
      return;
    }

    this.emitFailure(test, result);
  }

  onEnd(result: FullResult): void {
    // Emit overflow warning if failures were suppressed
    if (this.suppressedCount > 0) {
      this.write(formatOverflowWarning(this.options.maxFailures, this.suppressedCount));
    }

    // Emit summary
    this.write(
      formatSummary(
        result.status,
        this.passedCount,
        this.failureCount,
        this.skippedCount,
        this.totalDuration
      )
    );
  }

  /** Emit a single failure block with full context */
  private emitFailure(test: TestCase, result: TestResult): void {
    const error = result.error;
    const errorMessage = error?.message ?? 'Unknown error';
    const { type: errorType, hint } = classifyError(errorMessage);
    const failureId = sanitizeId(test.titlePath().join('_'));
    let detailsPath: string | undefined;

    // Generate detailed report if enabled
    if (this.options.enableDetailedReport) {
      const fullContext: FailureContext = {
        failureId,
        errorType,
        fileName: path.basename(test.location.file),
        lineNumber: test.location.line,
        duration: result.duration,
        retry: result.retry,
        errorMessage,
        stack: cleanStack(error?.stack ?? '', 1000), // High limit for detailed report
        logs: this.getConsoleLogs(result, Infinity, Infinity),
        attachments: this.options.includeAttachments ? this.getAttachments(result) : '',
        hint,
        title: test.title,
        reproduceCommand: `npx playwright test ${test.location.file}:${test.location.line} --project=${this.projectName}`,
      };

      const fileContent = formatFailure(fullContext, {
        ...this.options,
        maxLogLines: Infinity,
      });

      const fileName = `${failureId}-details.xml`;
      const fullPath = path.join(this.outputDir, fileName);
      detailsPath = fullPath;

      try {
        fs.mkdirSync(this.outputDir, { recursive: true });
        fs.writeFileSync(fullPath, fileContent);
      } catch (err) {
        console.warn(`[AgenticReporter] Failed to write detailed report to ${fullPath}:`, err);
      }
    }

    const context: FailureContext = {
      failureId,
      errorType,
      fileName: path.basename(test.location.file),
      lineNumber: test.location.line,
      duration: result.duration,
      retry: result.retry,
      errorMessage,
      stack: cleanStack(error?.stack ?? '', this.options.maxStackFrames),
      logs: this.getConsoleLogs(result, this.options.maxLogLines, this.options.maxLogChars),
      attachments: this.options.includeAttachments ? this.getAttachments(result) : '',
      hint,
      title: test.title,
      reproduceCommand: `npx playwright test ${test.location.file}:${test.location.line} --project=${this.projectName}`,
      detailsPath,
    };

    this.write(formatFailure(context, this.options));
  }

  /** Extract console logs from test result */
  private getConsoleLogs(result: TestResult, maxLines: number, maxChars: number): string {
    return getConsoleLogs(result, maxLines, maxChars);
  }

  /** Get attachment paths (traces, screenshots) */
  private getAttachments(result: TestResult): string {
    if (!result.attachments || result.attachments.length === 0) {
      return '';
    }

    const lines: string[] = [];
    for (const attachment of result.attachments) {
      if (attachment.path) {
        const name = attachment.name || 'attachment';
        lines.push(`- ${name}: \`${attachment.path}\``);
      }
    }
    return lines.join('\n');
  }

  /** Write output to the configured stream */
  private write(content: string): void {
    this.options.outputStream.write(content + '\n');
  }

  /** Check for existing failure reports and prompt user */
  private checkForExistingReports(): void {
    if (!fs.existsSync(this.outputDir)) return;

    const files = fs.readdirSync(this.outputDir);
    const reportFiles = files.filter((f) => f.endsWith('-details.xml'));

    if (reportFiles.length > 0) {
      const failureList = reportFiles.map((f) => `    <failure>${f}</failure>`).join('\n');

      this.write(`
<agentic-prompt type="decision">
  <title>Previous Failure Reports Detected</title>
  <message>The following tests failed in the previous run:</message>
  <failures>
${failureList}
  </failures>
  <instruction>
    Analyze the code and fix these errors before running the full suite.
    Running tests without fixing errors wastes tokens.
  </instruction>
  <question>Do you want to ignore these failures and run the tests anyway? (y/n)</question>
</agentic-prompt>
> `);

      try {
        const buffer = Buffer.alloc(1);
        fs.readSync(0, buffer, 0, 1, null);
        const response = buffer.toString('utf-8').toLowerCase().trim();

        if (response !== 'y') {
          this.write('Exiting...');
          process.exit(1);
        }
      } catch (e) {
        this.write(`\n[AgenticReporter] Failed to read input: ${e}. Proceeding...`);
      }
    }
  }

  /** Delete failure report for a passing test */
  private deleteFailureReport(test: TestCase): void {
    if (!this.options.enableDetailedReport) return;

    const failureId = sanitizeId(test.titlePath().join('_'));
    const fileName = `${failureId}-details.xml`;
    const fullPath = path.join(this.outputDir, fileName);

    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // Ignore deletion errors
      }
    }
  }
}

export default AgenticReporter;
