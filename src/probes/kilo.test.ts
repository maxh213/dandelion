import { describe, it, expect } from 'vitest';
import { probeCli, type CommandRunner, type CommandRunnerResult } from './cli.ts';
import { freshKiloBalance, kiloProbe } from './kilo.ts';

const NO_DIRECTORIES = { homeDir: () => '/home/tester', read: async () => undefined, isDirectory: async () => false };
const PROFILE = JSON.stringify({ name: 'Max', email: 'private@example.test', balance: 14.15 });

function probeKilo(runner: CommandRunner, now: string) {
  return probeCli({ runner, reader: NO_DIRECTORIES }, kiloProbe(), now);
}

function mockRunner(result: CommandRunnerResult): CommandRunner {
  return { run: async () => result };
}

describe('probeKilo', () => {
  it('runs kilo profile --json with a 20 second timeout', () => {
    expect(kiloProbe()).toMatchObject({ id: 'kilo', planLabel: 'api balance', args: ['profile', '--json'], timeoutMs: 20000 });
  });

  it('returns only the dollar balance and no synthetic reference or windows', async () => {
    const res = await probeKilo(mockRunner({ stdout: PROFILE, stderr: '' }), 'now');
    expect(res).toEqual({
      id: 'kilo',
      displayName: 'kilo',
      planLabel: 'api balance',
      windows: [],
      fetchedAt: 'now',
      status: 'ok',
      balance: { amount: 14.15, currency: '$' }
    });
    expect(res).not.toHaveProperty('balance.reference');
  });

  it.each(['$3.50', '3.50'])('parses the JSON string balance %s', async (balance) => {
    const runner = mockRunner({ stdout: JSON.stringify({ balance }), stderr: '' });
    const res = await probeKilo(runner, 'now');
    expect(res).toMatchObject({ status: 'ok', balance: { amount: 3.5, currency: '$' } });
  });

  it.each([
    [{ balance: 14.15, currency: 'USD' }, 'USD'],
    [{ balance: { amount: 9.5, currency: 'EUR' }, currency: '$' }, 'EUR'],
    [{ balance: { balance: 8.25 }, currency: 'USD' }, 'USD']
  ])('preserves the declared currency instead of normalizing it to dollars', async (profile, currency) => {
    const runner = mockRunner({ stdout: JSON.stringify(profile), stderr: '' });
    const res = await probeKilo(runner, 'now');
    expect(res).toMatchObject({ status: 'ok', balance: { currency } });
    expect(res).not.toHaveProperty('balance.reference');
  });

  it.each<[string, CommandRunnerResult, string]>([
    ['missing CLI', { stdout: '', stderr: '', failure: 'missing' }, 'kilo CLI not found in PATH'],
    ['timeout', { stdout: '', stderr: '', failure: 'timeout' }, 'Command timed out after 20s'],
    ['error code', { stdout: PROFILE, stderr: '', failure: 'exit' }, 'Command exited with an error'],
    ['legacy text output', { stdout: 'Name: Max\nBalance: $14.15', stderr: '' }, 'Could not parse balance from output'],
    ['invalid JSON', { stdout: '{nope', stderr: '' }, 'Could not parse balance from output'],
    ['a negative balance', { stdout: '{"balance":-1}', stderr: '' }, 'Could not parse balance from output'],
    ['a non-finite balance', { stdout: '{"balance":1e999}', stderr: '' }, 'Could not parse balance from output'],
    ['a non-numeric balance', { stdout: '{"balance":"lots"}', stderr: '' }, 'Could not parse balance from output'],
    ['a non-scalar nested balance', { stdout: '{"balance":{"amount":true}}', stderr: '' }, 'Could not parse balance from output'],
    ['an empty currency', { stdout: '{"balance":14.15,"currency":""}', stderr: '' }, 'Could not parse balance from output'],
    ['a non-string currency', { stdout: '{"balance":14.15,"currency":7}', stderr: '' }, 'Could not parse balance from output'],
    ['a non-object profile', { stdout: 'null', stderr: '' }, 'Could not parse balance from output']
  ])('handles %s', async (_case, result, reason) => {
    const res = await probeKilo(mockRunner(result), 'now');
    expect(res).toMatchObject({ status: 'unavailable', reason });
  });

  it('rejects a failure kind it does not know', async () => {
    const result = { stdout: '', stderr: '', failure: 'bogus' } as unknown as CommandRunnerResult;
    await expect(probeKilo(mockRunner(result), 'now')).rejects.toThrow('Unexpected run failure: bogus');
  });
});

describe('freshKiloBalance', () => {
  it('returns a fresh dollar balance', async () => {
    await expect(freshKiloBalance(mockRunner({ stdout: PROFILE, stderr: '' }))).resolves.toBe(14.15);
  });

  it('fails closed for a declared non-dollar currency', async () => {
    const stdout = JSON.stringify({ balance: 14.15, currency: 'USD' });
    await expect(freshKiloBalance(mockRunner({ stdout, stderr: '' }))).resolves.toBeUndefined();
  });
});
