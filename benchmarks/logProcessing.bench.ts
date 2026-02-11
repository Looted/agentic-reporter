import { performance } from 'perf_hooks';
import type { TestResult } from '@playwright/test/reporter';
import { getConsoleLogs } from '../src/logProcessor';

function generateMassiveResult(lines: number): TestResult {
  const linesPerChunk = 1000;
  const chunksCount = Math.ceil(lines / linesPerChunk);
  const stdout: string[] = [];

  for (let i = 0; i < chunksCount; i++) {
    // Each chunk is 1000 lines
    stdout.push(Array(linesPerChunk).fill('log line content').join('\n') + '\n');
  }

  return {
    stdout,
    stderr: [],
  } as unknown as TestResult;
}

function runBenchmark() {
  const lines = 1_000_000;
  const maxLines = 50_000;
  const maxChars = 10_000_000;

  console.log(`Generating test data (${lines} lines)...`);
  const massiveResult = generateMassiveResult(lines);

  console.log(`Running benchmark with maxLines=${maxLines}...`);
  const start = performance.now();
  getConsoleLogs(massiveResult, maxLines, maxChars);
  const end = performance.now();

  console.log(`Time taken: ${(end - start).toFixed(2)}ms`);
}

runBenchmark();
