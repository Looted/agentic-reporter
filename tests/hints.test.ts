import { describe, it, expect } from 'vitest';
import { classifyError } from '../src/hints';

describe('classifyError', () => {
  it('classifies timeout errors', () => {
    const { type, hint } = classifyError('Timeout 5000ms exceeded.');
    expect(type).toBe('timeout');
    expect(hint).toContain('Selector missing/hidden');
  });

  it('classifies assertion errors', () => {
    const { type, hint } = classifyError('expect(received).toBe(expected)');
    expect(type).toBe('assertion');
  });

  it('classifies network errors', () => {
      const { type, hint } = classifyError('500 Internal Server Error');
      expect(type).toBe('network');
  });

  it('classifies unknown errors', () => {
    const { type, hint } = classifyError('Something random happened');
    expect(type).toBe('unknown');
    expect(hint).toContain('Check the stack trace');
  });

  it('respects custom patterns', () => {
    const customPatterns = [{
        pattern: /random/i,
        hint: 'Custom hint',
        type: 'custom' as any
    }];
    const { type, hint } = classifyError('Something random happened', customPatterns);
    expect(type).toBe('custom');
    expect(hint).toBe('Custom hint');
  });
});
