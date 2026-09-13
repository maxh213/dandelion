import { describe, it, expect } from 'vitest';
import { probeKilo, type CommandRunner, type CommandRunnerResult } from './kilo.ts';

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

  it('handles missing CLI', async () => {
    const runner = new MockRunner({ code: 1, stdout: '', stderr: '', timedOut: false, error: new Error('ENOENT') });
    const res = await probeKilo(runner, 'now', {});
    expect(res.status).toBe('unavailable');
    expect(res.reason).toBe('kilo CLI not found in PATH');
  });

  it('handles timeout', async () => {
    const runner = new MockRunner({ code: 0, stdout: '', stderr: '', timedOut: true });
    const res = await probeKilo(runner, 'now', {});
    expect(res.status).toBe('unavailable');
    expect(res.reason).toBe('Command timed out after 20s');
  });

  it('handles error code', async () => {
    const runner = new MockRunner({ code: 1, stdout: '', stderr: '', timedOut: false });
    const res = await probeKilo(runner, 'now', {});
    expect(res.status).toBe('unavailable');
    expect(res.reason).toBe('Command failed or timed out');
  });

  it('handles unparseable output', async () => {
    const runner = new MockRunner({ code: 0, stdout: 'Name: Max', stderr: '', timedOut: false });
    const res = await probeKilo(runner, 'now', {});
    expect(res.status).toBe('unavailable');
    expect(res.reason).toBe('Could not parse balance from output');
  });
  
  it('handles error instance with non-ENOENT message', async () => {
    const runner = new MockRunner({ code: 1, stdout: '', stderr: '', timedOut: false, error: new Error('EACCES') });
    const res = await probeKilo(runner, 'now', {});
    expect(res.status).toBe('unavailable');
    expect(res.reason).toBe('Command failed or timed out');
  });

  it('handles code 0 but with error', async () => {
    const runner = new MockRunner({ code: 0, stdout: '', stderr: '', timedOut: false, error: new Error('Random') });
    const res = await probeKilo(runner, 'now', {});
    expect(res.status).toBe('unavailable');
    expect(res.reason).toBe('Command failed or timed out');
  });
});
