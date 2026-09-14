import { describe, it, expect } from 'vitest';
import { agyProbe } from './agy.ts';
import { probeCli } from './cli.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const NO_DIRECTORIES = { homeDir: () => '/home/tester', read: async () => undefined, isDirectory: async () => false };
async function windowsOf(stdout: string) {
  const usage = await probeCli({ runner: { run: async () => ({ stdout, stderr: '' }) }, reader: NO_DIRECTORIES }, agyProbe, NOW);
  return usage.windows;
}

const VALID = 'Gemini Models\tWeekly Limit Remaining\t40%\t2026-09-20T17:13:45Z';

describe('agyProbe', () => {
  it('runs agy -p /usage with a 60 second timeout and the agy plan', () => {
    expect(agyProbe).toMatchObject({ id: 'agy', planLabel: 'agy', args: ['-p', '/usage'], timeoutMs: 60000 });
  });

  it('maps rows to windows with used percent and reset instant', async () => {
    const stdout = [
      'Gemini Models\tWeekly Limit Remaining\t100%\t2026-09-20T17:13:45Z',
      'Gemini Models\tFive Hour Limit Remaining\t100%\t2026-09-13T22:13:45Z',
      'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-09-20T17:13:45Z',
      'Claude and GPT models\tFive Hour Limit Remaining\t25%\t2026-09-13T22:13:45Z',
      ''
    ].join('\n');
    expect(await windowsOf(stdout)).toEqual([
      { label: 'Gemini Models · Weekly Limit', kind: 'weekly', usedPct: 0, resetsAt: '2026-09-20T17:13:45Z' },
      { label: 'Gemini Models · Five Hour Limit', kind: 'rolling', usedPct: 0, resetsAt: '2026-09-13T22:13:45Z' },
      { label: 'Claude and GPT models · Weekly Limit', kind: 'weekly', usedPct: 0, resetsAt: '2026-09-20T17:13:45Z' },
      { label: 'Claude and GPT models · Five Hour Limit', kind: 'rolling', usedPct: 75, resetsAt: '2026-09-13T22:13:45Z' }
    ]);
  });

  it.each([
    ['three columns', 'Gemini Models\tFive Hour Limit Remaining\t100%'],
    ['a non-numeric percent', 'Gemini Models\tFive Hour Limit Remaining\tlots\t2026-09-13T22:13:45Z'],
    ['a prefixed percent', 'Gemini Models\tFive Hour Limit Remaining\tx40%\t2026-09-13T22:13:45Z'],
    ['a suffixed percent', 'Gemini Models\tFive Hour Limit Remaining\t40%x\t2026-09-13T22:13:45Z']
  ])('skips a row with %s and keeps the valid one', async (_case, bad) => {
    expect(await windowsOf(`${VALID}\n${bad}`)).toEqual([
      { label: 'Gemini Models · Weekly Limit', kind: 'weekly', usedPct: 60, resetsAt: '2026-09-20T17:13:45Z' }
    ]);
  });

  it.each(['2026-09-20T17:13:45.5Z', '2026-09-20T17:13Z', '2026-09-20T18:13:45+01:00', '2026-09-20T16:13:45-01:00'])(
    'keeps reset "%s" as resetsAt',
    async (reset) => {
      const [window] = await windowsOf(`Gemini Models\tWeekly Limit Remaining\t40%\t${reset}`);
      expect(window.resetsAt).toBe(reset);
    }
  );

  it.each([
    'not-a-date',
    '2026-02-30T99:00:00Z',
    '1',
    'Sun Sep 20 2026',
    '2026-09-20',
    'x2026-09-20T17:13:45Z',
    '2026-09-20T17:13:45Zx',
    '2026-09-20T18:13:4501:00'
  ])('keeps a row with reset "%s" but no resetsAt', async (reset) => {
    const [, second] = await windowsOf(`${VALID}\nGemini Models\tFive Hour Limit Remaining\t100%\t${reset}`);
    expect(second).toStrictEqual({ label: 'Gemini Models · Five Hour Limit', kind: 'rolling', usedPct: 0 });
  });

  it('reads CRLF output with a clean reset instant', async () => {
    expect(await windowsOf(`${VALID}\r\n`)).toEqual([
      { label: 'Gemini Models · Weekly Limit', kind: 'weekly', usedPct: 60, resetsAt: '2026-09-20T17:13:45Z' }
    ]);
  });

  it.each([
    ['Gemini Models', 'Five Hour Limit', 'rolling'],
    ['Claude and GPT models', 'Five Hour Limit', 'rolling'],
    ['Gemini Models', 'Weekly Limit', 'weekly'],
    ['Claude and GPT models', 'Weekly Limit', 'weekly'],
    ['Gemini Models', 'Daily Limit', 'other']
  ])('sets the kind of %s · %s to %s', async (group, name, kind) => {
    expect(await windowsOf(`${group}\t${name} Remaining\t40%\t2026-09-20T17:13:45Z`)).toStrictEqual([
      { label: `${group} · ${name}`, kind, usedPct: 60, resetsAt: '2026-09-20T17:13:45Z' }
    ]);
  });

  it.each(['', 'hello world'])('parses nothing from "%s"', async (stdout) => {
    expect(await windowsOf(stdout)).toEqual([]);
  });
});
