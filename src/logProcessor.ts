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
  const buffer: string[] = [];
  const isInfinite = maxLines === Infinity;

  const processChunk = (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.trim() !== '') {
        buffer.push(line);
        // Maintain sliding window if not infinite
        if (!isInfinite && buffer.length > maxLines) {
          buffer.shift();
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

  // Truncate if too long (maxChars)
  let output = buffer.join('\n');
  if (output.length > maxChars) {
    output = output.slice(0, maxChars) + '\n[...truncated]';
  }

  return output;
}
