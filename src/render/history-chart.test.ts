import { describe, expect, it } from 'vitest';
import type { HistorySample } from '../domain/index.ts';
import { renderHistoryView } from './history-chart.ts';

const NOW = '2026-09-30T12:00:00.000Z';

function sample(label: string, usedPct: number, at: string): HistorySample {
  return { id: 'claude', label, usedPct, at };
}

const SAMPLES = [
  sample('weekly', 10, '2026-09-30T00:00:00.000Z'),
  sample('weekly', 90, '2026-09-30T06:00:00.000Z'),
  sample('weekly', 5, '2026-09-30T09:00:00.000Z'),
  sample('session', 50, '2026-09-30T00:00:00.000Z')
];

function view(samples: HistorySample[], rows = 24, zone = 'UTC') {
  return { id: 'claude', samples, zone, rows, now: NOW };
}

describe('history chart', () => {
  it('draws one chart per window with its latest value, reset marks and a local time axis', () => {
    const lines = renderHistoryView(view(SAMPLES), true).split('\n');
    expect(lines[0]).toBe('claude · usage over time');
    expect(lines.filter((line) => line === 'weekly  5%' || line === 'session  50%')).toHaveLength(2);
    expect(lines.filter((line) => /^ +v +$/.test(line))).toHaveLength(1);
    expect(lines.at(-2)).toBe(`     09-30 00:00${' '.repeat(72 - 5 - 11 - 11)}09-30 12:00`);
    expect(lines.at(-1)).toBe('esc/q/g back to dashboard');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
    expect(lines.join('')).not.toMatch(/[▀-▟]|\x1b/);
  });

  it('uses block characters and colour outside NO_COLOR', () => {
    const text = renderHistoryView(view(SAMPLES), false);
    expect(text).toContain('█');
    expect(text).toContain('↓');
    expect(text).toContain('\x1b[');
  });

  it('labels the axis in the given zone', () => {
    const lines = renderHistoryView(view(SAMPLES, 24, 'Asia/Tokyo'), true).split('\n');
    expect(lines.at(-2)).toMatch(/^ {5}09-30 09:00 +09-30 21:00$/);
  });

  it('fits the row budget', () => {
    for (const rows of [1, 2, 3, 5, 8, 12, 40]) {
      expect(renderHistoryView(view(SAMPLES, rows), true).split('\n').length).toBeLessThanOrEqual(rows);
    }
    const tall = renderHistoryView(view(SAMPLES, 200), true).split('\n');
    expect(tall.length).toBeLessThan(30);
  });

  it('shows partial cells for in-between values and a flat line for one sample', () => {
    const lines = renderHistoryView(view([sample('w', 50, NOW), sample('w', 12, NOW)], 10), false).split('\n');
    expect(lines.join('\n')).toMatch(/[▁-▇]/);
    expect(renderHistoryView(view([sample('w', 150, NOW)], 10), false)).toContain('█');
    expect(renderHistoryView(view([sample('w', 0, NOW)], 10), false)).not.toContain('█');
  });

  it('says there is no history yet', () => {
    expect(renderHistoryView(view([]), true).split('\n')).toEqual(['claude · usage over time', 'no history yet · samples are recorded after each refresh round', 'esc/q/g back to dashboard']);
  });
});
