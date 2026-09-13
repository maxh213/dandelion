import { describe, it, expect } from 'vitest';
import { runFailureReason, type RunFailure } from './runner.ts';

describe('runFailureReason', () => {
  it.each<[RunFailure, number, string]>([
    ['missing', 90000, 'claude CLI not found in PATH'],
    ['timeout', 90000, 'Command timed out after 90s'],
    ['timeout', 60000, 'Command timed out after 60s'],
    ['exit', 60000, 'Command failed or timed out']
  ])('explains a %s failure', (failure, timeoutMs, reason) => {
    expect(runFailureReason(failure === 'missing' ? 'claude' : 'agy', timeoutMs, failure)).toBe(reason);
  });

  it('rejects a failure kind it does not know', () => {
    expect(() => runFailureReason('agy', 1000, 'bogus' as RunFailure)).toThrow('Unexpected run failure: bogus');
  });
});
