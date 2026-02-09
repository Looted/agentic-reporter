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
  escapeXml,
} from './formatter';
import { getConsoleLogs } from './logProcessor';
import { generateAIStartHere } from './summaryGenerator';

/** Default configuration values */
const DEFAULTS: ResolvedOptions = {
  maxFailures: Infinity,
  maxStackFrames: 8,
  maxLogLines: 5,
  maxLogChars: 500,
  maxSlowTestThreshold: 5,
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
    maxSlowTestThreshold: options.maxSlowTestThreshold ?? DEFAULTS.maxSlowTestThreshold,
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
  private totalDuration = 0;
  private projectName = 'chromium';
  private suppressedCount = 0;
  private outputDir = 'test-results';

  // Tracking for new features
  private allTestDurations: number[] = [];
  private slowTests: { test: TestCase; result: TestResult; duration: number; threshold: number }[] =
    [];
  private flakyTests: { test: TestCase; result: TestResult }[] = [];
  private skippedTests: { test: TestCase }[] = [];
  private failedTests: { test: TestCase; result: TestResult }[] = [];
  private warnings: { test: TestCase; message: string }[] = [];

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

    // Track duration for all executed tests (excluding skipped)
    if (result.status !== 'skipped') {
      this.allTestDurations.push(result.duration);
      this.completedTests.push({ test, result, duration: result.duration });
    }

    // Check for console warnings in stderr (even if passed)
    if (result.stderr && result.stderr.length > 0) {
      const stderrText = result.stderr.map((c) => c.toString()).join('\n');
      if (stderrText.trim().length > 0) {
        this.warnings.push({ test, message: stderrText });
      }
    }

    if (result.status === 'passed') {
      this.passedCount++;

      // Check for Flaky
      if (test.outcome() === 'flaky') {
        this.flakyTests.push({ test, result });
        // Do NOT delete failure report for flaky tests (preserve history)
      } else {
        // Clean pass
        this.deleteFailureReport(test);
      }
      return;
    }

    if (result.status === 'skipped') {
      this.skippedCount++;
      this.skippedTests.push({ test });
      this.write(
        `  <skipped id="${sanitizeId(test.titlePath().join('_'))}" title="${escapeXml(test.title)}" />`
      );
      return;
    }

    // Count as failure (includes 'failed', 'timedOut', 'interrupted')
    this.failureCount++;
    this.failedTests.push({ test, result });

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

  onEnd(result: FullResult): void {
    this.printFooter(result.status);

    // Generate AI Start Here Summary
    generateAIStartHere(
      this.outputDir,
      this.failedTests,
      this.flakyTests,
      this.slowTests,
      this.skippedTests,
      this.warnings,
      this.options
    );
  }

  private printFooter(status: string): void {
    // Calculate slow tests here before printing
    this.detectSlowTests();

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
        this.totalDuration
      )
    );

    // Emit Warnings
    if (this.warnings.length > 0) {
      this.write(`  <warnings>`);
      for (const w of this.warnings) {
        this.write(
          `    <warning test="${escapeXml(w.test.title)}"><![CDATA[${w.message}]]></warning>`
        );
      }
      this.write(`  </warnings>`);
    }

    // Emit Flaky Tests
    if (this.flakyTests.length > 0) {
      this.write(`  <flaky_tests>`);
      for (const f of this.flakyTests) {
        this.write(
          `    <flaky id="${sanitizeId(f.test.titlePath().join('_'))}" title="${escapeXml(f.test.title)}" retry="${f.result.retry}" />`
        );
      }
      this.write(`  </flaky_tests>`);
    }

    // Emit Slow Tests
    if (this.slowTests.length > 0) {
      this.write(`  <slow_tests threshold="${this.slowThreshold.toFixed(2)}ms">`);
      for (const s of this.slowTests) {
        this.write(
          `    <slow id="${sanitizeId(s.test.titlePath().join('_'))}" title="${escapeXml(s.test.title)}" duration="${s.duration}ms" />`
        );
      }
      this.write(`  </slow_tests>`);
    }
  }

  private completedTests: { test: TestCase; duration: number; result: TestResult }[] = [];
  private slowThreshold = 0;

  private detectSlowTests(): void {
    if (this.completedTests.length < 2) return;

    const durations = this.completedTests.map((t) => t.duration);
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = durations.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);

    this.slowThreshold = mean + this.options.maxSlowTestThreshold * stdDev;

    this.slowTests = this.completedTests
      .filter((t) => t.duration > this.slowThreshold)
      .map((t) => ({
        test: t.test,
        result: t.result,
        duration: t.duration,
        threshold: this.slowThreshold,
      }));
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
        reproduceCommand,
      };

      const fileContent = formatFailure(fullContext, {
        ...this.options,
        maxLogLines: Infinity,
      });

      // Append retry index to filename to preserve history for flaky tests
      const retrySuffix = result.retry > 0 ? `-retry${result.retry}` : '';
      const fileName = `${failureId}${retrySuffix}-details.xml`;
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
    if (!fs.existsSync(this.outputDir)) return;

    const files = fs.readdirSync(this.outputDir);
    const reportFiles = files.filter((f) => f.endsWith('-details.xml'));

    if (reportFiles.length > 0) {
      const failureList = reportFiles.map((f) => `    <failure>${f}</failure>`).join('\n');

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
    // We now have potentially multiple files (retry0, retry1, etc.)
    // We should clean up all of them if the test passed cleanly.

    // Pattern: failureId + (-retryN)? + -details.xml
    // Simple approach: list files and delete matches
    if (!fs.existsSync(this.outputDir)) return;

    try {
      const files = fs.readdirSync(this.outputDir);
      const prefix = `${failureId}`;

      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith('-details.xml')) {
          // Check if it belongs to this test ID (exact match on prefix part)
          // failureId is "test_name_..."
          // File is "test_name_...-details.xml" or "test_name_...-retry1-details.xml"
          // Ensure we don't delete "test_name_other_..."
          // We can check if file starts with failureId + '-' or failureId + '.xml' (not possible here)
          // Actually sanitizeId replaces non-alphanumeric with _, so no dots.
          // The suffix starts with -details.xml or -retry...
          // Let's be careful.
          // Best way: construct exact possible names? No, retries can be many.
          // Regex match?
          const suffix = file.substring(failureId.length);
          // Suffix should look like "-details.xml" or "-retry1-details.xml"
          if (suffix === '-details.xml' || /^-retry\d+-details\.xml$/.test(suffix)) {
            fs.unlinkSync(path.join(this.outputDir, file));
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }
}

export default AgenticReporter;
