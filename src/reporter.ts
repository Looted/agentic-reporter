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

import type {
  AgenticReporterOptions,
  ResolvedOptions,
  FailureContext,
  FailureSource,
} from './types';
import { classifyError } from './hints';
import {
  formatHeader,
  formatFailure,
  formatProgress,
  formatOverflowWarning,
  formatSummary,
  cleanStack,
  sanitizeId,
  escapeXml,
} from './formatter';
import { getConsoleLogs, truncateLogs } from './logProcessor';
import { extractHtmlSnapshot } from './traceParser';

/** Default configuration values */
const DEFAULTS: ResolvedOptions = {
  maxFailures: Infinity,
  maxStackFrames: 8,
  maxLogLines: 5,
  maxLogChars: 500,
  includeAttachments: true,
  enableDetailedReport: true,
  checkPreviousReports: false,
  previousReportsPolicy: 'prompt',
  exitOnExceedingMaxFailures: false,
  progressInterval: 60000,
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
    previousReportsPolicy: options.previousReportsPolicy ?? DEFAULTS.previousReportsPolicy,
    exitOnExceedingMaxFailures:
      options.exitOnExceedingMaxFailures ?? DEFAULTS.exitOnExceedingMaxFailures,
    progressInterval: options.progressInterval ?? DEFAULTS.progressInterval,
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
  private workingServerUrl?: string;
  private suppressedCount = 0;
  private outputDir = 'test-results';
  private readonly runId = `agentic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private readonly failedTestIds: string[] = [];
  private existingReports = new Set<string>();
  private pendingFileOps: Promise<void>[] = [];
  private failedTestIdCounts = new Map<string, number>();
  private totalTestsCount = 0;
  private workers = 0;
  private startTime = 0;
  private progressTimer?: NodeJS.Timeout;

  constructor(options: AgenticReporterOptions = {}) {
    this.options = resolveOptions(options);
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.totalTestsCount = suite.allTests().length;
    this.startTime = Date.now();
    const workers = config.workers;
    this.workers = workers;
    this.outputDir = this.resolveOutputDir(config);
    this.scanExistingReports();

    // Extract base URL / webServer URL
    if (config.webServer?.url) {
      this.workingServerUrl = config.webServer.url;
    } else if (config.projects.length > 0 && config.projects[0].use?.baseURL) {
      this.workingServerUrl = config.projects[0].use.baseURL;
    }

    // Get project name from first project if available
    if (config.projects.length > 0) {
      this.projectName = config.projects[0].name || 'chromium';
    }

    // Check for previous failures if enabled
    if (this.options.checkPreviousReports) {
      this.checkForExistingReports();
    } else if (
      this.options.enableDetailedReport &&
      this.options.previousReportsPolicy !== 'ignore'
    ) {
      this.warnAboutStaleArtifacts();
    }

    if (this.options.enableDetailedReport) {
      this.writeRunManifest('running');
    }

    this.write(formatHeader(this.totalTestsCount, workers, this.projectName));

    if (this.options.progressInterval !== false && this.options.progressInterval > 0) {
      this.progressTimer = setInterval(() => {
        this.emitProgress();
      }, this.options.progressInterval);
      // Ensure timer doesn't keep process alive
      if (this.progressTimer.unref) {
        this.progressTimer.unref();
      }
    }
  }

  private emitProgress(): void {
    const elapsed = Date.now() - this.startTime;
    this.write(
      formatProgress(
        this.passedCount,
        this.failureCount,
        this.skippedCount,
        this.flakyCount,
        this.totalTestsCount,
        elapsed
      )
    );
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

    const failureId = sanitizeId(test.titlePath().join('_'));

    if (result.status === 'passed') {
      if (result.retry === 0) {
        this.passedCount++;
        this.deleteFailureReport(test, failureId);
      } else {
        // Passed on retry -> Flaky
        this.flakyCount++;
        // If we previously counted this as a failure (due to incorrect suppression),
        // we should correct the stats now that it has passed.
        const previousFailures = this.failedTestIdCounts.get(failureId) || 0;
        if (previousFailures > 0) {
          this.failureCount -= previousFailures;
          this.failedTestIdCounts.delete(failureId);
        }

        // We want to report flaky tests as failures so AI knows what went wrong.
        // We find the most recent failed result for this test.
        const failedResult = test.results
          .slice()
          .reverse()
          .find(
            (r) => r.status === 'failed' || r.status === 'timedOut' || r.status === 'interrupted'
          );
        if (failedResult) {
          this.emitFailure(test, failedResult, failureId);
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

    this.emitFailure(test, result, failureId);
  }

  onEnd(result: FullResult): Promise<void> | void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = undefined;
    }

    const finalize = (): void => {
      if (this.options.enableDetailedReport) {
        this.writeRunManifest(result.status);
      }
      this.printFooter(result.status);
    };

    if (this.pendingFileOps.length === 0) {
      finalize();
      return;
    }

    return Promise.all(this.pendingFileOps).then(finalize);
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
  private emitFailure(test: TestCase, result: TestResult, failureId: string): void {
    const error = result.error;
    const errorMessage = error?.message ?? 'Unknown error';
    const { type: errorType, hint } = classifyError(errorMessage);
    const projectName = this.getProjectName(test);
    const testId = this.getTestId(test, failureId);
    const fullTitlePath = test.titlePath().join(' › ');
    const failureSource = this.classifyFailureSource(errorMessage, error?.stack ?? '');
    let detailsPath: string | undefined;

    this.failedTestIds.push(testId);

    const reproduceCommand = this.options.getReproduceCommand
      ? this.options.getReproduceCommand({
          file: test.location.file,
          line: test.location.line,
          project: projectName,
          title: test.title,
        })
      : `npx playwright test ${test.location.file}:${test.location.line} --project=${projectName}`;

    const fullLogs = this.options.enableDetailedReport
      ? this.getConsoleLogs(result, Infinity, Infinity)
      : '';

    let snapshotPath: string | undefined;
    const traceAttachment = this.options.enableDetailedReport
      ? result.attachments.find((a) => a.name === 'trace' && a.path?.endsWith('.zip'))
      : undefined;

    if (traceAttachment?.path) {
      const snapshotFileName = `${failureId}-snapshot.html`;
      const snapshotFilePath = path.join(this.outputDir, snapshotFileName);
      snapshotPath = snapshotFilePath;
      const tracePath = traceAttachment.path;
      const extractOp = fs.promises
        .mkdir(this.outputDir, { recursive: true })
        .then(() => extractHtmlSnapshot(tracePath, snapshotFilePath))
        .then(() => undefined)
        .catch(() => undefined);

      this.pendingFileOps.push(extractOp);
    }

    // Generate detailed report asynchronously
    if (this.options.enableDetailedReport) {
      const fullContext: FailureContext = {
        failureId,
        errorType,
        projectName,
        testId,
        fullTitlePath,
        failureSource,
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
        snapshotPath,
        workingServerUrl: this.workingServerUrl,
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

    // Emit standard output synchronously to maintain correct ordering
    const context: FailureContext = {
      failureId,
      errorType,
      projectName,
      testId,
      fullTitlePath,
      failureSource,
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
      snapshotPath,
      workingServerUrl: this.workingServerUrl,
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
        const type = this.classifyAttachment(name, attachment.path);
        const exists = fs.existsSync(attachment.path) ? 'exists' : 'missing';
        lines.push(`- ${name} (${type}, ${exists}): \`${attachment.path}\``);
      }
    }
    return lines.join('\n');
  }

  private classifyAttachment(name: string, attachmentPath: string): string {
    const normalized = `${name} ${attachmentPath}`.toLowerCase();
    if (normalized.includes('trace') || normalized.endsWith('.zip')) return 'trace';
    if (
      normalized.includes('screenshot') ||
      normalized.endsWith('.png') ||
      normalized.endsWith('.jpeg')
    ) {
      return 'screenshot';
    }
    if (normalized.includes('video') || normalized.endsWith('.webm')) return 'video';
    if (normalized.includes('error-context')) return 'error-context';
    if (normalized.includes('snapshot') || normalized.endsWith('.html')) return 'snapshot-html';
    if (normalized.includes('console') || normalized.endsWith('.log')) return 'console-log';
    return 'attachment';
  }

  private classifyFailureSource(errorMessage: string, stack: string): FailureSource {
    const text = `${errorMessage}\n${stack}`.toLowerCase();
    if (text.includes('beforeeach')) {
      return { phase: 'setup', summary: 'beforeEach hook setup' };
    }
    if (text.includes('before hooks') || text.includes('fixture')) {
      return { phase: 'setup', summary: 'setup hook' };
    }
    if (
      text.includes('seed') ||
      text.includes('duplicate annotations') ||
      text.includes('test data')
    ) {
      return { phase: 'data_setup', summary: 'seed failure in test data setup' };
    }
    if (text.includes('expect(') || text.includes('to be') || text.includes('locator')) {
      return { phase: 'assertion', summary: 'assertion failure' };
    }
    if (text.trim()) return { phase: 'runtime', summary: 'test runtime' };
    return { phase: 'unknown', summary: 'unknown failure source' };
  }

  private getTestId(test: TestCase, fallback: string): string {
    const candidate = (test as TestCase & { id?: string }).id;
    return candidate && candidate.trim() ? candidate : fallback;
  }

  private getProjectName(test: TestCase): string {
    const parentSuite = (test as TestCase & { parent?: Suite }).parent;
    return parentSuite?.project()?.name || this.projectName;
  }

  private resolveOutputDir(config: FullConfig): string {
    const configWithOutputDir = config as FullConfig & { outputDir?: string };
    return configWithOutputDir.outputDir ?? config.projects[0]?.outputDir ?? 'test-results';
  }

  private writeRunManifest(status: string): void {
    const manifestPath = path.join(this.outputDir, 'agentic-run-manifest.json');
    const manifest = {
      runId: this.runId,
      status,
      project: this.projectName,
      totalTests: this.totalTestsCount,
      workers: this.workers,
      passed: this.passedCount,
      failed: this.failureCount,
      skipped: this.skippedCount,
      suppressed: this.suppressedCount,
      durationMs: this.totalDuration,
      failedTests: this.failedTestIds,
      writtenAt: new Date().toISOString(),
    };

    try {
      fs.mkdirSync(this.outputDir, { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (err) {
      console.warn(`[AgenticReporter] Failed to write run manifest to ${manifestPath}:`, err);
    }
  }

  private scanExistingReports(): void {
    if (!this.options.enableDetailedReport || !fs.existsSync(this.outputDir)) return;

    try {
      const files = fs.readdirSync(this.outputDir);
      for (const file of files) {
        if (file.endsWith('-details.xml')) {
          this.existingReports.add(file);
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  private warnAboutStaleArtifacts(): void {
    if (!fs.existsSync(this.outputDir)) return;
    const manifestPath = path.join(this.outputDir, 'agentic-run-manifest.json');
    if (!fs.existsSync(manifestPath)) return;

    try {
      const reportFiles = fs
        .readdirSync(this.outputDir)
        .filter((file) => file.endsWith('-details.xml'));
      if (reportFiles.length === 0) return;
      const rawManifest = fs.readFileSync(manifestPath, 'utf-8');
      const parsedManifest = JSON.parse(rawManifest) as { runId?: string };
      const previousRunId = parsedManifest.runId ?? 'unknown';
      this
        .write(`<stale_artifact_warning previous_run_id="${escapeXml(previousRunId)}" stale_reports="${reportFiles.length}">
  <message>Existing failure detail files may belong to a previous run. Compare with agentic-run-manifest.json before trusting mixed artifacts.</message>
  <failures>
${reportFiles.map((file) => `    <failure>${escapeXml(file)}</failure>`).join('\n')}
  </failures>
</stale_artifact_warning>`);
    } catch (err) {
      this.write(`[AgenticReporter] Failed to inspect stale artifacts: ${err}`);
    }
  }

  /** Write output to the configured stream */
  private write(content: string): void {
    this.options.outputStream.write(content + '\n');
  }

  /** Check for existing failure reports and prompt user */
  private checkForExistingReports(): void {
    const reportFiles = Array.from(this.existingReports);

    if (reportFiles.length > 0) {
      const failureList = reportFiles
        .map((f) => `    <failure>${escapeXml(f)}</failure>`)
        .join('\n');

      if (this.options.previousReportsPolicy === 'ignore') return;

      if (this.options.previousReportsPolicy === 'warn') {
        this.write(`
<agentic-prompt type="warning">
  <title>Previous Failure Reports Detected</title>
  <policy>warn</policy>
  <message>The following tests failed in the previous run:</message>
  <failures>
${failureList}
  </failures>
</agentic-prompt>`);
        return;
      }

      if (this.options.previousReportsPolicy === 'fail') {
        this.write(`
<agentic-prompt type="error">
  <title>Previous Failure Reports Detected</title>
  <policy>fail</policy>
  <message>Previous failure reports exist. Refusing to continue.</message>
  <failures>
${failureList}
  </failures>
</agentic-prompt>`);
        process.exit(1);
        return;
      }

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
      } catch (err) {
        this.write(`
[AgenticReporter] Failed to read input: ${err}. Proceeding...`);
      }
    }
  }

  /** Delete failure report for a passing test */
  private deleteFailureReport(test: TestCase, failureId: string): void {
    if (!this.options.enableDetailedReport) return;

    const detailsFileName = `${failureId}-details.xml`;
    const detailsFullPath = path.join(this.outputDir, detailsFileName);
    const snapshotFileName = `${failureId}-snapshot.html`;
    const snapshotFullPath = path.join(this.outputDir, snapshotFileName);

    this.existingReports.delete(detailsFileName);

    // We explicitly delete rather than checking existingReports
    // because reports might be present from a completely different prior run
    // without having been tracked, or from the same run before existingReports was synced.
    this.pendingFileOps.push(fs.promises.unlink(detailsFullPath).catch(() => {}));
    this.pendingFileOps.push(fs.promises.unlink(snapshotFullPath).catch(() => {}));
  }
}

export default AgenticReporter;
