import { describe, it, expect } from 'vitest';
import type { FileReader } from '../domain/index.ts';
import { claudeProbe, claudeWorkProbe } from './claude.ts';
import { probeCli } from './cli.ts';

const WORK_TRANSCRIPT = [
  'Current session: 0% used · resets Sep 13, 11:10pm (Europe/London)',
  'Current week (all models): 12% used · resets Sep 15, 6pm (Europe/London)',
  'Current week (Fable): 23% used · resets Sep 15, 6pm (Europe/London)'
].join('\n');

function readerWith(directories: string[]) {
  const checked: string[] = [];
  const reader: FileReader = {
    homeDir: () => '/home/tester',
    read: async () => undefined,
    isDirectory: async (path) => {
      checked.push(path);
      return directories.includes(path);
    }
  };
  return { reader, checked };
}

const NOW = '2026-09-13T10:00:00.000Z';
const TRANSCRIPT = [
  'Current session: 3% used · resets Sep 13, 7:40pm (Europe/London)',
  'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)',
  'Current week (Fable): 100% used · resets Sep 13, 11pm (Europe/London)',
  '',
  "What's contributing to your usage",
  'Current nonsense: 42% used'
].join('\n');

async function windowsOf(stdout: string) {
  const usage = await probeCli({ runner: { run: async () => ({ stdout, stderr: '' }) }, reader: readerWith([]).reader }, claudeProbe, NOW);
  return usage.windows;
}

async function weeklyResetsAt(reset: string): Promise<string | undefined> {
  const [weekly] = await windowsOf(`Current week (all models): 50% used · resets ${reset}`);
  return weekly.resetsAt;
}

describe('claudeProbe', () => {
  it('runs claude -p /usage with a 90 second timeout, the personal plan and no config dir override', async () => {
    expect(claudeProbe).toMatchObject({ id: 'claude', planLabel: 'claude · personal', args: ['-p', '/usage'], timeoutMs: 90000 });
    const calls: unknown[][] = [];
    const { reader, checked } = readerWith([]);
    await probeCli({ runner: { run: async (...call) => (calls.push(call), { stdout: TRANSCRIPT, stderr: '' }) }, reader }, claudeProbe, NOW);
    expect(calls).toEqual([['claude', ['-p', '/usage'], 90000, undefined]]);
    expect(checked).toEqual([]);
  });

  it('parses session, weekly and per-model windows in order and ignores other lines', async () => {
    expect(await windowsOf(TRANSCRIPT)).toEqual([
      { label: 'session', usedPct: 3, resetsAt: '2026-09-13T18:40:00.000Z' },
      { label: 'weekly', usedPct: 86, resetsAt: '2026-09-13T22:00:00.000Z' },
      { label: 'weekly Fable', usedPct: 100, resetsAt: '2026-09-13T22:00:00.000Z' }
    ]);
  });

  it.each([
    ['Sep 13, 11pm (Europe/London)', '2026-09-13T22:00:00Z'],
    ['Sep 13, 7:40pm (Europe/London)', '2026-09-13T18:40:00Z'],
    ['Sep 14, 9am', '2026-09-14T09:00:00Z'],
    ['Sep 12, 12am', '2026-09-12T00:00:00Z'],
    ['Sep 13, 12pm', '2026-09-13T12:00:00Z'],
    ['Sep 10, 9am', '2027-09-10T09:00:00Z'],
    ['Jan 2, 1:05am (America/New_York)', '2027-01-02T06:05:00Z'],
    ['Sep 11, 10am', '2026-09-11T10:00:00Z'],
    ['Oct 25, 12:30am (Europe/London)', '2026-10-24T23:30:00Z']
  ])('resolves reset "%s" to %s', async (reset, instant) => {
    expect(await weeklyResetsAt(reset)).toBe(new Date(instant).toISOString());
  });

  it.each([
    ['Jan', '2027-01-15T09:00:00Z'],
    ['Feb', '2027-02-15T09:00:00Z'],
    ['Mar', '2027-03-15T09:00:00Z'],
    ['Apr', '2027-04-15T09:00:00Z'],
    ['May', '2027-05-15T09:00:00Z'],
    ['Jun', '2027-06-15T09:00:00Z'],
    ['Jul', '2027-07-15T09:00:00Z'],
    ['Aug', '2027-08-15T09:00:00Z'],
    ['Sep', '2026-09-15T09:00:00Z'],
    ['Oct', '2026-10-15T09:00:00Z'],
    ['Nov', '2026-11-15T09:00:00Z'],
    ['Dec', '2026-12-15T09:00:00Z']
  ])('resolves month %s to %s', async (month, instant) => {
    expect(await weeklyResetsAt(`${month} 15, 9am`)).toBe(new Date(instant).toISOString());
  });

  it.each([
    'someday',
    'Sep 13, 11pm (Not/A_Zone)',
    'Foo 13, 11pm',
    'Sep 13, 11pm (Europe/London) extra',
    'x · resets Sep 13, 11pm'
  ])('leaves resetsAt unset for reset "%s"', async (reset) => {
    expect(await weeklyResetsAt(reset)).toBeUndefined();
  });

  it('resolves a reset on CRLF output', async () => {
    expect(await weeklyResetsAt('Sep 13, 11pm\r\n')).toBe('2026-09-13T23:00:00.000Z');
  });

  it('ignores a window line that does not start the line', async () => {
    expect(await windowsOf('Note: Current week (all models): 9% used')).toEqual([]);
  });

  it('resolves the same zone identically on repeated reads', async () => {
    const first = await weeklyResetsAt('Dec 1, 9am (Europe/Berlin)');
    const second = await weeklyResetsAt('Dec 1, 9am (Europe/Berlin)');
    expect([first, second]).toEqual(['2026-12-01T08:00:00.000Z', '2026-12-01T08:00:00.000Z']);
  });

  it('keeps windows without a reset and allows a missing session', async () => {
    const stdout = 'Current week (all models): 50% used\r\nCurrent week (Fable): 60% used · resets someday\n';
    expect(await windowsOf(stdout)).toStrictEqual([
      { label: 'weekly', usedPct: 50 },
      { label: 'weekly Fable', usedPct: 60 }
    ]);
  });

  it.each([
    ['no week line', 'Current session: 3% used'],
    ['only a per-model week line', 'Current week (Fable): 100% used'],
    ['no usage at all', '']
  ])('parses nothing when there is %s', async (_case, stdout) => {
    expect(await windowsOf(stdout)).toEqual([]);
  });
});

