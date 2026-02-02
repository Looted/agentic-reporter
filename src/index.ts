/**
 * AgenticStream Playwright Reporter
 *
 * A high-density, token-efficient reporter for AI coding agents.
 *
 * @packageDocumentation
 */

// Main reporter class
export { default as AgenticReporter } from './reporter';
export { default } from './reporter';

import type { AgenticReporterOptions } from './types';

// Types
export type {
  AgenticReporterOptions,
  ResolvedOptions,
  ErrorType,
  HintPattern,
  FailureContext,
} from './types';

// Utilities (for custom extensions)
export { classifyError, DEFAULT_HINT_PATTERNS } from './hints';
export {
  escapeXml,
  sanitizeId,
  cleanStack,
  buildMarkdownContext,
  formatFailure,
  formatHeader,
  formatOverflowWarning,
  formatSummary,
} from './formatter';

/**
 * Helper to configure the reporter with type safety
 */
export function agenticReporter(
  options: AgenticReporterOptions = {}
): ['@looted/agentic-reporter', AgenticReporterOptions] {
  return ['@looted/agentic-reporter', options];
}
