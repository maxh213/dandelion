import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('repository hygiene', () => {
  it('never tracks node_modules, not even as a symlink', () => {
    expect(execFileSync('git', ['ls-files', 'node_modules'], { encoding: 'utf8' })).toBe('');
  });
});
