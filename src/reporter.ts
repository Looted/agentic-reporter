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
import { getConsoleLogs, truncateLogs } from './logProcessor';

/** Default configuration values */
const DEFAULTS: ResolvedOptions = {
  maxFailures: Infinity,
  maxStackFrames: 8,
  maxLogLines: 5,
  maxLogChars: 500,
  includeAttachments: true,
  enableDetailedReport: true,
  checkPreviousReports: false,
  outputStream: process.stdout,
};

/**
 * Validate and resolve options with defaults.
 */
function resolveOptions(options: AgenticReporterOptions = {}): ResolvedOptions {
  let maxFailures = options.maxFailures;
  // If explicitly undefined, use default (which is now Infinity)
  if (maxFailures === undefined) {
    maxFailures = DEFAULTS.maxFailures;
  }
  // If explicitly false, use Infinity
  if (maxFailures === false) {
    maxFailures = Infinity;
  }

  const resolved: ResolvedOptions = {
    maxFailures: maxFailures as number,
    maxStackFrames: options.maxStackFrames ?? DEFAULTS.maxStackFrames,
    maxLogLines: options.maxLogLines ?? DEFAULTS.maxLogLines,
    maxLogChars: options.maxLogChars ?? DEFAULTS.maxLogChars,
    includeAttachments: options.includeAttachments ?? DEFAULTS.includeAttachments,
    enableDetailedReport: options.enableDetailedReport ?? DEFAULTS.enableDetailedReport,
    checkPreviousReports: options.checkPreviousReports ?? DEFAULTS.checkPreviousReports,
    outputStream: options.outputStream ?? DEFAULTS.outputStream,
    getReproduceCommand: options.getReproduceCommand,
  };

  // Runtime validation
  if (resolved.maxFailures < 1 && resolved.maxFailures !== Infinity) {
    console.warn('[AgenticReporter] maxFailures must be >= 1 or false, using default');
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
  private flakyCount = 0;
  private totalDuration = 0;
  private projectName = 'chromium';
  private suppressedCount = 0;
  private outputDir = 'test-results';
  private existingReports = new Set<string>();
  private pendingFileOps: Promise<void>[] = [];
  private failedTestIdCounts = new Map<string, number>();

  constructor(options: AgenticReporterOptions = {}) {
    this.options = resolveOptions(options);
  }

  async onBegin(config: FullConfig, suite: Suite): Promise<void> {
    const totalTests = suite.allTests().length;
    const workers = config.workers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.outputDir = (config as any).outputDir || 'test-results';

    // Scan for existing reports to optimize deletions
    try {
      const stats = await fs.promises.stat(this.outputDir).catch(() => null);
      if (stats && stats.isDirectory()) {
        const files = await fs.promises.readdir(this.outputDir);
        for (const file of files) {
          if (file.endsWith('-details.xml')) {
            this.existingReports.add(file);
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }

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

    if (result.status === 'skipped') {
      this.skippedCount++;
      return;
    }

    if (result.status === 'passed') {
      if (result.retry === 0) {
        this.passedCount++;
        this.deleteFailureReport(test);
      } else {
        // Passed on retry -> Flaky
        this.flakyCount++;
        // If we previously counted this as a failure (due to incorrect suppression),
        // we should correct the stats now that it has passed.
        const failureId = sanitizeId(test.titlePath().join('_'));
        const previousFailures = this.failedTestIdCounts.get(failureId) || 0;
        if (previousFailures > 0) {
          this.failureCount -= previousFailures;
          this.failedTestIdCounts.delete(failureId);
        }
      }
      return;
    }

    // Failure Case
    // Only count/emit if this is the final attempt
    const retries = test.retries ?? 0;
    if (result.retry < retries) {
      // Intermediate failure - suppress
      return;
    }

    // Count as failure (includes 'failed', 'timedOut', 'interrupted')
    this.failureCount++;
    const failureId = sanitizeId(test.titlePath().join('_'));
    const current = this.failedTestIdCounts.get(failureId) || 0;
    this.failedTestIdCounts.set(failureId, current + 1);

    // Overflow Guard: stop emitting details if too many failures
    if (this.failureCount > this.options.maxFailures) {
      this.suppressedCount++;
      this.write(
        `\n[AgenticReporter] Max failures (${this.options.maxFailures}) reached. Exiting immediately to save tokens.`
      );
      // Clean exit
      this.printFooter('failed');
      process.exit(1);
    }

    this.emitFailure(test, result);
  }

  async onEnd(result: FullResult): Promise<void> {
    await Promise.all(this.pendingFileOps);
    this.printFooter(result.status);
  }

  private printFooter(status: string): void {
    // Emit overflow warning if failures were suppressed
    if (this.suppressedCount > 0) {
      this.write(formatOverflowWarning(this.options.maxFailures, this.suppressedCount));
    }

    // Emit summary
    this.write(
      formatSummary(
        status,
        this.passedCount,
        this.failureCount,
        this.skippedCount,
        this.flakyCount,
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

    // Correct project name resolution
    const projectName = test.parent?.project()?.name || this.projectName;

    const reproduceCommand = this.options.getReproduceCommand
      ? this.options.getReproduceCommand({
          file: test.location.file,
          line: test.location.line,
          project: projectName,
          title: test.title,
        })
      : `npx playwright test ${test.location.file}:${test.location.line} --project=${projectName}`;

    // Optimization: Call getConsoleLogs only once if detailed report is enabled
    const fullLogs = this.options.enableDetailedReport
      ? this.getConsoleLogs(result, Infinity, Infinity)
      : '';

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
        logs: fullLogs,
        attachments: this.options.includeAttachments ? this.getAttachments(result) : '',
        hint,
        title: test.title,
        reproduceCommand,
      };

      const fileContent = formatFailure(fullContext, {
        ...this.options,
        maxLogLines: Infinity,
      });

      const fileName = `${failureId}-details.xml`;
      const fullPath = path.join(this.outputDir, fileName);
      detailsPath = fullPath;

      const writeOp = fs.promises
        .mkdir(this.outputDir, { recursive: true })
        .then(() => fs.promises.writeFile(fullPath, fileContent))
        .then(() => {
          this.existingReports.add(fileName);
        })
        .catch((err) => {
          console.warn(`[AgenticReporter] Failed to write detailed report to ${fullPath}:`, err);
        });

      this.pendingFileOps.push(writeOp);
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
      logs: this.options.enableDetailedReport
        ? truncateLogs(fullLogs, this.options.maxLogLines, this.options.maxLogChars)
        : this.getConsoleLogs(result, this.options.maxLogLines, this.options.maxLogChars),
      attachments: this.options.includeAttachments ? this.getAttachments(result) : '',
      hint,
      title: test.title,
      reproduceCommand,
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
    if (this.existingReports.size > 0) {
      const failureList = Array.from(this.existingReports)
        .map((f) => `    <failure>${f}</failure>`)
        .join('\n');

      this.write(`
<agentic-warning type="previous_failures">
  <message>The following tests failed in the previous run:</message>
  <failures>
${failureList}
  </failures>
  <instruction>
    Analyze the code and fix these errors before running the full suite.
  </instruction>
</agentic-warning>
`);
    }
  }

  /** Delete failure report for a passing test */
  private deleteFailureReport(test: TestCase): void {
    if (!this.options.enableDetailedReport) return;

    const failureId = sanitizeId(test.titlePath().join('_'));
    const fileName = `${failureId}-details.xml`;
    const fullPath = path.join(this.outputDir, fileName);

    if (this.existingReports.has(fileName)) {
      this.existingReports.delete(fileName);
      this.pendingFileOps.push(fs.promises.unlink(fullPath).catch(() => {}));
    }
  }
}

export default AgenticReporter;
