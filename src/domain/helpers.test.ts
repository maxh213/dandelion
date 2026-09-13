import { describe, it, expect } from 'vitest';
import { formatCountdown } from './helpers.ts';

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
import type { UsageWindow } from './types.ts';
describe('UsageWindow', () => { it('is used', () => { const w: UsageWindow = { label: 'w', usedPct: 0 }; expect(w).toBeDefined(); }); });
