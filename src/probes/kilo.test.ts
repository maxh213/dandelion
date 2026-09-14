import { describe, it, expect } from 'vitest';
import { probeCli, type CommandRunner, type CommandRunnerResult } from './cli.ts';
import { kiloProbe } from './kilo.ts';

const NO_DIRECTORIES = { homeDir: () => '/home/tester', read: async () => undefined, isDirectory: async () => false };

function probeKilo(runner: CommandRunner, now: string, env: Record<string, string | undefined>) {
  return probeCli({ runner, reader: NO_DIRECTORIES }, kiloProbe(env), now);
}

function mockRunner(result: CommandRunnerResult): CommandRunner {
  return { run: async () => result };
}

describe('probeKilo', () => {
  it('runs kilo profile with a 20 second timeout', () => {
    expect(kiloProbe({})).toMatchObject({ id: 'kilo', planLabel: 'api balance', args: ['profile'], timeoutMs: 20000 });
  });

  it('returns balance successfully with default reference', async () => {
    const runner = mockRunner({ stdout: 'Name: Max\nBalance: $14.15', stderr: '' });
    const res = await probeKilo(runner, 'now', {});
    expect(res).toEqual({
      id: 'kilo',
      displayName: 'kilo',
      planLabel: 'api balance',
      windows: [],
      fetchedAt: 'now',
      status: 'ok',
      balance: { amount: 14.15, currency: '$', reference: 20 }
    });
  });

  it('parses a balance with no space before the amount', async () => {
    const runner = mockRunner({ stdout: 'Balance:$3.50', stderr: '' });
    const res = await probeKilo(runner, 'now', {});
    expect(res).toMatchObject({ status: 'ok', balance: { amount: 3.5 } });
  });

  it('handles custom reference', async () => {
    const runner = mockRunner({ stdout: 'Balance: $14.15', stderr: '' });
    const res = await probeKilo(runner, 'now', { ALLOWANCE_KILO_REFERENCE: '10' });
    expect(res).toMatchObject({ status: 'ok', balance: { reference: 10 } });
  });

  it('handles empty reference', async () => {
    const runner = mockRunner({ stdout: 'Balance: $14.15', stderr: '' });
    const res = await probeKilo(runner, 'now', { ALLOWANCE_KILO_REFERENCE: '' });
    expect(res).toMatchObject({ status: 'ok', balance: { amount: 14.15, currency: '$' } });
    expect(res).not.toHaveProperty('balance.reference');
  });

  it.each<[string, CommandRunnerResult, string]>([
    ['missing CLI', { stdout: '', stderr: '', failure: 'missing' }, 'kilo CLI not found in PATH'],
    ['timeout', { stdout: '', stderr: '', failure: 'timeout' }, 'Command timed out after 20s'],
    ['error code', { stdout: 'Balance: $14.15', stderr: '', failure: 'exit' }, 'Command failed or timed out'],
    ['unparseable output', { stdout: 'Name: Max', stderr: '' }, 'Could not parse balance from output']
  ])('handles %s', async (_case, result, reason) => {
    const res = await probeKilo(mockRunner(result), 'now', {});
    expect(res).toMatchObject({ status: 'unavailable', reason });
  });

  it('rejects a failure kind it does not know', async () => {
    const result = { stdout: '', stderr: '', failure: 'bogus' } as unknown as CommandRunnerResult;
    await expect(probeKilo(mockRunner(result), 'now', {})).rejects.toThrow('Unexpected run failure: bogus');
  });
});
