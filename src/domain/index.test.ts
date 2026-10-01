import { describe, it, expect, vi } from 'vitest';
import {
  HIGH_CHAIN,
  dueReprobes,
  formatCountdown,
  highRouteLine,
  nextSortOrder,
  nextLocalMidnight,
  notificationEvents,
  openEligibility,
  openHidden,
  openHistory,
  openRoutes,
  orderPanels,
  passedResets,
  resetKey,
  projectFull,
  routeDecision,
  routeLine,
  sortSuffix,
  summariseFleet,
  validInstant,
  type ProviderUsage,
  type RouteLines,
  type StateFile,
  type UsageWindow,
  type WindowKind
} from './index.ts';

const LINES: RouteLines = {
  route: {
    claude: { standard: 'model-a high', max: 'model-a max' },
    'claude-work': { standard: 'model-a high', max: 'model-a max' },
    'claude-deepseek': { standard: 'vendor/model-o max', max: 'vendor/model-o max' },
    agy: { standard: 'model-c high', max: 'model-c max' },
    kimi: { standard: 'model-d max', max: 'model-d max' },
    grok: { standard: 'model-e xhigh', max: 'model-e xhigh' },
    cursor: { standard: 'model-f', max: 'model-f' },
    junie: { standard: 'model-g high', max: 'model-g high' },
    hermes: { standard: 'vendor/model-h xhigh', max: 'vendor/model-h xhigh' }
  },
  high: { fable: 'model-h1 max', cursor: 'model-f', opus: 'model-a max', grok: 'model-e xhigh', agy: 'model-c high' }
};

describe('validInstant', () => {
  it('accepts a real instant string', () => {
    expect(validInstant('2026-09-18T10:00:00Z')).toBe('2026-09-18T10:00:00Z');
  });

  it('omits a non-string that stringifies to a valid instant', () => {
    expect(validInstant(['2026-09-18T10:00:00Z'])).toBeUndefined();
    expect(validInstant({ toString: () => '2026-09-18T10:00:00Z' })).toBeUndefined();
  });
});

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


const F: RouteLines = {
  route: {
    claude: { standard: 'model-a high', max: 'model-a max' },
    'claude-work': { standard: 'model-b high', max: 'model-b max' },
    'claude-deepseek': { standard: 'vendor/model-o max', max: 'vendor/model-o max' },
    agy: { standard: 'model-c high', max: 'model-c max' },
    kimi: { standard: 'model-d', max: 'model-d max' },
    grok: { standard: 'model-e xhigh', max: 'model-e xhigh' },
    cursor: { standard: 'model-f', max: 'model-f' },
    junie: { standard: 'model-g high', max: 'model-g high' },
    hermes: { standard: 'vendor/model-h xhigh', max: 'vendor/model-h xhigh' }
  },
  high: { fable: 'model-h1 max', cursor: 'model-h2', opus: 'model-h3 max', grok: 'model-h4 xhigh', agy: 'model-h5 high' }
};

function reversedKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).reverse());
}

const R: RouteLines = { high: reversedKeys(F.high), route: reversedKeys(F.route) };

const WINDOW_KINDS: readonly WindowKind[] = ['rolling', 'weekly', 'other'];

function kindOf(text: string): WindowKind {
  const found = WINDOW_KINDS.find((kind) => kind === text);
  if (found === undefined) throw new Error(`unknown window kind ${text}`);
  return found;
}

