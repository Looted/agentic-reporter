/**
 * AgenticStream Reporter Types
 * Public type definitions for the reporter library.
 */

/** Configuration options for the AgenticStream reporter */
export interface AgenticReporterOptions {
  /** Maximum failures to report before suppressing (default: 5) */
  maxFailures?: number;
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
  /** Check for previous failure reports on start and prompt to continue (default: false) */
  checkPreviousReports?: boolean;
  /** Immediately terminate execution when max failures is reached (default: false) */
  exitOnExceedingMaxFailures?: boolean;
  /** Custom output stream (default: process.stdout) */
  outputStream?: NodeJS.WritableStream;
}

/** Resolved options with all defaults applied */
export type ResolvedOptions = Required<Omit<AgenticReporterOptions, 'outputStream'>> & {
  outputStream: NodeJS.WritableStream;
};

/** Error type classification for debugging hints */
export type ErrorType = 'timeout' | 'assertion' | 'network' | 'interrupted' | 'unknown';

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
}
