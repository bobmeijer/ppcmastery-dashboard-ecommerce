import { describe, expect, it } from 'vitest';
import { withMethodology } from './methodology';

describe('withMethodology', () => {
  it('leaves the prompt alone without a methodology file', () => {
    expect(withMethodology('System prompt', null)).toBe('System prompt');
  });

  it('adds the methodology after the rules', () => {
    const prompt = withMethodology('System prompt', 'Fix the binding constraint first.');
    expect(prompt.startsWith('System prompt')).toBe(true);
    expect(prompt).toContain('Fix the binding constraint first.');
  });
});
