import { describe, it, expect } from 'vitest';
import { agenticReporter } from '../src/index';

describe('agenticReporter helper', () => {
  it('returns the correct tuple with default options', () => {
    const result = agenticReporter();
    expect(result).toEqual(['@looted/agentic-reporter', {}]);
  });

  it('returns the correct tuple with provided options', () => {
    const options = {
      maxFailures: 10,
      includeAttachments: false,
    };
    const result = agenticReporter(options);
    expect(result).toEqual(['@looted/agentic-reporter', options]);
  });

  it('accepts empty options', () => {
      const result = agenticReporter({});
      expect(result).toEqual(['@looted/agentic-reporter', {}]);
  });
});
