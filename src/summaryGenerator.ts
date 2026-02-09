import type { TestCase, TestResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { sanitizeId } from './formatter';
import type { ResolvedOptions } from './types';

/**
 * Generate the AI-Start-Here summary file.
 */
export function generateAIStartHere(
  outputDir: string,
  failedTests: { test: TestCase; result: TestResult }[],
  flakyTests: { test: TestCase; result: TestResult }[],
  slowTests: { test: TestCase; duration: number; threshold: number }[],
  skippedTests: { test: TestCase }[],
  warnings: { test: TestCase; message: string }[],
  options: ResolvedOptions
): void {
  const lines: string[] = [];

  lines.push('# 🤖 AI Test Run Summary');
  lines.push('');
  lines.push(
    'This file provides a high-level overview of the test run, highlighting failures, flaky tests, and performance issues.'
  );
  lines.push('');

  // 1. Failures
  // Filter out flaky tests from failures list (they appear in Flaky Tests section)
  const realFailures = failedTests.filter(({ test }) => test.outcome() !== 'flaky');

  if (realFailures.length > 0) {
    lines.push('## 🚨 Failures');
    lines.push(
      'The following tests failed. Click the link to view detailed logs and error analysis.'
    );
    lines.push('');
    for (const { test, result } of realFailures) {
      const failureId = sanitizeId(test.titlePath().join('_'));
      const retrySuffix = result.retry > 0 ? `-retry${result.retry}` : '';
      const fileName = `${failureId}${retrySuffix}-details.xml`;
      // Link relative to the md file (which is in outputDir)
      lines.push(`- [${test.title}](./${fileName})`);
    }
    lines.push('');
  } else {
    lines.push('## ✅ Failures');
    lines.push('No failures detected.');
    lines.push('');
  }

  // 2. Flaky Tests
  if (flakyTests.length > 0) {
    lines.push('## ⚠️ Flaky Tests');
    lines.push(
      'These tests failed initially but passed on retry. Review the initial failure logs to fix the root cause.'
    );
    lines.push('');
    for (const { test, result } of flakyTests) {
      const failureId = sanitizeId(test.titlePath().join('_'));
      // Flaky tests in our list are the PASSING result.
      // But we preserved the FAILED result(s).
      // Usually we want to link to the failure that happened before this pass?
      // Or if we kept all retries, link to them?
      // The current logic in reporter.ts preserves `retry*` files.
      // Since we don't know exactly which retries failed without scanning files,
      // we can try to link to previous retries?
      // Or just list them.
      // If we are strictly following "Preserve the initial error log",
      // likely retry 0 failed.
      // Let's assume retry 0 failed for simplicity, or check if file exists?
      // Checking file existence is safer.

      const links: string[] = [];
      // Check retries 0 up to current result.retry - 1
      for (let i = 0; i < result.retry; i++) {
        const suffix = i > 0 ? `-retry${i}` : '';
        const fName = `${failureId}${suffix}-details.xml`;
        if (fs.existsSync(path.join(outputDir, fName))) {
          links.push(`[Attempt ${i + 1}](./${fName})`);
        }
      }

      if (links.length > 0) {
        lines.push(`- **${test.title}** (${links.join(', ')})`);
      } else {
        // Fallback if no file found (shouldn't happen with our logic)
        lines.push(`- **${test.title}** (Passed after ${result.retry} retries)`);
      }
    }
    lines.push('');
  }

  // 3. Slow Tests
  if (slowTests.length > 0) {
    const threshold = slowTests[0].threshold; // All share same threshold
    lines.push('## 🐢 Slow Tests');
    lines.push(
      `Tests exceeding **${threshold.toFixed(0)}ms** (Mean + ${options.maxSlowTestThreshold}σ).`
    );
    lines.push('');

    // Sort by duration desc
    const sorted = [...slowTests].sort((a, b) => b.duration - a.duration);

    lines.push('| Test | Duration | Deviation |');
    lines.push('|---|---|---|');
    for (const { test, duration } of sorted) {
      const diff = duration - threshold;
      lines.push(`| ${test.title} | ${duration}ms | +${diff.toFixed(0)}ms |`);
    }
    lines.push('');
  }

  // 4. Skipped Tests
  if (skippedTests.length > 0) {
    lines.push('## ⏭️ Skipped Tests');
    lines.push('');
    for (const { test } of skippedTests) {
      lines.push(`- ${test.title}`);
    }
    lines.push('');
  }

  // 5. Warnings
  if (warnings.length > 0) {
    lines.push('## ⚠️ Console Warnings');
    lines.push('Warnings detected in passing tests.');
    lines.push('');
    for (const { test, message } of warnings) {
      lines.push(`### ${test.title}`);
      lines.push('```text');
      lines.push(message);
      lines.push('```');
      lines.push('');
    }
  }

  // Write file
  const filePath = path.join(outputDir, 'ai-start-here.md');
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filePath, lines.join('\n'));
  } catch (err) {
    console.error(`[AgenticReporter] Failed to write summary to ${filePath}:`, err);
  }
}