describe('claudeWorkProbe', () => {
  it('runs claude -p /usage with CLAUDE_CONFIG_DIR set to the configured work dir and reads its windows', async () => {
    const { reader, checked } = readerWith(['/work']);
    const calls: unknown[][] = [];
    const probe = claudeWorkProbe({ DANDELION_CLAUDE_WORK_CONFIG_DIR: '/work' }, '/home/tester');
    expect(probe).toMatchObject({ id: 'claude-work', command: 'claude', planLabel: 'claude · work', args: ['-p', '/usage'], timeoutMs: 90000, env: { CLAUDE_CONFIG_DIR: '/work' } });
    const usage = await probeCli({ runner: { run: async (...call) => (calls.push(call), { stdout: WORK_TRANSCRIPT, stderr: '' }) }, reader }, probe, NOW);
    expect(checked).toEqual(['/work']);
    expect(calls).toEqual([['claude', ['-p', '/usage'], 90000, { CLAUDE_CONFIG_DIR: '/work' }]]);
    expect(usage).toStrictEqual({
      id: 'claude-work',
      displayName: 'claude-work',
      planLabel: 'claude · work',
      fetchedAt: NOW,
      status: 'ok',
      windows: [
        { label: 'session', usedPct: 0, resetsAt: '2026-09-13T22:10:00.000Z' },
        { label: 'weekly', usedPct: 12, resetsAt: '2026-09-15T17:00:00.000Z' },
        { label: 'weekly Fable', usedPct: 23, resetsAt: '2026-09-15T17:00:00.000Z' }
      ]
    });
  });

  it.each([
    ['unset', {}],
    ['empty', { DANDELION_CLAUDE_WORK_CONFIG_DIR: '' }]
  ])('defaults the work dir to ~/.claude-work when the env var is %s', async (_case, env) => {
    const { reader, checked } = readerWith(['/home/tester/.claude-work']);
    const probe = claudeWorkProbe(env, '/home/tester');
    expect(probe).toMatchObject({ env: { CLAUDE_CONFIG_DIR: '/home/tester/.claude-work' } });
    await probeCli({ runner: { run: async () => ({ stdout: WORK_TRANSCRIPT, stderr: '' }) }, reader }, probe, NOW);
    expect(checked).toEqual(['/home/tester/.claude-work']);
  });

  it('leaves the personal probe without a config dir override or requirement', () => {
    claudeWorkProbe({ DANDELION_CLAUDE_WORK_CONFIG_DIR: '/work' }, '/home/tester');
    expect(claudeProbe).not.toHaveProperty('env');
    expect(claudeProbe).not.toHaveProperty('command');
    expect(claudeProbe).not.toHaveProperty('requiresDirectory');
  });
});

describe('claudeWorkProbe without its config dir', () => {
  it.each([
    ['a configured dir that is not a directory', { DANDELION_CLAUDE_WORK_CONFIG_DIR: '/no-such-dir' }],
    ['no default dir', {}]
  ])('is the dim work panel that says how to log in for %s, without running claude', async (_case, env) => {
    const calls: unknown[][] = [];
    const runner = { run: async (...call: unknown[]) => (calls.push(call), { stdout: WORK_TRANSCRIPT, stderr: '' }) };
    const usage = await probeCli({ runner, reader: readerWith([]).reader }, claudeWorkProbe(env, '/home/tester'), NOW);
    expect(calls).toEqual([]);
    expect(usage).toStrictEqual({
      id: 'claude-work',
      displayName: 'claude-work',
      planLabel: 'claude · work',
      windows: [],
      fetchedAt: NOW,
      status: 'unavailable',
      reason: 'no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude'
    });
  });
});
