/**
 * AgenticStream Reporter Types
 * Public type definitions for the reporter library.
 */

/** Configuration options for the AgenticStream reporter */
export interface AgenticReporterOptions {
  /** Maximum failures before stopping execution (default: false). Set to a number to enable. */
  maxFailures?: number | false;
  /** Maximum stack trace frames to include (default: 8) */
  maxStackFrames?: number;
  /** Maximum console log lines to include (default: 5) */
  maxLogLines?: number;
  /** Maximum characters for console logs (default: 500) */
  maxLogChars?: number;
  /** Include attachment paths in output (default: true) */
  includeAttachments?: boolean;
  /** Enable detailed report file generation (default: true) */
  enableDetailedReport?: boolean;
  /** Check for previous failure reports on start and warn if found (default: false) */
  checkPreviousReports?: boolean;
  /** Behavior when previous failure reports exist (default: prompt) */
  previousReportsPolicy?: PreviousReportsPolicy;
  /** Immediately terminate execution when max failures is reached (default: false) */
  exitOnExceedingMaxFailures?: boolean;
  /** Interval in milliseconds to emit an XML progress update, or false to disable (default: 60000) */
  progressInterval?: number | false;
  /** Custom output stream (default: process.stdout) */
  outputStream?: NodeJS.WritableStream;
  /** Custom callback to generate reproduce command */
  getReproduceCommand?: (data: ReproduceCommandData) => string;
}

/** Data passed to the getReproduceCommand callback */
export interface ReproduceCommandData {
  file: string;
  line: number;
  project: string;
  title: string;
}

/** Resolved options with all defaults applied */
export type ResolvedOptions = Required<
  Omit<
    AgenticReporterOptions,
    'outputStream' | 'maxFailures' | 'progressInterval' | 'getReproduceCommand'
  >
> & {
  maxFailures: number;
  progressInterval: number | false;
  outputStream: NodeJS.WritableStream;
  getReproduceCommand?: (data: ReproduceCommandData) => string;
};

/** Non-interactive behavior for previous failure reports */
export type PreviousReportsPolicy = 'prompt' | 'warn' | 'fail' | 'ignore';

/** Error type classification for debugging hints */
export type ErrorType = 'timeout' | 'assertion' | 'network' | 'interrupted' | 'unknown';

/** High-level phase where a failure originated */
export type FailurePhase = 'setup' | 'data_setup' | 'assertion' | 'runtime' | 'unknown';

/** Failure source summary for agents */
export interface FailureSource {
  /** Phase where the failure likely originated */
  phase: FailurePhase;
  /** Concise human-readable summary */
  summary: string;
}

/** Hint pattern for error classification */
export interface HintPattern {
  /** Regex pattern to match against error message */
  pattern: RegExp;
  /** Human-readable hint for the AI agent */
  hint: string;
  /** Classified error type */
  type: ErrorType;
}

/** Failure context extracted from a test result */
export interface FailureContext {
  /** Sanitized failure ID for XML */
  failureId: string;
  /** Error type classification */
  errorType: ErrorType;
  /** Playwright project name */
  projectName?: string;
  /** Playwright test id when available */
  testId?: string;
  /** Full Playwright title path */
  fullTitlePath?: string;
  /** High-level source of the failure */
  failureSource?: FailureSource;
  /** Base filename */
  fileName: string;
  /** Line number of test */
  lineNumber: number;
  /** Test duration in ms */
  duration: number;
  /** Retry attempt number */
  retry: number;
  /** Error message */
  errorMessage: string;
  /** Cleaned stack trace */
  stack: string;
  /** Console output (last N lines) */
  logs: string;
  /** Attachment paths */
  attachments: string;
  /** Debugging hint */
  hint: string;
  /** Test title */
  title: string;
  /** Reproduce command */
  reproduceCommand: string;
  /** Path to the detailed report file */
  detailsPath?: string;
  /** Extracted HTML snapshot path */
  snapshotPath?: string;
  /** Working server URL from config */
  workingServerUrl?: string;
}
