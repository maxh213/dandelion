import { describe, it, expect } from 'vitest';
import { claudeProbe } from './claude.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const TRANSCRIPT = [
  'Current session: 3% used · resets Sep 13, 7:40pm (Europe/London)',
  'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)',
  'Current week (Fable): 100% used · resets Sep 13, 11pm (Europe/London)',
  '',
  "What's contributing to your usage",
  'Current nonsense: 42% used'
].join('\n');

function weeklyResetsAt(reset: string): string | undefined {
  const [weekly] = claudeProbe.parse(`Current week (all models): 50% used · resets ${reset}`, NOW);
  return weekly.resetsAt;
}

describe('claudeProbe', () => {
  it('runs claude -p /usage with a 90 second timeout and the claude code plan', () => {
    expect(claudeProbe).toMatchObject({ id: 'claude', planLabel: 'claude code', args: ['-p', '/usage'], timeoutMs: 90000 });
  });

  it('parses session, weekly and per-model windows in order and ignores other lines', () => {
    expect(claudeProbe.parse(TRANSCRIPT, NOW)).toEqual([
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
    ['Jan 2, 1:05am (America/New_York)', '2027-01-02T06:05:00Z']
  ])('resolves reset "%s" to %s', (reset, instant) => {
    expect(weeklyResetsAt(reset)).toBe(new Date(instant).toISOString());
  });

  it.each(['someday', 'Sep 13, 11pm (Not/A_Zone)', 'Foo 13, 11pm'])('leaves resetsAt unset for reset "%s"', (reset) => {
    expect(weeklyResetsAt(reset)).toBeUndefined();
  });

  it('keeps windows without a reset and allows a missing session', () => {
    const stdout = 'Current week (all models): 50% used\r\nCurrent week (Fable): 60% used · resets someday\n';
    expect(claudeProbe.parse(stdout, NOW)).toStrictEqual([
      { label: 'weekly', usedPct: 50 },
      { label: 'weekly Fable', usedPct: 60 }
    ]);
  });

  it.each([
    ['no week line', 'Current session: 3% used'],
    ['only a per-model week line', 'Current week (Fable): 100% used'],
    ['no usage at all', '']
  ])('parses nothing when there is %s', (_case, stdout) => {
    expect(claudeProbe.parse(stdout, NOW)).toEqual([]);
  });
});
