import type { TestResult } from '@playwright/test/reporter';

/**
 * Extract console logs from test result in a memory-efficient way.
 *
 * @param result The Playwright TestResult object containing stdout/stderr chunks
 * @param maxLines Maximum number of lines to keep (from the end)
 * @param maxChars Maximum number of characters to return
 * @returns The formatted log string, potentially truncated
 */
export function getConsoleLogs(result: TestResult, maxLines: number, maxChars: number): string {
  if (maxLines === 0) return '';

  let buffer: string[] = [];
  const isInfinite = maxLines === Infinity;
  // Amortized optimization: slice when buffer grows too large
  // We use 2x maxLines as a reasonable trade-off between memory and CPU
  const maxBuffer = maxLines * 2;

  const processChunk = (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.trim() !== '') {
        buffer.push(line);
        // Maintain sliding window if not infinite
        if (!isInfinite && buffer.length > maxBuffer) {
          buffer = buffer.slice(-maxLines);
        }
      }
    }
  };

  // Process stdout (test code console.log)
  for (const chunk of result.stdout) {
    processChunk(chunk);
  }

  // Process stderr (test code console.error)
  for (const chunk of result.stderr) {
    processChunk(chunk);
  }

  // Final trim to ensure we respect maxLines exactly
  if (!isInfinite && buffer.length > maxLines) {
    buffer = buffer.slice(-maxLines);
  }

  // Truncate if too long (maxChars)
  let output = buffer.join('\n');
  if (output.length > maxChars) {
    output = output.slice(0, maxChars) + '\n[...truncated]';
  }

  return output;
}
