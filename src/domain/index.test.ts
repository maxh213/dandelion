import { describe, it, expect } from 'vitest';
import { formatCountdown, summariseFleet, type ProviderUsage } from './index.ts';

describe('formatCountdown', () => {
  it('formats days and hours', () => {
    expect(formatCountdown('2026-09-13T14:12:00Z', '2026-09-10T10:00:00Z')).toBe('3d4h');
  });

  it('formats hours and minutes', () => {
    expect(formatCountdown('2026-09-14T15:12:00Z', '2026-09-14T10:00:00Z')).toBe('5h12m');
  });

  it('handles negative differences by returning 0h0m', () => {
    expect(formatCountdown('2026-09-10T10:00:00Z', '2026-09-13T14:12:00Z')).toBe('0h0m');
  });
});

describe('summariseFleet', () => {
  const NOW = '2026-09-13T10:00:00.000Z';
  const identity = { displayName: 'x', fetchedAt: NOW };

  it('counts only ok windows, skips a reset at now and picks the soonest future one', () => {
    const usages: ProviderUsage[] = [
      { ...identity, id: 'claude', status: 'unavailable', reason: 'missing', windows: [] },
      { ...identity, id: 'grok', status: 'ok', windows: [{ label: 'credits', usedPct: 80, resetsAt: NOW }] },
      { ...identity, id: 'codex', status: 'ok', windows: [{ label: '5h', usedPct: 79, resetsAt: '2026-09-13T11:00:00Z' }, { label: 'weekly', usedPct: 10 }] }
    ];
    expect(summariseFleet(usages, NOW)).toEqual({ hot: 1, windows: 3, next: { id: 'codex', label: '5h', usedPct: 79, resetsAt: '2026-09-13T11:00:00Z' } });
  });
});
