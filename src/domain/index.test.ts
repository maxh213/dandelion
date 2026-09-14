import { describe, it, expect } from 'vitest';
import { formatCountdown, nextLocalMidnight, routeLine, summariseFleet, type ProviderUsage, type UsageWindow, type WindowKind } from './index.ts';

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
      { ...identity, id: 'grok', status: 'ok', windows: [{ label: 'credits', kind: 'weekly', usedPct: 80, resetsAt: NOW }] },
      { ...identity, id: 'codex', status: 'ok', windows: [{ label: '5h', kind: 'rolling', usedPct: 79, resetsAt: '2026-09-13T11:00:00Z' }, { label: 'weekly', kind: 'weekly', usedPct: 10 }] }
    ];
    expect(summariseFleet(usages, NOW)).toEqual({ hot: 1, windows: 3, next: { id: 'codex', label: '5h', kind: 'rolling', usedPct: 79, resetsAt: '2026-09-13T11:00:00Z' } });
  });
});

describe('routeLine', () => {
  const NOW = '2026-09-14T11:00:00.000Z';
  const MIDNIGHT = '2026-09-15T00:00:00.000Z';

  function windowOf(text: string): UsageWindow {
    const [kind, used, at] = text.split(' ');
    const window: UsageWindow = { label: kind, kind: kind as WindowKind, usedPct: Number(used) };
    return at === '@-' ? window : { ...window, resetsAt: at.slice(1) };
  }

  function usageOf(entry: string): ProviderUsage {
    const [id, body] = entry.split(': ');
    const identity = { id, displayName: id, fetchedAt: NOW };
    if (body === 'unavailable' || body === 'error') return { ...identity, windows: [], status: body, reason: body };
    return { ...identity, windows: body === 'no windows' ? [] : body.split(', ').map(windowOf), status: 'ok' };
  }

  function routeOf(candidates: string): string {
    return routeLine(candidates.split('; ').map(usageOf), NOW, MIDNIGHT);
  }

  it.each([
    ['raw floats, headroom', 'claude: rolling 50.4 @-; agy: rolling 50.2 @-', 'gemini-3.1-pro-high medium'],
    ['96.9 left evaporates', 'claude: weekly 3.1 @2026-09-14T20:00:00.000Z; agy: rolling 0 @-', 'claude-opus-5 max'],
    ['97 left does not evaporate', 'claude: weekly 3 @2026-09-14T20:00:00.000Z; agy: rolling 0 @-', 'gemini-3.1-pro-high medium'],
    ['reset already past never evaporates', 'claude: weekly 50 @2026-09-14T10:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'gemini-3.1-pro-high medium'],
    ['reset exactly at now never evaporates', 'claude: weekly 50 @2026-09-14T11:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'gemini-3.1-pro-high medium'],
    ['reset 1 ms after now evaporates', 'claude: weekly 50 @2026-09-14T11:00:00.001Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'claude-opus-5 max'],
    ['a past reset still binds (stale grok)', 'grok: weekly 10 @2026-09-14T10:00:00.000Z; agy: rolling 20 @-, weekly 20 @2026-09-20T00:00:00.000Z', 'grok-4.6'],
    ['weekly without resetsAt', 'claude: weekly 50 @-; agy: rolling 0 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'gemini-3.1-pro-high medium'],
    ['reset exactly at local midnight', 'claude: weekly 50 @2026-09-15T00:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'gemini-3.1-pro-high medium'],
    ['reset 1 ms before local midnight', 'claude: weekly 50 @2026-09-14T23:59:59.999Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'claude-opus-5 max'],
    ['other windows neither bind nor evaporate', 'claude: rolling 10 @-, weekly 10 @2026-09-20T00:00:00.000Z, other 99 @2026-09-14T14:00:00.000Z; agy: rolling 20 @-, weekly 20 @2026-09-20T00:00:00.000Z', 'claude-opus-5 high'],
    ['ok with zero windows is excluded', 'claude: no windows; cursor: weekly 60 @2026-09-20T00:00:00.000Z', 'kimi-k3-max'],
    ['only ok with zero windows', 'claude: no windows', 'none'],
    ['only other windows bind at 100', 'claude-work: other 99 @-; agy: rolling 1 @-', 'claude-opus-5 high'],
    ['unavailable and error are excluded', 'claude: unavailable; claude-work: error; kimi: weekly 90 @2026-09-20T00:00:00.000Z', 'kimi-code/kimi-for-coding-highspeed'],
    ['codex never routes, even evaporating', 'codex: weekly 50 @2026-09-14T20:00:00.000Z; agy: rolling 40 @-', 'gemini-3.1-pro-high medium'],
    ['codex as the only ok provider', 'codex: weekly 10 @2026-09-20T00:00:00.000Z', 'none'],
    ['kilo as the only ok provider', 'kilo: no windows', 'none']
  ])('%s', (_case, candidates, line) => {
    expect(routeOf(candidates)).toBe(line);
  });

  it.each([
    ['claude', 'claude-opus-5 high', 'claude-opus-5 max'],
    ['claude-work', 'claude-opus-5 high', 'claude-opus-5 max'],
    ['agy', 'gemini-3.1-pro-high medium', 'gemini-3.1-pro-high high'],
    ['kimi', 'kimi-code/kimi-for-coding-highspeed', 'kimi-code/kimi-for-coding-highspeed'],
    ['grok', 'grok-4.6', 'grok-4.6'],
    ['cursor', 'kimi-k3-max', 'kimi-k3-max']
  ])('routes %s alone to its standard line, and to its max line when its weekly evaporates', (id, standard, max) => {
    expect(routeOf(`${id}: weekly 50 @2026-09-20T00:00:00.000Z`)).toBe(standard);
    expect(routeOf(`${id}: weekly 50 @2026-09-14T20:00:00.000Z`)).toBe(max);
  });

  it('breaks ties in dashboard order whatever order the usages come in', () => {
    expect(routeOf('kimi: rolling 20 @-; agy: rolling 20 @-')).toBe('gemini-3.1-pro-high medium');
    expect(routeOf('kimi: weekly 10 @2026-09-14T20:00:00.000Z; agy: weekly 10 @2026-09-14T20:00:00.000Z')).toBe('gemini-3.1-pro-high high');
  });
});

describe('nextLocalMidnight', () => {
  it.each([
    ['UTC', 'UTC', '2026-09-14T11:00:00.000Z', '2026-09-15T00:00:00.000Z'],
    ['UTC-7, local 13:00 on Sep 14', 'Etc/GMT+7', '2026-09-14T20:00:00.000Z', '2026-09-15T07:00:00.000Z'],
    ['UTC+10, local 06:00 on Sep 15', 'Etc/GMT-10', '2026-09-14T20:00:00.000Z', '2026-09-15T14:00:00.000Z'],
    ['exactly local midnight gives the next', 'Etc/GMT+7', '2026-09-15T07:00:00.000Z', '2026-09-16T07:00:00.000Z'],
    ['1 ms before local midnight', 'Etc/GMT+7', '2026-09-15T06:59:59.999Z', '2026-09-15T07:00:00.000Z'],
    ['a 25-hour day (DST ends in Berlin)', 'Europe/Berlin', '2026-10-25T12:00:00.000Z', '2026-10-25T23:00:00.000Z']
  ])('%s', (_case, zone, now, midnight) => {
    expect(nextLocalMidnight(zone, now)).toBe(midnight);
  });
});
