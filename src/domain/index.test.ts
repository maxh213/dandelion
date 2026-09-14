import { describe, it, expect } from 'vitest';
import {
  formatCountdown,
  nextLocalMidnight,
  openEligibility,
  routeLine,
  summariseFleet,
  type ProviderUsage,
  type StateFile,
  type UsageWindow,
  type WindowKind
} from './index.ts';

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

  const WINDOW_KINDS: readonly WindowKind[] = ['rolling', 'weekly', 'other'];

  function kindOf(text: string): WindowKind {
    const found = WINDOW_KINDS.find((kind) => kind === text);
    if (found === undefined) throw new Error(`unknown window kind ${text}`);
    return found;
  }

  it('rejects an unknown window kind in a table row', () => {
    expect(() => kindOf('weakly')).toThrow('unknown window kind weakly');
  });

  function windowOf(text: string): UsageWindow {
    const [kind, used, at] = text.split(' ');
    const window: UsageWindow = { label: kind, kind: kindOf(kind), usedPct: Number(used) };
    return at === '@-' ? window : { ...window, resetsAt: at.slice(1) };
  }

  function usageOf(entry: string): ProviderUsage {
    const [id, body] = entry.split(': ');
    const identity = { id, displayName: id, fetchedAt: NOW };
    if (body === 'unavailable' || body === 'error') return { ...identity, windows: [], status: body, reason: body };
    return { ...identity, windows: body === 'no windows' ? [] : body.split(', ').map(windowOf), status: 'ok' };
  }

  function routeOf(candidates: string, ineligible: string[] = []): string {
    return routeLine(candidates.split('; ').map(usageOf), NOW, MIDNIGHT, ineligible);
  }

  it('drops an ineligible provider before the evaporation rule', () => {
    expect(routeOf('claude: weekly 50 @2026-09-14T20:00:00.000Z; agy: rolling 40 @-', ['claude'])).toBe('gemini-3.1-pro-high medium');
  });

  it.each([
    ['before the headroom rule', 'claude: rolling 20 @-, weekly 30 @-; claude-work: rolling 10 @-, weekly 5 @-; agy: rolling 15 @-, weekly 20 @-', ['claude-work', 'nope'], 'gemini-3.1-pro-high medium'],
    ['leaving nothing to route', 'claude: weekly 50 @2026-09-14T20:00:00.000Z', ['claude'], 'none'],
    ['only when named', 'claude: weekly 50 @2026-09-14T20:00:00.000Z; agy: rolling 40 @-', ['agy'], 'claude-opus-5 max']
  ])('drops ineligible providers %s', (_case, candidates, ineligible, line) => {
    expect(routeOf(candidates, ineligible)).toBe(line);
  });

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

describe('eligibility state', () => {
  function fileWith(text: string | undefined, saves: boolean[] = []) {
    const reads: string[] = [];
    const writes: [string, string][] = [];
    const file: StateFile = {
      read: (path) => {
        reads.push(path);
        return text;
      },
      replace: (path, bytes) => {
        writes.push([path, bytes]);
        return saves.shift() ?? true;
      }
    };
    return { file, reads, writes, saved: () => writes.map(([, bytes]) => JSON.parse(bytes)) };
  }

  it.each<[string, Record<string, string | undefined>, string]>([
    ['DANDELION_STATE_FILE wins', { DANDELION_STATE_FILE: '/s/e.json', XDG_STATE_HOME: '/xdg' }, '/s/e.json'],
    ['XDG_STATE_HOME when the file is unset', { XDG_STATE_HOME: '/xdg' }, '/xdg/dandelion/eligibility.json'],
    ['XDG_STATE_HOME when the file is empty', { DANDELION_STATE_FILE: '', XDG_STATE_HOME: '/xdg' }, '/xdg/dandelion/eligibility.json'],
    ['home when both are unset', {}, '/home/u/.local/state/dandelion/eligibility.json'],
    ['home when XDG_STATE_HOME is empty', { XDG_STATE_HOME: '' }, '/home/u/.local/state/dandelion/eligibility.json']
  ])('resolves the state path: %s', (_case, env, path) => {
    const state = fileWith(undefined);
    openEligibility(env, '/home/u', state.file).toggle('claude');
    expect(state.reads).toEqual([path]);
    expect(state.writes.map(([written]) => written)).toEqual([path]);
  });

  it.each<[string, string | undefined, string[]]>([
    ['a missing file', undefined, []],
    ['bytes that are not JSON', '{not json', []],
    ['JSON null', 'null', []],
    ['a JSON array', '[false]', []],
    ['a JSON number', '5', []],
    ['a JSON string', '"x"', []],
    ['only exactly false', '{"claude": false, "agy": "no", "kimi": true, "grok": 0, "cursor": null}', ['claude']],
    ['a constructor key', '{"constructor": false}', ['constructor']]
  ])('reads %s as ineligible %j', (_case, text, ids) => {
    expect(openEligibility({}, '/home/u', fileWith(text).file).ineligible()).toEqual(ids);
  });

  it('flips false to true and anything else to false, keeping unknown keys', () => {
    const state = fileWith('{"nope": 1, "agy": false, "kimi": "x"}');
    const eligibility = openEligibility({}, '/home/u', state.file);
    expect([eligibility.toggle('claude'), eligibility.toggle('kimi')]).toEqual([true, true]);
    expect(state.saved().at(-1)).toEqual({ nope: 1, agy: false, kimi: false, claude: false });
    eligibility.toggle('agy');
    expect(state.saved().at(-1)).toEqual({ nope: 1, agy: true, kimi: false, claude: false });
    expect(eligibility.ineligible()).toEqual(['kimi', 'claude']);
    expect(state.reads).toHaveLength(1);
  });

  it('keeps the state when a write fails, so the next write flips the old state once', () => {
    const state = fileWith('{"agy": false}', [false]);
    const eligibility = openEligibility({}, '/home/u', state.file);
    expect(eligibility.toggle('claude')).toBe(false);
    expect(eligibility.ineligible()).toEqual(['agy']);
    expect(eligibility.toggle('claude')).toBe(true);
    expect(state.saved()).toEqual([{ agy: false, claude: false }, { agy: false, claude: false }]);
    expect(eligibility.ineligible()).toEqual(['agy', 'claude']);
  });

  it('serializes as two-space JSON with a trailing newline', () => {
    const state = fileWith(undefined);
    openEligibility({}, '/home/u', state.file).toggle('claude');
    expect(state.writes).toEqual([['/home/u/.local/state/dandelion/eligibility.json', '{\n  "claude": false\n}\n']]);
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
