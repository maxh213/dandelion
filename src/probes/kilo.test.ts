import { describe, it, expect } from 'vitest';
import { probeKilo } from './kilo.ts';
import type { CommandRunner, CommandRunnerResult } from './runner.ts';

class MockRunner implements CommandRunner {
  result: CommandRunnerResult;
  constructor(result: CommandRunnerResult) { this.result = result; }
  async run() {
    return this.result;
  }
}

describe('probeKilo', () => {
  it('returns balance successfully with default reference', async () => {
    const runner = new MockRunner({ code: 0, stdout: 'Name: Max\nBalance: $14.15', stderr: '', timedOut: false });
    const res = await probeKilo(runner, 'now', {});
    expect(res).toEqual({
      id: 'kilo',
      displayName: 'kilo',
      windows: [],
      fetchedAt: 'now',
      status: 'ok',
      balance: { amount: 14.15, currency: '$', reference: 20 }
    });
  });

  it('handles custom reference', async () => {
    const runner = new MockRunner({ code: 0, stdout: 'Balance: $14.15', stderr: '', timedOut: false });
    const res = await probeKilo(runner, 'now', { ALLOWANCE_KILO_REFERENCE: '10' });
    expect(res.balance?.reference).toBe(10);
  });

  it('handles empty reference', async () => {
    const runner = new MockRunner({ code: 0, stdout: 'Balance: $14.15', stderr: '', timedOut: false });
    const res = await probeKilo(runner, 'now', { ALLOWANCE_KILO_REFERENCE: '' });
    expect(res.balance?.reference).toBeUndefined();
  });

  it.each<[string, CommandRunnerResult, string]>([
    ['missing CLI', { code: 1, stdout: '', stderr: '', timedOut: false, error: new Error('ENOENT') }, 'kilo CLI not found in PATH'],
    ['timeout', { code: 0, stdout: '', stderr: '', timedOut: true }, 'Command timed out after 20s'],
    ['error code', { code: 1, stdout: '', stderr: '', timedOut: false }, 'Command failed or timed out'],
    ['unparseable output', { code: 0, stdout: 'Name: Max', stderr: '', timedOut: false }, 'Could not parse balance from output'],
    ['error instance with non-ENOENT message', { code: 1, stdout: '', stderr: '', timedOut: false, error: new Error('EACCES') }, 'Command failed or timed out'],
    ['code 0 but with error', { code: 0, stdout: '', stderr: '', timedOut: false, error: new Error('Random') }, 'Command failed or timed out']
  ])('handles %s', async (_case, result, reason) => {
    const res = await probeKilo(new MockRunner(result), 'now', {});
    expect(res.status).toBe('unavailable');
    expect(res.reason).toBe(reason);
  });
});