describe('routeLine', () => {
  const NOW = '2026-09-14T11:00:00.000Z';
  const MIDNIGHT = '2026-09-15T00:00:00.000Z';

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

  function routeOf(candidates: string, ineligible: string[] = [], lines = LINES): string {
    return routeLine(lines, candidates.split('; ').map(usageOf), NOW, MIDNIGHT, ineligible);
  }

  it('decides the same pick routeLine prints, with the skipped accounts', () => {
    const usages = 'claude: rolling 95 @-; agy: weekly 40 @-; grok: weekly 10 @-; junie: unavailable'.split('; ').map(usageOf);
    expect(routeDecision(usages, NOW, MIDNIGHT, ['grok'])).toEqual({
      chosen: { rule: 'headroom', id: 'agy', left: 60 },
      rivals: [],
      skipped: { tripped: [{ id: 'claude', label: 'rolling', usedPct: 95 }], ineligible: ['grok'], unavailable: ['claude-work', 'claude-deepseek', 'kimi', 'cursor', 'junie', 'hermes'] }
    });
    expect(routeLine(LINES, usages, NOW, MIDNIGHT, ['grok'])).toBe('model-c high agy');
  });

  it('reports the most used rolling window of a tripped account', () => {
    const usages = [usageOf('claude: rolling 91 @-, rolling 97 @-')];
    expect(routeDecision(usages, NOW, MIDNIGHT, []).skipped.tripped).toEqual([{ id: 'claude', label: 'rolling', usedPct: 97 }]);
  });

  it('excludes ok usages with zero windows before any other rule', () => {
    expect(routeOf('claude: no windows')).toBe('none');
    expect(routeOf('claude: no windows; cursor: weekly 60 @2026-09-20T00:00:00.000Z')).toBe('model-f cursor');
  });

  it('does not evaporate a weekly at exactly 97 left or a reset at or before now', () => {
    expect(routeOf('claude: weekly 3 @2026-09-14T20:00:00.000Z; agy: rolling 0 @-')).toBe('model-c high agy');
    expect(routeOf('claude: weekly 50 @2026-09-14T11:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z')).toBe('model-c high agy');
    expect(routeOf('claude: weekly 50 @2026-09-14T10:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z')).toBe('model-c high agy');
  });

  it('rejects an unknown window kind in a table row', () => {
    expect(() => kindOf('weakly')).toThrow('unknown window kind weakly');
  });

  it('drops an ineligible provider before the evaporation rule', () => {
    expect(routeOf('claude: weekly 50 @2026-09-14T20:00:00.000Z; agy: rolling 40 @-', ['claude'])).toBe('model-c high agy');
  });

  it.each([
    ['before the headroom rule', 'claude: rolling 20 @-, weekly 30 @-; claude-work: rolling 10 @-, weekly 5 @-; agy: rolling 15 @-, weekly 20 @-', ['claude-work', 'nope'], 'model-c high agy'],
    ['leaving nothing to route', 'claude: weekly 50 @2026-09-14T20:00:00.000Z', ['claude'], 'none'],
    ['only when named', 'claude: weekly 50 @2026-09-14T20:00:00.000Z; agy: rolling 40 @-', ['agy'], 'model-a max claude']
  ])('drops ineligible providers %s', (_case, candidates, ineligible, line) => {
    expect(routeOf(candidates, ineligible)).toBe(line);
  });

  it.each([
    ['raw floats, headroom', 'claude: rolling 50.4 @-; agy: rolling 50.2 @-', 'model-c high agy'],
    ['96.9 left evaporates', 'claude: weekly 3.1 @2026-09-14T20:00:00.000Z; agy: rolling 0 @-', 'model-a max claude'],
    ['97 left does not evaporate', 'claude: weekly 3 @2026-09-14T20:00:00.000Z; agy: rolling 0 @-', 'model-c high agy'],
    ['reset already past never evaporates', 'claude: weekly 50 @2026-09-14T10:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'model-c high agy'],
    ['reset exactly at now never evaporates', 'claude: weekly 50 @2026-09-14T11:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'model-c high agy'],
    ['reset 1 ms after now evaporates', 'claude: weekly 50 @2026-09-14T11:00:00.001Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'model-a max claude'],
    ['a past reset still binds (stale grok)', 'grok: weekly 10 @2026-09-14T10:00:00.000Z; agy: rolling 20 @-, weekly 20 @2026-09-20T00:00:00.000Z', 'model-e xhigh grok'],
    ['weekly without resetsAt', 'claude: weekly 50 @-; agy: rolling 0 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'model-c high agy'],
    ['reset exactly at local midnight', 'claude: weekly 50 @2026-09-15T00:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'model-c high agy'],
    ['reset 1 ms before local midnight', 'claude: weekly 50 @2026-09-14T23:59:59.999Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z', 'model-a max claude'],
    ['other windows neither bind nor evaporate', 'claude: rolling 10 @-, weekly 10 @2026-09-20T00:00:00.000Z, other 99 @2026-09-14T14:00:00.000Z; agy: rolling 20 @-, weekly 20 @2026-09-20T00:00:00.000Z', 'model-a high claude'],
    ['ok with zero windows is excluded', 'claude: no windows; cursor: weekly 60 @2026-09-20T00:00:00.000Z', 'model-f cursor'],
    ['only ok with zero windows', 'claude: no windows', 'none'],
    ['only other windows bind at 100', 'claude-work: other 99 @-; agy: rolling 1 @-', 'model-a high claude-work'],
    ['unavailable and error are excluded', 'claude: unavailable; claude-work: error; kimi: weekly 90 @2026-09-20T00:00:00.000Z', 'model-d max kimi'],
    ['codex never routes, even evaporating', 'codex: weekly 50 @2026-09-14T20:00:00.000Z; agy: rolling 40 @-', 'model-c high agy'],
    ['codex as the only ok provider', 'codex: weekly 10 @2026-09-20T00:00:00.000Z', 'none'],
    ['kilo as the only ok provider', 'kilo: no windows', 'none']
  ])('%s', (_case, candidates, line) => {
    expect(routeOf(candidates)).toBe(line);
  });

  it.each([
    ['claude', 'model-a high', 'model-a max'],
    ['claude-work', 'model-a high', 'model-a max'],
    ['claude-deepseek', 'vendor/model-o max', 'vendor/model-o max'],
    ['agy', 'model-c high', 'model-c max'],
    ['kimi', 'model-d max', 'model-d max'],
    ['grok', 'model-e xhigh', 'model-e xhigh'],
    ['cursor', 'model-f', 'model-f'],
    ['junie', 'model-g high', 'model-g high'],
    ['hermes', 'vendor/model-h xhigh', 'vendor/model-h xhigh']
  ])('routes %s alone to its standard line, and to its max line when its weekly evaporates', (id, standard, max) => {
    expect(routeOf(`${id}: weekly 50 @2026-09-20T00:00:00.000Z`)).toBe(`${standard} ${id}`);
    expect(routeOf(`${id}: weekly 50 @2026-09-14T20:00:00.000Z`)).toBe(`${max} ${id}`);
  });

  const LIVE_NOW = '2026-09-14T12:39:00.000Z';

  function liveCase(session: string): string {
    return [
      'claude: rolling 2 @-, weekly 13 @2026-09-19T22:39:00.000Z, weekly 2 @2026-09-19T22:39:00.000Z',
      `claude-work: rolling ${session} @2026-09-14T15:50:00.000Z, weekly 72 @2026-09-14T18:00:00.000Z, weekly 52 @2026-09-14T17:59:00.000Z`,
      'agy: weekly 17 @2026-09-19T18:39:00.000Z, rolling 0 @-',
      'kimi: weekly 95 @2026-09-17T13:39:00.000Z, rolling 0 @-',
      'grok: weekly 9 @2026-09-19T22:39:00.000Z',
      'cursor: weekly 36 @2026-09-29T17:39:00.000Z, weekly 36 @2026-09-29T17:39:00.000Z, weekly 33 @2026-09-29T17:39:00.000Z'
    ].join('; ');
  }

  it.each([
    ['100', 'model-e xhigh grok'],
    ['90', 'model-e xhigh grok'],
    ['89.9', 'model-a max claude-work'],
    ['89', 'model-a max claude-work']
  ])('routes the live case with claude-work session at %s', (session, line) => {
    expect(routeLine(LINES, liveCase(session).split('; ').map(usageOf), LIVE_NOW, MIDNIGHT, [])).toBe(line);
  });

  it('routes cursor on its auto pool, ignoring a spent api pool', () => {
    const labelled = (text: string): ProviderUsage => ({
      id: 'cursor', displayName: 'cursor', fetchedAt: NOW, status: 'ok',
      windows: text.split(', ').map((each) => {
        const [label, used] = each.split(' ');
        return { label, kind: 'weekly', usedPct: Number(used), resetsAt: '2026-09-14T15:00:00.000Z' };
      })
    });
    const agy = usageOf('agy: rolling 0 @-, weekly 50 @2026-09-20T00:00:00.000Z');
    expect(routeLine(LINES, [labelled('total 59, auto 56, api 100'), agy], NOW, MIDNIGHT, [])).toBe('model-f cursor');
    expect(routeLine(LINES, [labelled('api 50'), agy], NOW, MIDNIGHT, [])).toBe('model-c high agy');
    expect(routeLine(LINES, [labelled('auto 50, api 10')], NOW, MIDNIGHT, [])).toBe('model-f cursor');
  });

  it('inclusive trip at exactly 90 skips the rolling account', () => {
    expect(routeOf('claude: rolling 90 @-; grok: weekly 95 @2026-09-20T00:00:00.000Z')).toBe('model-e xhigh grok');
    expect(routeOf('claude: rolling 89.999 @-; grok: weekly 95 @2026-09-20T00:00:00.000Z')).toBe('model-a high claude');
  });

  it.each([
    ['a tripped account loses rule 2', 'claude: rolling 90 @-; grok: weekly 95 @2026-09-20T00:00:00.000Z', [], 'model-e xhigh grok'],
    ['just under the trip is not tripped', 'claude: rolling 89.9 @-; agy: rolling 89.95 @-', [], 'model-a high claude'],
    ['an untripped evaporator still wins', 'claude: rolling 89.9 @-, weekly 95 @2026-09-14T20:00:00.000Z; agy: rolling 0 @-', [], 'model-a max claude'],
    ['a tripped evaporator is ignored', 'claude: rolling 90 @-, weekly 95 @2026-09-14T20:00:00.000Z; agy: rolling 80 @-', [], 'model-c high agy'],
    ['an other window never trips', 'agy: other 99 @-, weekly 50 @2026-09-20T00:00:00.000Z', [], 'model-c high agy'],
    ['ineligible and tripped leave nothing', 'claude: rolling 95 @-; claude-work: rolling 0 @-', ['claude-work'], 'none'],
    ['tripped kimi and unroutable codex and kilo leave nothing', 'kimi: rolling 90 @-; codex: weekly 0 @-; kilo: no windows', [], 'none']
  ])('trip: %s', (_case, candidates, ineligible, line) => {
    expect(routeOf(candidates, ineligible)).toBe(line);
  });

  it.each([
    ['kimi 10/10@72 beats grok 50', 'kimi: rolling 10 @-, weekly 10 @2026-09-17T11:00:00.000Z; grok: weekly 50 @2026-09-17T11:00:00.000Z', 'model-d max kimi'],
    ['kimi 90/10@72 trips to grok', 'kimi: rolling 90 @-, weekly 10 @2026-09-17T11:00:00.000Z; grok: weekly 50 @2026-09-17T11:00:00.000Z', 'model-e xhigh grok'],
    ['kimi 95/0@72 trips to grok 97', 'kimi: rolling 95 @-, weekly 0 @2026-09-17T11:00:00.000Z; grok: weekly 97 @2026-09-17T11:00:00.000Z', 'model-e xhigh grok'],
    ['kimi 0/95@2 evaporates past agy and does not trip', 'kimi: rolling 0 @-, weekly 95 @2026-09-14T13:00:00.000Z; agy: rolling 0 @-, weekly 0 @2026-09-17T11:00:00.000Z', 'model-d max kimi'],
    ['kimi 0/0@72 alone', 'kimi: rolling 0 @-, weekly 0 @2026-09-17T11:00:00.000Z', 'model-d max kimi']
  ])('018: %s', (_case, candidates, line) => {
    expect(routeOf(candidates)).toBe(line);
  });

  it.each([
    ['junie alone at 30%', 'junie: weekly 30 @-', [], 'model-g high junie'],
    ['junie alone at 100%', 'junie: weekly 100 @-', [], 'model-g high junie'],
    ['junie with more left than grok', 'grok: weekly 50 @2026-09-17T11:00:00.000Z; junie: weekly 30 @-', [], 'model-g high junie'],
    ['a tie with grok goes to grok', 'junie: weekly 0 @-; grok: weekly 0 @2026-09-17T11:00:00.000Z', [], 'model-e xhigh grok'],
    ['a tie with cursor goes to cursor', 'junie: weekly 0 @-; cursor: weekly 0 @2026-09-17T11:00:00.000Z', [], 'model-f cursor'],
    ['an evaporating claude beats an untouched junie', 'claude: rolling 0 @-, weekly 86 @2026-09-14T13:00:00.000Z; junie: weekly 0 @-', [], 'model-a max claude'],
    ['junie without a reference is not routed', 'grok: weekly 50 @2026-09-17T11:00:00.000Z; junie: no windows', [], 'model-e xhigh grok'],
    ['junie without a reference alone', 'junie: no windows', [], 'none'],
    ['an ineligible junie', 'junie: weekly 0 @-', ['junie'], 'none'],
    ['an unavailable junie', 'junie: unavailable', [], 'none']
  ])('junie: %s', (_case, candidates, ineligible, line) => {
    expect(routeOf(candidates, ineligible)).toBe(line);
  });

  it.each([
    ['hermes alone at 75%', 'hermes: weekly 75 @2026-09-20T00:00:00.000Z', [], 'vendor/model-h xhigh hermes'],
    ['hermes alone at 0%', 'hermes: weekly 0 @2026-09-20T00:00:00.000Z', [], 'vendor/model-h xhigh hermes'],
    ['hermes alone at 100%', 'hermes: weekly 100 @2026-09-20T00:00:00.000Z', [], 'vendor/model-h xhigh hermes'],
    ['grok at 50 beats hermes at 75', 'grok: weekly 50 @2026-09-17T11:00:00.000Z; hermes: weekly 75 @2026-09-20T00:00:00.000Z', [], 'model-e xhigh grok'],
    ['a tie with grok goes to grok', 'grok: weekly 0 @2026-09-17T11:00:00.000Z; hermes: weekly 0 @2026-09-20T00:00:00.000Z', [], 'model-e xhigh grok'],
    ['a tie with junie goes to junie', 'junie: weekly 0 @-; hermes: weekly 0 @2026-09-20T00:00:00.000Z', [], 'model-g high junie'],
    ['an ineligible hermes', 'hermes: weekly 75 @2026-09-20T00:00:00.000Z', ['hermes'], 'none'],
    ['an unavailable hermes', 'hermes: unavailable', [], 'none']
  ])('hermes: %s', (_case, candidates, ineligible, line) => {
    expect(routeOf(candidates, ineligible)).toBe(line);
  });

  it.each<[string, string[], string]>([
    ['junie: weekly 30 @-', [], 'model-e xhigh grok'],
    ['junie: weekly 0 @-', [], 'model-g high junie'],
    ['junie: no windows', [], 'model-e xhigh grok'],
    ['junie: weekly 0 @-', ['junie'], 'model-e xhigh grok']
  ])('routes the 014 live case with %s, ineligible %j', (junie, ineligible, line) => {
    const usages = `${liveCase('100')}; ${junie}`;
    expect(routeLine(LINES, usages.split('; ').map(usageOf), LIVE_NOW, MIDNIGHT, ineligible)).toBe(line);
  });

  it.each<[string, string[], string]>([
    ['junie: weekly 30 @-; hermes: weekly 75 @2026-09-20T00:00:00.000Z', [], 'model-e xhigh grok'],
    ['junie: weekly 30 @-; hermes: weekly 0 @2026-09-20T00:00:00.000Z', [], 'vendor/model-h xhigh hermes'],
    ['junie: weekly 0 @-; hermes: weekly 0 @2026-09-20T00:00:00.000Z', [], 'model-g high junie'],
    ['junie: weekly 30 @-; hermes: weekly 60 @2026-09-14T13:39:00.000Z', [], 'vendor/model-h xhigh hermes'],
    ['junie: weekly 30 @-; hermes: weekly 0 @2026-09-20T00:00:00.000Z', ['hermes'], 'model-e xhigh grok']
  ])('routes the 014 live case with junie and hermes as %s, ineligible %j', (extra, ineligible, line) => {
    const usages = `${liveCase('100')}; ${extra}`;
    expect(routeLine(LINES, usages.split('; ').map(usageOf), LIVE_NOW, MIDNIGHT, ineligible)).toBe(line);
  });

  const IN_2H = '2026-09-14T13:00:00.000Z';
  const IN_72H = '2026-09-17T11:00:00.000Z';

  it.each([
    ['claude evaporates', `claude: rolling 0 @-, weekly 86 @${IN_2H}; agy: rolling 0 @-, weekly 0 @${IN_72H}`, 'model-a max claude'],
    ['claude headroom', `claude: rolling 0 @-, weekly 3 @${IN_2H}; agy: rolling 10 @-, weekly 10 @${IN_72H}`, 'model-a high claude'],
    ['claude-work headroom', `claude: rolling 20 @-, weekly 30 @${IN_72H}; claude-work: rolling 10 @-, weekly 5 @${IN_72H}; agy: rolling 15 @-, weekly 20 @${IN_72H}`, 'model-b high claude-work'],
    ['claude-deepseek headroom at 5% used', `claude: rolling 20 @-, weekly 30 @${IN_72H}; claude-deepseek: weekly 5 @${IN_72H}`, 'vendor/model-o max claude-deepseek'],
    ['claude-deepseek weekly at 95% does not trip', 'claude-deepseek: weekly 95 @2026-09-20T00:00:00.000Z', 'vendor/model-o max claude-deepseek'],
    ['agy evaporates, tie', `agy: rolling 0 @-, weekly 90 @${IN_2H}; kimi: rolling 0 @-, weekly 90 @${IN_2H}`, 'model-c max agy'],
    ['one-word kimi line', `kimi: rolling 10 @-, weekly 10 @${IN_72H}; grok: weekly 50 @${IN_72H}`, 'model-d kimi'],
    ['grok', `grok: weekly 50 @${IN_72H}`, 'model-e xhigh grok'],
    ['cursor', `cursor: weekly 40 @${IN_72H}`, 'model-f cursor'],
    ['junie tie-breaker', 'junie: weekly 0 @-; hermes: weekly 0 @2026-09-20T00:00:00.000Z', 'model-g high junie'],
    ['hermes', 'hermes: weekly 75 @2026-09-20T00:00:00.000Z', 'vendor/model-h xhigh hermes'],
    ['nothing routable', 'claude: unavailable', 'none']
  ])('prints the line F holds for the provider and rule that win: %s', (_case, candidates, line) => {
    expect(routeOf(candidates, [], F)).toBe(line);
  });

  it('prints F\'s grok line for the 014 live case with junie and hermes', () => {
    expect(routeLine(F, `${liveCase('100')}; junie: weekly 30 @-; hermes: weekly 75 @2026-09-20T00:00:00.000Z`.split('; ').map(usageOf), LIVE_NOW, MIDNIGHT, [])).toBe('model-e xhigh grok');
  });

  it.each([
    [`agy: rolling 0 @-, weekly 90 @${IN_2H}; kimi: rolling 0 @-, weekly 90 @${IN_2H}`, 'model-c max agy'],
    ['junie: weekly 0 @-; hermes: weekly 0 @2026-09-20T00:00:00.000Z', 'model-g high junie'],
    ['hermes: weekly 0 @2026-09-20T00:00:00.000Z; junie: weekly 0 @-', 'model-g high junie']
  ])('breaks ties in dashboard order whatever the key order of the file: %s', (candidates, line) => {
    expect(routeOf(candidates, [], R)).toBe(line);
  });

  it('breaks ties in dashboard order whatever order the usages come in', () => {
    expect(routeOf('kimi: rolling 20 @-; agy: rolling 20 @-')).toBe('model-c high agy');
    expect(routeOf('kimi: weekly 10 @2026-09-14T20:00:00.000Z; agy: weekly 10 @2026-09-14T20:00:00.000Z')).toBe('model-c max agy');
  });

  it('route prints the moved model lines', () => {
    expect(routeOf('kimi: weekly 10 @2026-09-17T11:00:00.000Z; grok: weekly 50 @2026-09-17T11:00:00.000Z')).toBe('model-d max kimi');
    expect(routeOf('grok: weekly 50 @2026-09-17T11:00:00.000Z')).toBe('model-e xhigh grok');
    expect(routeOf('hermes: weekly 75 @2026-09-20T00:00:00.000Z')).toBe('vendor/model-h xhigh hermes');
    expect(routeOf('junie: weekly 30 @-')).toBe('model-g high junie');
  });

  it('Affected earlier rows keep working with the new strings', () => {
    expect(routeLine(LINES, `${liveCase('100')}; junie: weekly 30 @-; hermes: weekly 75 @2026-09-20T00:00:00.000Z`.split('; ').map(usageOf), LIVE_NOW, MIDNIGHT, [])).toBe('model-e xhigh grok');
    expect(routeOf('hermes: weekly 60 @2026-09-14T13:39:00.000Z')).toBe('vendor/model-h xhigh hermes');
    expect(routeOf('kimi: rolling 90 @-, weekly 10 @2026-09-17T11:00:00.000Z; grok: weekly 50 @2026-09-17T11:00:00.000Z')).toBe('model-e xhigh grok');
    expect(routeOf('kimi: rolling 0 @-, weekly 95 @2026-09-14T13:00:00.000Z; agy: rolling 0 @-, weekly 0 @2026-09-17T11:00:00.000Z')).toBe('model-d max kimi');
  });
});

describe('highRouteLine', () => {
  const NOW = '2026-09-14T11:00:00.000Z';

  function windowOf(text: string): UsageWindow {
    const [body, resetting] = text.split(' resetting ');
    const words = body.split(' ');
    const window: UsageWindow = { label: words.slice(0, -2).join(' '), kind: kindOf(String(words.at(-2))), usedPct: Number(words.at(-1)) };
    return resetting === undefined ? window : { ...window, resetsAt: '2026-09-14T12:00:00.000Z' };
  }

  function usageOf(entry: string): ProviderUsage {
    const [id, body] = entry.split(': ');
    const identity = { id, displayName: id, fetchedAt: NOW };
    if (body === 'unavailable' || body === 'error') return { ...identity, windows: [], status: body, reason: body };
    return { ...identity, windows: body.endsWith('no windows') ? [] : body.split(', ').map(windowOf), status: 'ok' };
  }

  function highOf(candidates: string, ineligible: string[] = [], lines = LINES): string {
    return highRouteLine(lines, candidates.split('; ').map(usageOf), ineligible);
  }

  it('matches Fable case-insensitively and keeps Fable off the opus gate', () => {
    expect(highOf('claude: session rolling 10, weekly weekly 50, weekly Fable weekly 100')).toBe('model-a max claude');
    expect(highOf('claude: session rolling 10, weekly FABLE weekly 90; cursor: total weekly 10')).toBe('model-f cursor');
  });

  it.each([
    ['1', 'claude: session rolling 3, weekly weekly 86, Fable weekly 10', 'model-h1 max claude'],
    ['2', 'claude: session rolling 95, weekly weekly 10, Fable weekly 10; cursor: total weekly 60', 'model-h2 cursor'],
    ['3', 'claude: session rolling 10, weekly weekly 10, Fable weekly 95', 'model-h3 max claude'],
    ['4', 'claude: session rolling 95, weekly weekly 10, Fable weekly 10; cursor: total weekly 95; grok: credits weekly 60', 'model-h4 xhigh grok'],
    ['5', 'agy: session rolling 10, weekly weekly 10', 'model-h5 high agy'],
    ['-', 'claude: unavailable', 'none']
  ])('prints the line F holds for rank %s', (_rank, candidates, line) => {
    expect(highOf(candidates, [], F)).toBe(line);
  });

  it.each([
    ['claude: session rolling 3, weekly weekly 86, Fable weekly 10; agy: session rolling 10, weekly weekly 10', 'model-h1 max claude'],
    ['claude: session rolling 10, weekly weekly 10, Fable weekly 95; grok: credits weekly 60', 'model-h3 max claude']
  ])('walks the chain in code order whatever the key order of the file: %s', (candidates, line) => {
    expect(highOf(candidates, [], R)).toBe(line);
  });

  it('pins the chain entry by entry', () => {
    expect(HIGH_CHAIN).toEqual([
      { rank: 1, name: 'fable', providers: ['claude', 'claude-work'], matcher: 'fable' },
      { rank: 2, name: 'cursor', providers: ['cursor'] },
      { rank: 3, name: 'opus', providers: ['claude', 'claude-work'] },
      { rank: 4, name: 'grok', providers: ['grok'] },
      { rank: 5, name: 'agy', providers: ['agy'] }
    ]);
  });

  it('inclusive trip at exactly 90 skips the gated account', () => {
    expect(highOf('claude: session rolling 90, weekly Fable weekly 10; cursor: total weekly 10')).toBe('model-f cursor');
    expect(highOf('claude: session rolling 89.999, weekly Fable weekly 10; cursor: total weekly 10')).toBe('model-h1 max claude');
  });

  it.each([
    ['89.9 does not trip', 'claude: session rolling 10, weekly Fable weekly 89.9', [], 'model-h1 max claude'],
    ['90 trips, matched in any case', 'claude: session rolling 10, weekly FABLE weekly 90; cursor: total weekly 10', [], 'model-f cursor'],
    ['opus ignores the Fable window', 'claude: session rolling 10, weekly weekly 50, weekly Fable weekly 100', [], 'model-a max claude'],
    ['an other window gates an (all) entry', 'agy: Gemini Models · Daily Limit other 90, Gemini Models · Weekly Limit weekly 10', [], 'none'],
    ['ok with no windows is skipped', 'cursor: ok with no windows; grok: credits weekly 50', [], 'model-e xhigh grok'],
    ['error and unavailable are skipped', 'claude: error; claude-work: unavailable; grok: credits weekly 89', [], 'model-e xhigh grok'],
    ['an ineligible account is skipped', 'claude-work: session rolling 0, weekly Fable weekly 0; cursor: total weekly 0', ['claude-work'], 'model-f cursor'],
    ['kimi, codex and kilo are never in the chain', 'kimi: 5h rolling 0; codex: weekly weekly 0; kilo: no windows', [], 'none'],
    ['resetsAt is ignored', 'grok: credits weekly 50 resetting 1 h from now; cursor: total weekly 60', [], 'model-f cursor'],
    ['a missing Fable window counts as 0', 'claude: session rolling 10, weekly weekly 50', [], 'model-h1 max claude'],
    ['all-models does not gate fable', 'claude: session rolling 10, weekly weekly 95, weekly Fable weekly 10', [], 'model-h1 max claude'],
    ['session gates fable', 'claude: session rolling 90, weekly weekly 10, weekly Fable weekly 10; cursor: total weekly 10', [], 'model-f cursor'],
    ['higher left on gating windows wins', 'claude: session rolling 85, weekly weekly 10, weekly Fable weekly 40; claude-work: session rolling 10, weekly weekly 10, weekly Fable weekly 70', [], 'model-h1 max claude-work'],
    ['equal left goes to personal', 'claude-work: session rolling 20, weekly weekly 60, weekly Fable weekly 0; claude: session rolling 20, weekly weekly 10, weekly Fable weekly 20', [], 'model-h1 max claude'],
    ['opus: higher left wins', 'claude: session rolling 10, weekly weekly 70, weekly Fable weekly 95; claude-work: session rolling 10, weekly weekly 40, weekly Fable weekly 90; cursor: total weekly 90', [], 'model-a max claude-work'],
    ['an (all) entry of a provider with no matcher is gated on a Fable-named window', 'claude: session rolling 95; cursor: total weekly 10, Fable weekly 95; grok: credits weekly 50', [], 'model-e xhigh grok'],
    ['the 014 live case keeps Fable on the untripped personal account', 'claude: session rolling 2, weekly weekly 13, weekly Fable weekly 2; claude-work: session rolling 100, weekly weekly 72, weekly Fable weekly 52; agy: Weekly Limit weekly 17, Five Hour Limit rolling 0; kimi: weekly weekly 95, 5h rolling 0; grok: credits weekly 9; cursor: total weekly 36, auto weekly 36, api weekly 33', [], 'model-h1 max claude'],
    ['junie is never in the chain', 'junie: credits weekly 0', [], 'none'],
    ['junie leaves the 014 live case on Fable', 'claude: session rolling 2, weekly weekly 13, weekly Fable weekly 2; claude-work: session rolling 100, weekly weekly 72, weekly Fable weekly 52; grok: credits weekly 9; junie: credits weekly 0', [], 'model-h1 max claude'],
    ['hermes is never in the chain', 'hermes: credits weekly 0', [], 'none'],
    ['hermes leaves the 014 live case on Fable', 'claude: session rolling 2, weekly weekly 13, weekly Fable weekly 2; claude-work: session rolling 100, weekly weekly 72, weekly Fable weekly 52; grok: credits weekly 9; hermes: credits weekly 0', [], 'model-h1 max claude'],
    ['agy is the last entry', 'grok: credits weekly 90; agy: Claude+GPT · 5h rolling 10, Gemini · weekly weekly 20', [], 'model-c high agy']
  ])('%s', (_case, candidates, ineligible, line) => {
    expect(highOf(candidates, ineligible)).toBe(line);
  });
});

describe('eligibility state', () => {
  function fileWith(text: string | undefined, saves: boolean[] = []) {
    const reads: string[] = [];
    const writes: [string, string][] = [];
    const file: StateFile = {
      read: (path) => {
        reads.push(path);
        if (text === undefined) throw new Error(`ENOENT: ${path}`);
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

describe('openRoutes', () => {
  const GOOD = JSON.stringify(F);
  const PATH = '/tmp/r/bad.json';

  function fileOf(texts: Record<string, string>) {
    const reads: string[] = [];
    const read = (path: string) => {
      reads.push(path);
      if (!Object.hasOwn(texts, path)) throw new Error(`ENOENT ${path}`);
      return texts[path];
    };
    return { file: { read }, reads };
  }

  function edited(edit: (value: Record<string, Record<string, unknown>>) => void): string {
    const value = JSON.parse(GOOD);
    edit(value);
    return JSON.stringify(value);
  }

  function problemOf(text: string): string | undefined {
    return openRoutes({ DANDELION_ROUTES_FILE: PATH }, '/shipped/routes.json', fileOf({ [PATH]: text }).file).fault?.problem;
  }

  it('reads DANDELION_ROUTES_FILE as given and returns its lines', () => {
    const { file, reads } = fileOf({ 'routes.json': GOOD });
    expect(openRoutes({ DANDELION_ROUTES_FILE: 'routes.json' }, '/shipped/routes.json', file)).toEqual({ lines: F });
    expect(reads).toEqual(['routes.json']);
  });

  it.each<[string, Record<string, string>]>([
    ['unset', {}],
    ['empty', { DANDELION_ROUTES_FILE: '' }]
  ])('reads the shipped file when DANDELION_ROUTES_FILE is %s', (_case, env) => {
    const { file, reads } = fileOf({ '/shipped/routes.json': GOOD });
    expect(openRoutes(env, '/shipped/routes.json', file)).toEqual({ lines: F });
    expect(reads).toEqual(['/shipped/routes.json']);
  });

  it('takes a file whose keys come in any order', () => {
    const { file } = fileOf({ [PATH]: JSON.stringify(R) });
    expect(openRoutes({ DANDELION_ROUTES_FILE: PATH }, '/shipped/routes.json', file)).toEqual({ lines: R });
  });

  it('names the path of a file it cannot read', () => {
    const { file } = fileOf({});
    expect(openRoutes({}, '/shipped/routes.json', file)).toEqual({ fault: { path: '/shipped/routes.json', problem: 'cannot be read' } });
  });

  it.each<[string, string, string]>([
    ['invalid JSON', '{"route":', 'is not valid JSON'],
    ['empty', '', 'is not valid JSON'],
    ['not an object', '[]', 'the file is not a JSON object'],
    ['top-level null', 'null', 'the file is not a JSON object'],
    ['route not an object', edited((value) => { value.route = [] as never; }), 'route is not a JSON object'],
    ['high not an object', edited((value) => { value.high = 'x' as never; }), 'high is not a JSON object'],
    ['provider missing', edited((value) => { delete value.route.hermes; }), 'route.hermes is missing'],
    ['high entry missing', edited((value) => { delete value.high.opus; }), 'high.opus is missing'],
    ['max missing', edited((value) => { delete (value.route.agy as Record<string, string>).max; }), 'route.agy.max is missing'],
    ['entry not an object', edited((value) => { value.route.claude = 'model-a high'; }), 'route.claude is not a JSON object'],
    ['empty line', edited((value) => { (value.route.kimi as Record<string, string>).standard = ''; }), 'route.kimi.standard is not a non-empty string'],
    ['not a string', edited((value) => { value.high.grok = 4; }), 'high.grok is not a non-empty string'],
    ['provider typo', edited((value) => { value.route['claude-wrok'] = value.route.claude; }), 'unknown key route.claude-wrok'],
    ['codex is not routed', edited((value) => { value.route.codex = value.route.cursor; }), 'unknown key route.codex'],
    ['unknown high name', edited((value) => { value.high.sonnet = 'model-x'; }), 'unknown key high.sonnet'],
    ['unknown top-level key', edited((value) => { value.extra = {}; }), 'unknown key extra'],
    ['unknown entry key', edited((value) => { (value.route.cursor as Record<string, string>).maxx = 'model-f'; }), 'unknown key route.cursor.maxx'],
    ['an inherited name as a key', edited((value) => { Object.defineProperty(value.high, 'toString', { value: 'model-x', enumerable: true }); }), 'unknown key high.toString'],
    ['three words', edited((value) => { (value.route.claude as Record<string, string>).max = 'model-a max extra'; }), 'route.claude.max is not "<model>" or "<model> <effort>"'],
    ['leading space', edited((value) => { value.high.fable = ' model-h1 max'; }), 'high.fable is not "<model>" or "<model> <effort>"'],
    ['trailing space', edited((value) => { (value.route.grok as Record<string, string>).standard = 'model-e xhigh '; }), 'route.grok.standard is not "<model>" or "<model> <effort>"'],
    ['two spaces', edited((value) => { (value.route.junie as Record<string, string>).max = 'model-g  high'; }), 'route.junie.max is not "<model>" or "<model> <effort>"'],
    ['tab', edited((value) => { (value.route.hermes as Record<string, string>).standard = 'vendor/model-h\txhigh'; }), 'route.hermes.standard is not "<model>" or "<model> <effort>"']
  ])('names what is wrong with a bad file: %s', (_case, text, problem) => {
    expect(problemOf(text)).toBe(problem);
  });
});

describe('hidden state', () => {
  function fileWith(text: string | undefined, saves: boolean[] = []) {
    const reads: string[] = [];
    const writes: [string, string][] = [];
    const file: StateFile = {
      read: (path) => {
        reads.push(path);
        if (text === undefined) throw new Error(`ENOENT: ${path}`);
        return text;
      },
      replace: (path, bytes) => {
        writes.push([path, bytes]);
        return saves.shift() ?? true;
      }
    };
    return { file, reads, writes };
  }

  it.each<[string, Record<string, string | undefined>, string]>([
    ['the directory of DANDELION_STATE_FILE', { DANDELION_STATE_FILE: '/s/e.json', XDG_STATE_HOME: '/xdg' }, '/s/hidden.json'],
    ['a bare state file name', { DANDELION_STATE_FILE: 'e.json' }, './hidden.json'],
    ['XDG_STATE_HOME', { XDG_STATE_HOME: '/xdg' }, '/xdg/dandelion/hidden.json'],
    ['home', {}, '/home/u/.local/state/dandelion/hidden.json']
  ])('keeps hidden.json in %s', (_case, env, path) => {
    const state = fileWith(undefined);
    openHidden(env, '/home/u', state.file).toggle('claude');
    expect(state.reads).toEqual([path]);
    expect(state.writes.map(([written]) => written)).toEqual([path]);
  });

  it.each<[string, string | undefined, string[]]>([
    ['a missing file', undefined, []],
    ['bytes that are not JSON', '[oops', []],
    ['a JSON object', '{"claude": true}', []],
    ['JSON null', 'null', []],
    ['a JSON string', '"claude"', []],
    ['an array', '["claude", "kilo"]', ['claude', 'kilo']],
    ['an array with non-strings', '[1, null, "agy"]', ['agy']]
  ])('reads %s as hidden %j', (_case, text, ids) => {
    expect(openHidden({}, '/home/u', fileWith(text).file).ids()).toEqual(ids);
  });

  it('adds an absent id, removes a present one and writes a JSON array', () => {
    const state = fileWith('["agy"]');
    const hidden = openHidden({}, '/home/u', state.file);
    expect([hidden.toggle('claude'), hidden.toggle('agy')]).toEqual([true, true]);
    expect(state.writes.map(([, bytes]) => bytes)).toEqual(['["agy","claude"]\n', '["claude"]\n']);
    expect(hidden.ids()).toEqual(['claude']);
  });

  it('keeps the ids when a write fails', () => {
    const hidden = openHidden({}, '/home/u', fileWith('["agy"]', [false]).file);
    expect(hidden.toggle('claude')).toBe(false);
    expect(hidden.ids()).toEqual(['agy']);
  });
});

const NOW = '2026-09-30T12:00:00.000Z';
const OK = { id: 'claude', status: 'ok', windows: [{ label: 'weekly', usedPct: 40, resetsAt: '2026-10-01T00:00:00.000Z' }, { label: 'session', usedPct: 5 }] };
const FAILED = { id: 'kimi', status: 'error', windows: [{ label: 'weekly', usedPct: 1 }] };

function opened(text: string | Error, env: Record<string, string | undefined> = {}, ok = true) {
  const replace = vi.fn<(path: string, text: string) => boolean>(() => ok);
  const read = () => {
    if (text instanceof Error) throw text;
    return text;
  };
  return { history: openHistory(env, '/home/u', { read, replace }), replace };
}

describe('usage history', () => {
  it('records one sample per window of each ok provider and skips failed ones', () => {
    const { history, replace } = opened('[]');
    expect(history.record([OK, FAILED], NOW)).toBe(true);
    expect(history.samples('claude')).toEqual([
      { id: 'claude', slot: 0, label: 'weekly', usedPct: 40, resetsAt: '2026-10-01T00:00:00.000Z', at: NOW },
      { id: 'claude', slot: 1, label: 'session', usedPct: 5, at: NOW }
    ]);
    expect(history.samples('kimi')).toEqual([]);
    expect(replace.mock.calls[0][0]).toBe('/home/u/.local/state/dandelion/history.json');
    expect(JSON.parse(replace.mock.calls[0][1])).toHaveLength(2);
  });

  it.each([
    ['XDG_STATE_HOME', { XDG_STATE_HOME: '/x' }, '/x/dandelion/history.json'],
    ['DANDELION_STATE_FILE', { DANDELION_STATE_FILE: '/s/el.json' }, '/s/history.json'],
    ['DANDELION_HISTORY_FILE', { DANDELION_STATE_FILE: '/s/el.json', DANDELION_HISTORY_FILE: '/h/h.json' }, '/h/h.json']
  ])('finds the file through %s', (_name, env, path) => {
    const { history, replace } = opened('[]', env);
    history.record([OK], NOW);
    expect(replace.mock.calls[0][0]).toBe(path);
  });

  it.each([['missing', new Error('ENOENT')], ['corrupt', '{nope'], ['not a list', '{"a":1}']])('starts empty when the file is %s', (_name, text) => {
    const { history } = opened(text);
    expect(history.samples('claude')).toEqual([]);
    expect(history.record([OK], NOW)).toBe(true);
    expect(history.samples('claude')).toHaveLength(2);
  });

  it('drops malformed entries, samples older than 30 days and all but the newest 40000', () => {
    const good = { id: 'a', slot: 0, label: 'w', usedPct: 1, at: '2026-09-29T00:00:00.000Z' };
    const old = { ...good, at: '2026-08-01T00:00:00.000Z' };
    const stored = [good, old, null, { ...good, usedPct: 'x' }, { ...good, at: 'nope' }, { ...good, slot: 0.5 }, { ...good, slot: undefined }, { ...good, id: 3 }, { ...good, label: 3 }, { ...good, at: 3 }, { ...good, resetsAt: 3 }];
    const { history } = opened(JSON.stringify(stored));
    history.record([], NOW);
    expect(history.samples('a')).toEqual([good]);
    const many = opened(JSON.stringify(Array.from({ length: 40005 }, (_, index) => ({ ...good, at: '2026-09-30T06:00:00.000Z', usedPct: index }))));
    many.history.record([], NOW);
    const kept = many.history.samples('a');
    expect(kept).toHaveLength(40000);
    expect(kept[0].usedPct).toBe(5);
  });

  it('keeps samples exactly 30 days old and drops those a millisecond older', () => {
    const edge = { id: 'a', slot: 0, label: 'w', usedPct: 1, at: '2026-08-31T12:00:00.000Z' };
    const { history } = opened(JSON.stringify([{ ...edge, at: '2026-08-31T11:59:59.999Z' }, edge]));
    history.record([], NOW);
    expect(history.samples('a')).toEqual([edge]);
  });

  it('keeps every sample of the last day and one per window per hour before that', () => {
    const base = { id: 'a', slot: 0, label: 'w', usedPct: 1 };
    const at = (iso: string, extra = {}) => ({ ...base, at: iso, ...extra });
    const stored = [
      at('2026-09-20T03:05:00.000Z', { usedPct: 1 }),
      at('2026-09-20T03:35:00.000Z', { usedPct: 2 }),
      at('2026-09-20T03:40:00.000Z', { usedPct: 3, slot: 1 }),
      at('2026-09-20T03:41:00.000Z', { usedPct: 4, id: 'b' }),
      at('2026-09-20T04:05:00.000Z', { usedPct: 5 }),
      at('2026-09-29T12:00:00.000Z', { usedPct: 6 }),
      at('2026-09-29T12:05:00.000Z', { usedPct: 7 })
    ];
    const { history } = opened(JSON.stringify(stored));
    history.record([], NOW);
    expect(history.samples('a').map((sample) => sample.usedPct)).toEqual([1, 3, 5, 6, 7]);
    expect(history.samples('b')).toHaveLength(1);
  });

  it('keeps its samples in memory and reports false when the write fails', () => {
    const { history } = opened('[]', {}, false);
    expect(history.record([OK], NOW)).toBe(false);
    expect(history.samples('claude')).toEqual([]);
  });
});

describe('notificationEvents', () => {
  const NOW = '2026-09-13T10:00:00.000Z';
  const MIDNIGHT = '2026-09-13T23:00:00.000Z';
  const usageOf = (windows: UsageWindow[], status: 'ok' | 'error' = 'ok'): ProviderUsage =>
    status === 'ok'
      ? { id: 'claude', displayName: 'claude', windows, fetchedAt: NOW, status }
      : { id: 'claude', displayName: 'claude', windows, fetchedAt: NOW, status, reason: 'down' };
  const week = (usedPct: number, resetsAt = '2026-09-18T10:00:00.000Z'): UsageWindow => ({ label: 'weekly', kind: 'weekly', usedPct, resetsAt });
  const session = (usedPct: number): UsageWindow => ({ label: '5h', kind: 'rolling', usedPct, resetsAt: '2026-09-13T15:00:00.000Z' });
  const texts = (before: UsageWindow[], after: UsageWindow[]) => notificationEvents(usageOf(before), usageOf(after), NOW, MIDNIGHT).map((event) => event.text);

  it('reports the highest threshold crossed, keyed by period', () => {
    expect(texts([week(79)], [week(80)])).toEqual(['claude weekly at 80%']);
    expect(texts([week(94)], [week(95)])).toEqual(['claude weekly at 95%']);
    expect(texts([week(70)], [week(97)])).toEqual(['claude weekly at 97%']);
    expect(notificationEvents(usageOf([week(79)]), usageOf([week(80)]), NOW, MIDNIGHT)[0].key).toContain('2026-09-18T10:00:00.000Z');
  });

  it('reports nothing for windows already over a threshold or new windows', () => {
    expect(texts([week(85)], [week(88)])).toEqual([]);
    expect(texts([], [week(99)])).toEqual([]);
  });

  it('reports a rolling window dropping below the trip but not a weekly one', () => {
    expect(texts([session(90)], [session(89)])).toEqual(['claude 5h recovered at 89%']);
    expect(texts([session(89)], [session(40)])).toEqual([]);
    expect(texts([week(91)], [week(40)])).toEqual([]);
  });

  it('reports a weekly window that newly evaporates with the time left', () => {
    const tonight = '2026-09-13T20:00:00.000Z';
    expect(texts([week(2, tonight)], [week(50, tonight)])).toEqual(['claude weekly is evaporating, resets in 10h0m']);
    expect(texts([week(50, tonight)], [week(51, tonight)])).toEqual([]);
    expect(texts([week(100, tonight)], [week(50, tonight)])).toEqual([]);
    expect(texts([week(50)], [week(51)])).toEqual([]);
  });

  it('reports nothing unless both results are ok', () => {
    expect(notificationEvents(usageOf([week(10)], 'error'), usageOf([week(99)]), NOW, MIDNIGHT)).toEqual([]);
    expect(notificationEvents(usageOf([week(10)]), usageOf([week(99)], 'error'), NOW, MIDNIGHT)).toEqual([]);
  });
});

describe('projectFull', () => {
  const NOW = '2026-09-13T10:00:00.000Z';
  const rolling = (usedPct: number, resetsAt?: string): UsageWindow => ({ label: '5h', kind: 'rolling', usedPct, resetsAt: resetsAt ?? '2026-09-13T13:00:00.000Z' });

  it('projects when a rolling window fills before it resets', () => {
    expect(projectFull(rolling(60), NOW)).toBe('2026-09-13T11:20:00.000Z');
  });

  it('is undefined when the window resets first', () => {
    expect(projectFull(rolling(30), NOW)).toBeUndefined();
    expect(projectFull(rolling(40), NOW)).toBeUndefined();
  });

  it('is undefined without a known length', () => {
    expect(projectFull({ label: 'total', kind: 'other', usedPct: 60, resetsAt: '2026-09-13T13:00:00.000Z' }, NOW)).toBeUndefined();
    expect(projectFull({ label: 'total', kind: 'weekly', usedPct: 60, resetsAt: '2026-09-13T13:00:00.000Z' }, NOW)).toBeUndefined();
  });

  it('is undefined for a missing or past reset', () => {
    expect(projectFull({ label: '5h', kind: 'rolling', usedPct: 60 }, NOW)).toBeUndefined();
    expect(projectFull(rolling(60, NOW), NOW)).toBeUndefined();
    expect(projectFull(rolling(60, '2026-09-13T09:00:00.000Z'), NOW)).toBeUndefined();
  });

  it('is undefined for no usage or a full window', () => {
    expect(projectFull(rolling(0), NOW)).toBeUndefined();
    expect(projectFull(rolling(100), NOW)).toBeUndefined();
    expect(projectFull(rolling(120), NOW)).toBeUndefined();
  });

  it('is undefined when under 5% of the window has elapsed', () => {
    expect(projectFull(rolling(50, '2026-09-13T14:50:00.000Z'), NOW)).toBeUndefined();
    expect(projectFull(rolling(50, '2026-09-13T14:45:00.000Z'), NOW)).toBe('2026-09-13T10:15:00.000Z');
  });

  it('uses seven days for a weekly label', () => {
    const weekly = (usedPct: number, resetsAt: string): UsageWindow => ({ label: 'Weekly Limit', kind: 'weekly', usedPct, resetsAt });
    expect(projectFull(weekly(80, '2026-09-15T10:00:00.000Z'), NOW)).toBe('2026-09-14T16:00:00.000Z');
    expect(projectFull(weekly(50, '2026-09-15T10:00:00.000Z'), NOW)).toBeUndefined();
    expect(projectFull({ ...weekly(80, '2026-09-15T10:00:00.000Z'), kind: 'other', label: 'WEEK' }, NOW)).toBe('2026-09-14T16:00:00.000Z');
  });
});

const ORDER_NOW = '2026-09-13T10:00:00.000Z';

function orderUsage(windows: { usedPct: number; resetsAt?: string }[]): ProviderUsage {
  return { id: 'x', displayName: 'x', windows: windows.map((window) => ({ label: 'w', kind: 'weekly', ...window })), fetchedAt: ORDER_NOW, status: 'ok' };
}

describe('orderPanels', () => {
  it('keeps dashboard order', () => {
    expect(orderPanels([orderUsage([{ usedPct: 90 }]), orderUsage([{ usedPct: 10 }]), undefined], 'dashboard', ORDER_NOW)).toEqual([0, 1, 2]);
  });

  it('puts the most headroom first, by the highest window, ties in dashboard order', () => {
    const usages = [orderUsage([{ usedPct: 50 }]), orderUsage([]), orderUsage([{ usedPct: 10 }, { usedPct: 70 }]), undefined, orderUsage([{ usedPct: 50 }]), orderUsage([{ usedPct: 5 }])];
    expect(orderPanels(usages, 'headroom', ORDER_NOW)).toEqual([5, 0, 4, 2, 1, 3]);
  });

  it('puts the earliest future reset first and ignores past or missing resets', () => {
    const usages = [
      orderUsage([{ usedPct: 1, resetsAt: '2026-09-15T10:00:00.000Z' }]),
      orderUsage([{ usedPct: 1, resetsAt: '2026-09-13T09:00:00.000Z' }]),
      orderUsage([{ usedPct: 1, resetsAt: '2026-09-13T12:00:00.000Z' }, { usedPct: 1, resetsAt: '2026-09-20T10:00:00.000Z' }]),
      orderUsage([{ usedPct: 1 }]),
      orderUsage([{ usedPct: 1, resetsAt: '2026-09-15T10:00:00.000Z' }])
    ];
    expect(orderPanels(usages, 'reset', ORDER_NOW)).toEqual([2, 0, 4, 1, 3]);
  });

  it('cycles dashboard, headroom, reset and labels the non-default ones', () => {
    expect(nextSortOrder('dashboard')).toBe('headroom');
    expect(nextSortOrder('headroom')).toBe('reset');
    expect(nextSortOrder('reset')).toBe('dashboard');
    expect([sortSuffix('dashboard'), sortSuffix('headroom'), sortSuffix('reset')]).toEqual(['', ' · sort: headroom', ' · sort: reset']);
  });
});

describe('dueReprobes', () => {
  const NOW = '2026-09-13T10:00:00.000Z';
  const PAST = '2026-09-13T09:59:00.000Z';
  const okWith = (...resets: (string | undefined)[]): ProviderUsage => ({
    id: 'claude',
    displayName: 'claude',
    windows: resets.map((resetsAt) => ({ label: 'w', kind: 'weekly', usedPct: 50, resetsAt })),
    fetchedAt: NOW,
    status: 'ok'
  });
  const failed: ProviderUsage = { id: 'agy', displayName: 'agy', windows: [], fetchedAt: NOW, status: 'error', reason: 'down' };

  it('returns providers with a reset passed by at least 60s', () => {
    expect(dueReprobes([okWith(PAST)], NOW, new Set())).toEqual([0]);
    expect(dueReprobes([okWith('2026-09-13T09:59:00.001Z')], NOW, new Set())).toEqual([]);
    expect(passedResets(okWith(PAST, '2026-09-14T00:00:00.000Z', undefined), NOW)).toEqual([PAST]);
  });

  it('ignores future resets, missing resets, unsettled and non-ok providers', () => {
    expect(dueReprobes([okWith('2026-09-14T00:00:00.000Z'), okWith(undefined), undefined, failed], NOW, new Set())).toEqual([]);
  });

  it('skips a handled key but not another reset value or another provider', () => {
    const handled = new Set([resetKey(0, PAST)]);
    expect(dueReprobes([okWith(PAST), okWith(PAST), okWith(PAST, '2026-09-13T09:00:00.000Z')], NOW, handled)).toEqual([1, 2]);
  });
});
