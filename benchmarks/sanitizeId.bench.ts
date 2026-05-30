
import { sanitizeId } from '../src/formatter';
import * as crypto from 'crypto';
import { performance } from 'perf_hooks';

// Legacy SHA1 implementation for comparison
function sanitizeIdLegacy(str: string): string {
  const hash = crypto.createHash('sha1').update(str).digest('hex').slice(0, 8);
  const sanitized = str.replace(/[^a-zA-Z0-9-]+/g, '_');
  return `${sanitized.slice(0, 200)}_${hash}`;
}

function runBenchmark() {
  const shortString = 'test case 1';
  const mediumString = 'Integration Test > User Login > Should display error when password is correct';
  const longString = 'E2E > Checkout Flow > Given user has items in cart > When user proceeds to checkout > Then payment should be processed successfully and order confirmation should be shown > And email should be sent > And inventory should be updated > And analytics event should be fired > And user should be redirected to thank you page';

  const inputs = [shortString, mediumString, longString];
  const iterations = 100000;

  console.log(`Running benchmark with ${iterations} iterations per input string...`);

  // Warmup
  for (const input of inputs) {
    sanitizeId(input);
    sanitizeIdLegacy(input);
  }

  // Benchmark Legacy (SHA1)
  const startLegacy = performance.now();
  for (let i = 0; i < iterations; i++) {
    for (const input of inputs) {
      sanitizeIdLegacy(input);
    }
  }
  const endLegacy = performance.now();
  const timeLegacy = endLegacy - startLegacy;

  // Benchmark Current (FNV-1a)
  const startCurrent = performance.now();
  for (let i = 0; i < iterations; i++) {
    for (const input of inputs) {
      sanitizeId(input);
    }
  }
  const endCurrent = performance.now();
  const timeCurrent = endCurrent - startCurrent;

  console.log('Results (Total Time):');
  console.log(`Legacy (SHA1): ${timeLegacy.toFixed(2)}ms`);
  console.log(`Current (FNV-1a): ${timeCurrent.toFixed(2)}ms`);
  console.log(`Speedup: ${(timeLegacy / timeCurrent).toFixed(2)}x`);
}

runBenchmark();
