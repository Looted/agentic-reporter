import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  sanitizeId,
  cleanStack,
  formatHeader,
  formatSummary,
} from '../src/formatter';

describe('formatter', () => {
  describe('escapeXml', () => {
    it('escapes special characters', () => {
      expect(escapeXml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('escapes ampersand', () => {
      expect(escapeXml('foo & bar')).toBe('foo &amp; bar');
    });

    it('handles empty string', () => {
      expect(escapeXml('')).toBe('');
    });
  });

  describe('sanitizeId', () => {
    it('replaces non-alphanumeric characters with underscore', () => {
      expect(sanitizeId('foo bar:baz')).toBe('foo_bar_baz');
    });

    it('collapses multiple underscores', () => {
      expect(sanitizeId('foo  bar')).toBe('foo_bar');
    });

    it('truncates long strings', () => {
      const longString = 'a'.repeat(300);
      expect(sanitizeId(longString).length).toBe(220);
    });
  });

  describe('cleanStack', () => {
    it('removes node_modules frames', () => {
      const stack = `Error: foo
    at Object.<anonymous> (/app/tests/foo.ts:1:1)
    at Module._compile (node:internal/modules/cjs/loader:1103:14)
    at node_modules/foo/bar.js:1:1`;
      const cleaned = cleanStack(stack, 10);
      expect(cleaned).not.toContain('node_modules');
      expect(cleaned).not.toContain('node:internal');
      expect(cleaned).toContain('/app/tests/foo.ts');
    });

    it('respects maxFrames', () => {
        const stack = `Error: foo
    at a (a.js:1:1)
    at b (b.js:1:1)
    at c (c.js:1:1)`;
        // Assuming a.js, b.js, c.js are not filtered out
        const cleaned = cleanStack(stack, 2);
        // The first line is usually the error message which is split by newline in cleanStack?
        // Let's check cleanStack implementation:
        // stack.split('\n').filter(...).slice(0, maxFrames).join('\n')
        // Usually stack includes "Error: foo" at the top.
        expect(cleaned.split('\n').length).toBeLessThanOrEqual(2);
    });

    it('handles mixed newlines', () => {
      const stack = 'Error: foo\r\n    at a (a.js:1:1)\n    at b (b.js:1:1)';
      const cleaned = cleanStack(stack, 10);
      expect(cleaned).toContain('at a');
      expect(cleaned).toContain('at b');
    });

    it('stops early when maxFrames is reached', () => {
      const stack = '1\n2\n3\n4\n5';
      const cleaned = cleanStack(stack, 3);
      expect(cleaned.split('\n').length).toBe(3);
      expect(cleaned).toBe('1\n2\n3');
    });

    it('returns empty string if all lines are filtered', () => {
      const stack = 'node_modules\ninternal/\nplaywright/lib';
      const cleaned = cleanStack(stack, 10);
      expect(cleaned).toBe('');
    });

    it('handles stack ending with newline', () => {
      const stack = 'a\nb\n';
      const cleaned = cleanStack(stack, 10);
      expect(cleaned).toBe('a\nb');
    });
  });

  describe('formatHeader', () => {
    it('formats XML header', () => {
        const header = formatHeader(10, 4, 'my-project');
        expect(header).toContain('<test_run>');
        expect(header).toContain('total="10"');
        expect(header).toContain('workers="4"');
        expect(header).toContain('project="my-project"');
    });
  });

  describe('formatSummary', () => {
    it('formats XML summary', () => {
        const summary = formatSummary('passed', 10, 0, 0, 0, 100);
        expect(summary).toContain('<result_summary status="passed"');
        expect(summary).toContain('passed="10"');
        expect(summary).toContain('flaky="0"');
        expect(summary).toContain('duration="100ms"');
        expect(summary).toContain('</test_run>');
    });
  });
});
