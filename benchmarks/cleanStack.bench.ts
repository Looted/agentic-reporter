
import { cleanStack } from '../src/formatter';
import { performance } from 'perf_hooks';

// Generate a deep stack trace
function generateStack(depth: number): string {
  const lines = ['Error: Something went wrong'];
  for (let i = 0; i < depth; i++) {
    if (i % 3 === 0) {
      lines.push(`    at internal/process/task_queues.js:${i}:1`); // Should be filtered
    } else if (i % 3 === 1) {
      lines.push(`    at node_modules/some-lib/index.js:${i}:1`); // Should be filtered
    } else {
      lines.push(`    at app/user-code.ts:${i}:1`); // Should be kept
    }
  }
  return lines.join('\n');
}

function runBenchmark() {
  const deepStack = generateStack(1000); // 1000 lines
  const iterations = 10000;

  console.log(`Running benchmark with stack depth: 1000 lines`);
  console.log(`Iterations: ${iterations}`);

  // Warmup
  cleanStack(deepStack, 8);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    cleanStack(deepStack, 8);
  }
  const end = performance.now();

  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per call: ${avgTime.toFixed(4)}ms`);
  console.log(`Ops/sec: ${(1000 / avgTime).toFixed(0)}`);
}

runBenchmark();
