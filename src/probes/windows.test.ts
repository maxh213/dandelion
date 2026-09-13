import { describe, it, expect } from 'vitest';
import { presentOnly, probeWindows, windowOf, type WindowProbe } from './windows.ts';
import type { CommandRunner, CommandRunnerResult } from './runner.ts';

const probe: WindowProbe = {
  id: 'tool',
  planLabel: 'tool plan',
  args: ['-p', '/usage'],
  timeoutMs: 60000,
  parse: (stdout) => (stdout === '' ? [] : [{ label: stdout, usedPct: 10 }])
};

function mockRunner(result: CommandRunnerResult): CommandRunner {
  return { run: async () => result };
}

describe('windowOf', () => {
  it('omits resetsAt when unknown', () => {
    expect(windowOf('weekly', 50, undefined)).toStrictEqual({ label: 'weekly', usedPct: 50 });
  });

  it('keeps resetsAt when known', () => {
    expect(windowOf('weekly', 50, '2026-09-13T22:00:00Z')).toStrictEqual({ label: 'weekly', usedPct: 50, resetsAt: '2026-09-13T22:00:00Z' });
  });
});

describe('presentOnly', () => {
  it('drops undefined items and keeps order', () => {
    expect(presentOnly([1, undefined, 2])).toEqual([1, 2]);
  });
});

describe('probeWindows', () => {
  it('runs the probe command with its args and timeout', async () => {
    const calls: unknown[] = [];
    const runner: CommandRunner = {
      run: async (...call) => {
        calls.push(call);
        return { stdout: 'x', stderr: '' };
      }
    };
    await probeWindows(runner, probe, 'now');
    expect(calls).toEqual([['tool', ['-p', '/usage'], 60000]]);
  });

  it('returns parsed windows with the plan label', async () => {
    const res = await probeWindows(mockRunner({ stdout: 'weekly', stderr: '' }), probe, 'now');
    expect(res).toEqual({
      id: 'tool',
      displayName: 'tool',
      planLabel: 'tool plan',
      fetchedAt: 'now',
      windows: [{ label: 'weekly', usedPct: 10 }],
      status: 'ok'
    });
  });

  it('is unavailable when the command fails', async () => {
    const res = await probeWindows(mockRunner({ stdout: 'weekly', stderr: '', failure: 'timeout' }), probe, 'now');
    expect(res).toMatchObject({ status: 'unavailable', reason: 'Command timed out after 60s', planLabel: 'tool plan', windows: [] });
  });

  it('is unavailable when nothing parses', async () => {
    const res = await probeWindows(mockRunner({ stdout: '', stderr: '' }), probe, 'now');
    expect(res).toMatchObject({ status: 'unavailable', reason: 'Could not parse usage from output' });
  });
});
