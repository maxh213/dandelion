import { describe, it, expect } from 'vitest';
import { probeCli, type CliProbe, type CommandRunner, type CommandRunnerResult, type RunFailure } from './cli.ts';

const probe: CliProbe = {
  id: 'tool',
  planLabel: 'tool plan',
  args: ['-p', '/usage'],
  timeoutMs: 60000,
  reads: 'usage',
  read: (stdout) => ({ windows: stdout === '' ? [] : [{ label: stdout, usedPct: 10, resetsAt: undefined }] })
};

function mockRunner(result: CommandRunnerResult): CommandRunner {
  return { run: async () => result };
}

function probeWith(overrides: Partial<CliProbe>): CliProbe {
  return { ...probe, ...overrides };
}

describe('probeCli', () => {
  it('runs the probe command with its args and timeout', async () => {
    const calls: unknown[] = [];
    const runner: CommandRunner = {
      run: async (...call) => {
        calls.push(call);
        return { stdout: 'x', stderr: '' };
      }
    };
    await probeCli(runner, probe, 'now');
    await probeCli(runner, probeWith({ command: 'claude', env: { CLAUDE_CONFIG_DIR: '/work' } }), 'now');
    expect(calls).toEqual([
      ['tool', ['-p', '/usage'], 60000, undefined],
      ['claude', ['-p', '/usage'], 60000, { CLAUDE_CONFIG_DIR: '/work' }]
    ]);
  });

  it('names the command, not the panel id, when the command is missing', async () => {
    const res = await probeCli(mockRunner({ stdout: '', stderr: '', failure: 'missing' }), probeWith({ id: 'claude-work', command: 'claude' }), 'now');
    expect(res).toMatchObject({ id: 'claude-work', displayName: 'claude-work', status: 'unavailable', reason: 'claude CLI not found in PATH' });
  });

  it('returns read windows with the plan label', async () => {
    const res = await probeCli(mockRunner({ stdout: 'weekly', stderr: '' }), probe, 'now');
    expect(res).toStrictEqual({
      id: 'tool',
      displayName: 'tool',
      planLabel: 'tool plan',
      fetchedAt: 'now',
      windows: [{ label: 'weekly', usedPct: 10 }],
      status: 'ok'
    });
  });

  it('keeps resetsAt when known', async () => {
    const read = () => ({ windows: [{ label: 'weekly', usedPct: 50, resetsAt: '2026-09-13T22:00:00Z' }] });
    const res = await probeCli(mockRunner({ stdout: '', stderr: '' }), probeWith({ read }), 'now');
    expect(res.windows).toStrictEqual([{ label: 'weekly', usedPct: 50, resetsAt: '2026-09-13T22:00:00Z' }]);
  });

  it('is ok with a balance and no windows', async () => {
    const read = () => ({ windows: [], balance: { amount: 1, currency: '$' } });
    const res = await probeCli(mockRunner({ stdout: '', stderr: '' }), probeWith({ read }), 'now');
    expect(res).toMatchObject({ status: 'ok', windows: [], balance: { amount: 1, currency: '$' } });
  });

  it.each<[RunFailure, string, number, string]>([
    ['missing', 'claude', 90000, 'claude CLI not found in PATH'],
    ['timeout', 'claude', 90000, 'Command timed out after 90s'],
    ['timeout', 'agy', 60000, 'Command timed out after 60s'],
    ['exit', 'agy', 60000, 'Command failed or timed out']
  ])('explains a %s failure', async (failure, id, timeoutMs, reason) => {
    const res = await probeCli(mockRunner({ stdout: 'weekly', stderr: '', failure }), probeWith({ id, timeoutMs }), 'now');
    expect(res).toMatchObject({ status: 'unavailable', reason, windows: [] });
  });

  it('is unavailable with the plan label when the command fails', async () => {
    const res = await probeCli(mockRunner({ stdout: 'weekly', stderr: '', failure: 'timeout' }), probe, 'now');
    expect(res).toMatchObject({ status: 'unavailable', reason: 'Command timed out after 60s', planLabel: 'tool plan', windows: [] });
  });

  it('rejects a failure kind it does not know', async () => {
    const result = { stdout: '', stderr: '', failure: 'bogus' } as unknown as CommandRunnerResult;
    await expect(probeCli(mockRunner(result), probe, 'now')).rejects.toThrow('Unexpected run failure: bogus');
  });

  it.each<[CliProbe['reads'], string]>([
    ['usage', 'Could not parse usage from output'],
    ['balance', 'Could not parse balance from output']
  ])('is unavailable when no %s reads', async (reads, reason) => {
    const res = await probeCli(mockRunner({ stdout: '', stderr: '' }), probeWith({ reads }), 'now');
    expect(res).toMatchObject({ status: 'unavailable', reason, windows: [] });
  });
});
