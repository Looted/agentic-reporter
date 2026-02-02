import { describe, it, expect } from 'vitest';
import { getConsoleLogs } from '../src/logProcessor';
import type { TestResult } from '@playwright/test/reporter';

describe('getConsoleLogs', () => {
  const createResult = (stdout: (string | Buffer)[], stderr: (string | Buffer)[]): TestResult => ({
    stdout,
    stderr,
  } as unknown as TestResult);

  it('filters empty lines', () => {
    const result = createResult(['line1\n', '\n', 'line2\n', '   \n'], []);
    const output = getConsoleLogs(result, 10, 100);
    expect(output).toBe('line1\nline2');
  });

  it('respects maxLines', () => {
    const result = createResult(['1\n', '2\n', '3\n', '4\n', '5\n'], []);
    const output = getConsoleLogs(result, 3, 100);
    expect(output).toBe('3\n4\n5');
  });

  it('respects maxChars', () => {
    const result = createResult(['12345\n', '67890\n'], []);
    const output = getConsoleLogs(result, 10, 8);
    expect(output).toBe('12345\n67\n[...truncated]');
  });

  it('handles infinite maxLines', () => {
    const result = createResult(['1\n', '2\n', '3\n'], []);
    const output = getConsoleLogs(result, Infinity, 100);
    expect(output).toBe('1\n2\n3');
  });

  it('orders stdout then stderr', () => {
    const result = createResult(['out1\n'], ['err1\n']);
    const output = getConsoleLogs(result, 10, 100);
    expect(output).toBe('out1\nerr1');
  });

  it('handles Buffer inputs', () => {
    const result = createResult([Buffer.from('buf1\n')], [Buffer.from('buf2\n')]);
    const output = getConsoleLogs(result, 10, 100);
    expect(output).toBe('buf1\nbuf2');
  });

  it('handles mixed chunks and newlines', () => {
    const result = createResult(['a\nb\n'], ['c']);
    const output = getConsoleLogs(result, 10, 100);
    expect(output).toBe('a\nb\nc');
  });

  it('handles sliding window correctly with mixed stdout/stderr', () => {
     // If maxLines is 3.
     // stdout: A, B. (buffer: A, B)
     // stderr: C, D. (buffer: B, C, D) -> A pushed out when C added? No.
     // Let's trace:
     // push A -> [A]
     // push B -> [A, B]
     // push C -> [A, B, C]
     // push D -> [B, C, D] (A shifted out)

     const result = createResult(['A\n', 'B\n'], ['C\n', 'D\n']);
     const output = getConsoleLogs(result, 3, 100);
     expect(output).toBe('B\nC\nD');
  });
});
