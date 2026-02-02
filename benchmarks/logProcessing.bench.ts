
import { performance } from 'perf_hooks';
import type { TestResult } from '@playwright/test/reporter';

// Mock TestResult
// Generate massive data with HUGE chunks to trigger stack overflow in spread
function generateMassiveResult(lines: number): TestResult {
  // Create a single massive chunk if lines is large
  // Node.js stack limit for spread is often around ~125,000 arguments
  const linesPerChunk = 200_000;
  const chunksCount = Math.ceil(lines / linesPerChunk);
  const stdout: string[] = [];

  for (let i = 0; i < chunksCount; i++) {
    stdout.push(Array(linesPerChunk).fill('log line content').join('\n') + '\n');
  }

  return {
    stdout,
    stderr: [],
  } as unknown as TestResult;
}

// Current implementation (Baseline)
function getConsoleLogsBaseline(result: TestResult, maxLines: number, maxChars: number): string {
  const allOutput: string[] = [];

  // Process stdout (test code console.log)
  for (const chunk of result.stdout) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    // @ts-ignore
    allOutput.push(...text.split('\n'));
  }

  // Process stderr (test code console.error)
  for (const chunk of result.stderr) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    // @ts-ignore
    allOutput.push(...text.split('\n'));
  }

  // Filter empty lines and take last N
  const filtered = allOutput.filter((line) => line.trim() !== '');
  const lastLines = filtered.slice(-maxLines);

  // Truncate if too long
  let output = lastLines.join('\n');
  if (output.length > maxChars) {
    output = output.slice(0, maxChars) + '\n[...truncated]';
  }

  return output;
}

// Optimized Implementation (Draft)
function getConsoleLogsOptimized(result: TestResult, maxLines: number, maxChars: number): string {
  const buffer: string[] = [];
  const isInfinite = maxLines === Infinity;

  const processChunk = (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.trim() !== '') {
        buffer.push(line);
        if (!isInfinite && buffer.length > maxLines) {
          buffer.shift();
        }
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

function runBenchmark() {
  const lines = 200_000; // Single massive chunk
  console.log(`Generating massive test data (${lines} lines)...`);
  const massiveResult = generateMassiveResult(lines);
  const maxLines = 5;
  const maxChars = 500;

  console.log('Starting Benchmark...');

  // Measure Baseline
  let baselineTime = -1;
  try {
    const start = performance.now();
    getConsoleLogsBaseline(massiveResult, maxLines, maxChars);
    baselineTime = performance.now() - start;
    console.log(`Baseline Time: ${baselineTime.toFixed(2)}ms`);
  } catch (e) {
    console.log(`Baseline Failed: ${e}`);
  }

  // Measure Optimized
  try {
    const startOpt = performance.now();
    getConsoleLogsOptimized(massiveResult, maxLines, maxChars);
    const optTime = performance.now() - startOpt;
    console.log(`Optimized Time: ${optTime.toFixed(2)}ms`);

    if (baselineTime > 0) {
      console.log(`Improvement: ${(baselineTime / optTime).toFixed(2)}x faster`);
    } else {
        console.log('Optimized version prevented a crash!');
    }
  } catch(e) {
    console.log(`Optimized Failed: ${e}`);
  }
}

runBenchmark();
