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

  const isInfinite = maxLines === Infinity;

  if (isInfinite) {
    const buffer: string[] = [];
    const processChunk = (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim() !== '') {
          buffer.push(line);
        }
      }
    };
    for (const chunk of result.stdout) processChunk(chunk);
    for (const chunk of result.stderr) processChunk(chunk);

    let output = buffer.join('\n');
    if (output.length > maxChars) {
      output = output.slice(0, maxChars) + '\n[...truncated]';
    }
    return output;
  }

  // Circular buffer implementation for finite maxLines
  const buffer: string[] = [];
  let writeIndex = 0;

  const processChunk = (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.trim() !== '') {
        if (buffer.length < maxLines) {
          buffer.push(line);
        } else {
          buffer[writeIndex] = line;
          writeIndex++;
          if (writeIndex >= maxLines) {
            writeIndex = 0;
          }
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

  // Reconstruct the order
  let orderedBuffer: string[];
  if (buffer.length < maxLines) {
    orderedBuffer = buffer;
  } else {
    // writeIndex points to the *next* insertion point, which is the *oldest* element.
    // So the oldest element is at writeIndex.
    // The newest element is at writeIndex - 1 (wrapping around).
    // So we want to start reading from writeIndex.

    // Example: [D, B, C]. writeIndex=1.
    // Start at 1: B, C. Then 0: D. -> B, C, D. Correct.

    const start = writeIndex;
    orderedBuffer = buffer.slice(start).concat(buffer.slice(0, start));
  }

  // Truncate if too long (maxChars)
  let output = orderedBuffer.join('\n');
  if (output.length > maxChars) {
    output = output.slice(0, maxChars) + '\n[...truncated]';
  }

  return output;
}

/**
 * Truncate an existing log string based on line and character limits.
 *
 * @param logs The already extracted log string
 * @param maxLines Maximum number of lines to keep (from the end)
 * @param maxChars Maximum number of characters to return
 * @returns The formatted log string, potentially truncated
 */
export function truncateLogs(logs: string, maxLines: number, maxChars: number): string {
  if (maxLines === 0) return '';

  let lines = logs.split('\n');
  const isInfiniteLines = maxLines === Infinity;
  const isInfiniteChars = maxChars === Infinity;

  if (!isInfiniteLines && lines.length > maxLines) {
    lines = lines.slice(-maxLines);
  }

  let output = lines.join('\n');
  if (!isInfiniteChars && output.length > maxChars) {
    output = output.slice(0, maxChars) + '\n[...truncated]';
  }

  return output;
}
