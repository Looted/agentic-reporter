/**
 * AgenticStream Reporter - Error Hints
 * Extensible error classification patterns with debugging hints.
 */

import type { ErrorType, HintPattern } from './types';

/** Default hint patterns for common error types */
export const DEFAULT_HINT_PATTERNS: HintPattern[] = [
  // Timeout errors
  {
    pattern: /timeout/i,
    hint: 'Selector missing/hidden? Check element visibility, increase timeout, or verify the page loaded.',
    type: 'timeout',
  },
  {
    pattern: /waitfor.*selector/i,
    hint: 'Element not found. Verify the selector, check if content is dynamically loaded.',
    type: 'timeout',
  },
  {
    pattern: /locator\.click/i,
    hint: 'Click action failed. Element may be detached, obscured, or not clickable.',
    type: 'timeout',
  },

  // Assertion errors
  {
    pattern: /expect\(received\)\.to/i,
    hint: 'Assertion mismatch. Check if data needs normalization (trim, lowercase, type coercion).',
    type: 'assertion',
  },
  {
    pattern: /expected.*received/i,
    hint: 'Value mismatch. Compare expected vs actual carefully - check for whitespace or encoding.',
    type: 'assertion',
  },
  {
    pattern: /tobevisible/i,
    hint: 'Element visibility check failed. Check if element exists, is in viewport, or has display:none.',
    type: 'assertion',
  },
  {
    pattern: /tohaveurl/i,
    hint: 'URL assertion failed. Check routing, redirects, or if navigation completed.',
    type: 'assertion',
  },

  // Network errors
  {
    pattern: /500|502|503|504/,
    hint: 'Server error. Check API logs, backend availability, or database connections.',
    type: 'network',
  },
  {
    pattern: /401|403/,
    hint: 'Authentication/Authorization error. Check credentials, tokens, or permissions.',
    type: 'network',
  },
  {
    pattern: /404/,
    hint: 'Resource not found. Verify the URL, route configuration, or if the resource exists.',
    type: 'network',
  },
  {
    pattern: /econnrefused|enotfound|fetch.*failed/i,
    hint: 'Network connection failed. Is the server running? Check URL and port.',
    type: 'network',
  },

  // Interrupted
  {
    pattern: /interrupted/i,
    hint: 'Test was interrupted (user cancelled or CI timeout).',
    type: 'interrupted',
  },
];

/**
 * Classify an error message and return the appropriate hint.
 * @param message - The error message to classify
 * @param customPatterns - Optional additional patterns to check first
 * @returns Error type and hint string
 */
export function classifyError(
  message: string,
  customPatterns: HintPattern[] = []
): { type: ErrorType; hint: string } {
  // Check custom patterns first
  for (const { pattern, hint, type } of customPatterns) {
    if (pattern.test(message)) {
      return { type, hint };
    }
  }

  // Then check default patterns
  for (const { pattern, hint, type } of DEFAULT_HINT_PATTERNS) {
    if (pattern.test(message)) {
      return { type, hint };
    }
  }

  return {
    type: 'unknown',
    hint: 'Check the stack trace for logic errors or unexpected state.',
  };
}
