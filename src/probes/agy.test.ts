import { describe, it, expect } from 'vitest';
import { agyProbe } from './agy.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const VALID = 'Gemini Models\tWeekly Limit Remaining\t40%\t2026-09-20T17:13:45Z';

describe('agyProbe', () => {
  it('runs agy -p /usage with a 60 second timeout and the agy plan', () => {
    expect(agyProbe).toMatchObject({ id: 'agy', planLabel: 'agy', args: ['-p', '/usage'], timeoutMs: 60000 });
  });

  it('maps rows to windows with used percent and reset instant', () => {
    const stdout = [
      'Gemini Models\tWeekly Limit Remaining\t100%\t2026-09-20T17:13:45Z',
      'Gemini Models\tFive Hour Limit Remaining\t100%\t2026-09-13T22:13:45Z',
      'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-09-20T17:13:45Z',
      'Claude and GPT models\tFive Hour Limit Remaining\t25%\t2026-09-13T22:13:45Z',
      ''
    ].join('\n');
    expect(agyProbe.parse(stdout, NOW)).toEqual([
      { label: 'Gemini Models · Weekly Limit', usedPct: 0, resetsAt: '2026-09-20T17:13:45Z' },
      { label: 'Gemini Models · Five Hour Limit', usedPct: 0, resetsAt: '2026-09-13T22:13:45Z' },
      { label: 'Claude and GPT models · Weekly Limit', usedPct: 0, resetsAt: '2026-09-20T17:13:45Z' },
      { label: 'Claude and GPT models · Five Hour Limit', usedPct: 75, resetsAt: '2026-09-13T22:13:45Z' }
    ]);
  });

  it.each([
    ['three columns', 'Gemini Models\tFive Hour Limit Remaining\t100%'],
    ['a non-numeric percent', 'Gemini Models\tFive Hour Limit Remaining\tlots\t2026-09-13T22:13:45Z']
  ])('skips a row with %s and keeps the valid one', (_case, bad) => {
    expect(agyProbe.parse(`${VALID}\n${bad}`, NOW)).toEqual([
      { label: 'Gemini Models · Weekly Limit', usedPct: 60, resetsAt: '2026-09-20T17:13:45Z' }
    ]);
  });

  it.each(['not-a-date', '2026-02-30T99:00:00Z', '1'])('keeps a row with reset "%s" but no resetsAt', (reset) => {
    const [, second] = agyProbe.parse(`${VALID}\nGemini Models\tFive Hour Limit Remaining\t100%\t${reset}`, NOW);
    expect(second).toStrictEqual({ label: 'Gemini Models · Five Hour Limit', usedPct: 0 });
  });

  it.each(['', 'hello world'])('parses nothing from "%s"', (stdout) => {
    expect(agyProbe.parse(stdout, NOW)).toEqual([]);
  });
});
