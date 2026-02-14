/**
 * AgenticStream Reporter - XML/Markdown Formatter
 * Utilities for formatting test output in the XML-Markdown hybrid format.
 */

import * as crypto from 'crypto';
import type { FailureContext, ResolvedOptions } from './types';

const XML_CHAR_MAP: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;',
};

const XML_REGEX = /[<>&"']/g;
const XML_TEST_REGEX = /[<>&"']/;

/**
 * Escape special XML characters in a string.
 */
export function escapeXml(str: string): string {
  if (!str) return '';
  // Optimization: If no special characters are present, return the original string.
  // This avoids the overhead of replace() and callback invocation for the common case.
  if (!XML_TEST_REGEX.test(str)) return str;
  return str.replace(XML_REGEX, (c) => XML_CHAR_MAP[c]);
}

/**
 * Sanitize a string for use as an XML id attribute.
 */
export function sanitizeId(str: string): string {
  const hash = crypto.createHash('sha1').update(str).digest('hex').slice(0, 8);
  const sanitized = str.replace(/[^a-zA-Z0-9-]+/g, '_');
  // Truncate to 200 to leave room for hash (8 chars) + separator (1 char) = 9 chars.
  // Total length <= 209 chars, well within 220 limit.
  return `${sanitized.slice(0, 200)}_${hash}`;
}

/**
 * Clean and truncate a stack trace.
 */
export function cleanStack(stack: string, maxFrames: number): string {
  if (!stack) return '';

  const lines: string[] = [];
  let startIndex = 0;

  while (lines.length < maxFrames && startIndex < stack.length) {
    let endIndex = stack.indexOf('\n', startIndex);
    if (endIndex === -1) {
      endIndex = stack.length;
    }

    const line = stack.slice(startIndex, endIndex);
    startIndex = endIndex + 1;

    const trimmed = line.trim();
    if (!trimmed) continue;
    // Remove internal Playwright/Node frames
    if (trimmed.includes('node_modules')) continue;
    if (trimmed.includes('playwright/lib')) continue;
    if (trimmed.includes('internal/')) continue;

    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Build markdown content for the CDATA block.
 */
export function buildMarkdownContext(context: FailureContext, options: ResolvedOptions): string {
  const lines: string[] = [];

  lines.push(`**Test:** ${context.title}`);
  lines.push(`**File:** \`${context.fileName}:${context.lineNumber}\``);
  lines.push(`**Duration:** ${context.duration}ms`);
  lines.push('');

  if (context.stack) {
    lines.push('**Error Stack:**');
    lines.push('```text');
    lines.push(context.stack);
    lines.push('```');
    lines.push('');
  }

  if (context.logs) {
    lines.push(`**Console Logs (last ${options.maxLogLines}):**`);
    lines.push('```text');
    lines.push(context.logs);
    lines.push('```');
    lines.push('');
  }

  if (context.attachments) {
    lines.push('**Attachments:**');
    lines.push(context.attachments);
    lines.push('');
  }

  lines.push(`**Hint:** ${context.hint}`);

  if (context.detailsPath) {
    lines.push('');
    lines.push(`**Full Details:** ${context.detailsPath}`);
  }

  return lines.join('\n');
}

/**
 * Format a failure as an XML block with CDATA-wrapped markdown.
 */
export function formatFailure(context: FailureContext, options: ResolvedOptions): string {
  const markdown = buildMarkdownContext(context, options);
  const detailsTag = context.detailsPath
    ? `\n    <details_file>${escapeXml(context.detailsPath)}</details_file>`
    : '';

  return `  <failure id="${context.failureId}" type="${context.errorType}" file="${escapeXml(context.fileName)}" line="${context.lineNumber}" duration="${context.duration}ms" retry="${context.retry}">
    <error_summary>${escapeXml(context.errorMessage)}</error_summary>
    <context_markdown><![CDATA[
${markdown}
    ]]></context_markdown>
    <reproduce_command>${escapeXml(context.reproduceCommand)}</reproduce_command>${detailsTag}
  </failure>`;
}

/**
 * Format the test run header.
 */
export function formatHeader(totalTests: number, workers: number, project: string): string {
  return `<test_run>
  <suite_info total="${totalTests}" workers="${workers}" project="${escapeXml(project)}" />`;
}

/**
 * Format the overflow warning.
 */
export function formatOverflowWarning(maxFailures: number, suppressedCount: number): string {
  return `  <overflow_warning suppressed="${suppressedCount}">
    Max failure limit (${maxFailures}) reached. Execution aborted. Fix the above issues first.
  </overflow_warning>`;
}

/**
 * Format the result summary.
 */
export function formatSummary(
  status: string,
  passed: number,
  failed: number,
  skipped: number,
  flaky: number,
  duration: number
): string {
  return `  <result_summary status="${status}" passed="${passed}" failed="${failed}" skipped="${skipped}" flaky="${flaky}" duration="${duration}ms" />
</test_run>`;
}
