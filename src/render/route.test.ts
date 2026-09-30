import { describe, it, expect } from 'vitest';
import type { ProviderUsage, RouteLines, Routes } from '../domain/index.ts';
import { renderRoute, renderRoutesFault, renderSnapshot, type RouteRequest } from './route.ts';

const LINES: RouteLines = {
  route: {
    claude: { standard: 'model-a high', max: 'model-a max' },
    'claude-work': { standard: 'model-a high', max: 'model-a max' },
    agy: { standard: 'model-c high', max: 'model-c max' },
    kimi: { standard: 'model-d max', max: 'model-d max' },
    grok: { standard: 'model-e xhigh', max: 'model-e xhigh' },
    cursor: { standard: 'model-f', max: 'model-f' },
    junie: { standard: 'model-g high', max: 'model-g high' },
    hermes: { standard: 'vendor/model-h xhigh', max: 'vendor/model-h xhigh' }
  },
  high: { fable: 'model-h1 max', cursor: 'model-f', opus: 'model-a max', grok: 'model-e xhigh', agy: 'model-c high' }
};

const NOW = '2026-09-14T20:00:00.000Z';
const CLAUDE: ProviderUsage[] = [
  { id: 'claude', displayName: 'claude', fetchedAt: NOW, status: 'ok', windows: [{ label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: '2026-09-15T03:00:00.000Z' }] }
];

describe('renderRoute', () => {
  it('evaporates a weekly that resets before local midnight in the given zone, not before UTC midnight', () => {
    expect(renderRoute(LINES, CLAUDE, [], { mode: 'headroom', now: NOW, zone: 'Etc/GMT+7' })).toEqual({ out: 'model-a max claude\n', err: '', code: 0 });
    expect(renderRoute(LINES, CLAUDE, [], { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ out: 'model-a high claude\n', err: '', code: 0 });
  });

  it('is not routed when no provider can take the work', () => {
    expect(renderRoute(LINES, [], [], { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ out: 'none\n', err: '', code: 1 });
  });

  it('is not routed when the only routable provider is ineligible', () => {
    expect(renderRoute(LINES, CLAUDE, ['claude'], { mode: 'headroom', now: NOW, zone: 'Etc/GMT+7' })).toEqual({ out: 'none\n', err: '', code: 1 });
  });

  it('walks the quality chain instead of the 010 rules when high', () => {
    expect(renderRoute(LINES, CLAUDE, [], { mode: 'high', now: NOW, zone: 'Etc/GMT+7' })).toEqual({ out: 'model-h1 max claude\n', err: '', code: 0 });
    expect(renderRoute(LINES, CLAUDE, ['claude'], { mode: 'high', now: NOW, zone: 'Etc/GMT+7' })).toEqual({ out: 'none\n', err: '', code: 1 });
  });

  it('rejects a route mode it does not know', () => {
    const request = { mode: 'bogus', now: NOW, zone: 'UTC' } as unknown as RouteRequest;
    expect(() => renderRoute(LINES, [], [], request)).toThrow('Unexpected route mode');
  });

  it('prints a routes file fault on stderr only, with exit code 2', () => {
    expect(renderRoutesFault({ path: '/tmp/r/nope.json', problem: 'cannot be read' })).toEqual({ out: '', err: 'dandelion: routes file /tmp/r/nope.json: cannot be read\n', code: 2 });
  });

  describe('with why', () => {
    const SOON = '2026-09-15T03:00:00.000Z';
    const LATER = '2026-09-20T00:00:00.000Z';

    function usage(id: string, ...windows: [string, 'rolling' | 'weekly', number, string?][]): ProviderUsage {
      return { id, displayName: id, fetchedAt: NOW, status: 'ok', windows: windows.map(([label, kind, usedPct, resetsAt]) => ({ label, kind, usedPct, ...(resetsAt === undefined ? {} : { resetsAt }) })) };
    }

    const DOWN: ProviderUsage = { id: 'junie', displayName: 'junie', fetchedAt: NOW, windows: [], status: 'unavailable', reason: 'down' };
    const why = (usages: ProviderUsage[], ineligible: string[], mode: 'headroom' | 'high') => renderRoute(LINES, usages, ineligible, { mode, now: NOW, zone: 'Etc/GMT+7', why: true });

    it('names the evaporating window and its local reset time', () => {
      const usages = [usage('kimi', ['weekly', 'weekly', 59, SOON]), usage('claude', ['weekly', 'weekly', 10, LATER])];
      expect(why(usages, [], 'headroom')).toEqual({ out: 'model-d max kimi\nevaporation: kimi weekly 41% left resets 20:00 before midnight\nunavailable: claude-work, agy, grok, cursor, junie, hermes\n', err: '', code: 0 });
    });

    it('names the binding headroom, the other accounts and every skipped account', () => {
      const usages = [usage('claude', ['weekly', 'weekly', 37, LATER]), usage('claude-work', ['session', 'rolling', 92], ['weekly', 'weekly', 10, LATER]), usage('agy', ['weekly', 'weekly', 78, LATER]), usage('grok', ['weekly', 'weekly', 1, LATER]), DOWN];
      expect(why(usages, ['grok'], 'headroom').out).toBe(
        'model-a high claude\nheadroom: claude binding 63% left (agy 22%)\ntripped: claude-work (session 92%); ineligible: grok; unavailable: kimi, cursor, junie, hermes\n'
      );
    });

    it('omits the others when the chosen account stands alone and the skipped line when nothing was skipped', () => {
      const all = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'cursor', 'junie', 'hermes'].map((id) => usage(id, ['weekly', 'weekly', 50, LATER]));
      expect(why([all[0]], [], 'headroom').out).toContain('headroom: claude binding 50% left\n');
      expect(why(all, [], 'headroom').out).toBe('model-a high claude\nheadroom: claude binding 50% left (claude-work 50%, agy 50%, kimi 50%, grok 50%, cursor 50%, junie 50%, hermes 50%)\n');
    });

    it('lists the skipped accounts when nothing can be routed', () => {
      const usages = [usage('claude', ['session', 'rolling', 90])];
      expect(why(usages, [], 'headroom')).toEqual({
        out: 'none\nnone: no account can take the work\ntripped: claude (session 90%); unavailable: claude-work, agy, kimi, grok, cursor, junie, hermes\n',
        err: '',
        code: 1
      });
    });

    it('names the winning rank and why each higher rank was skipped', () => {
      const usages = [usage('claude', ['session', 'rolling', 95], ['weekly fable', 'weekly', 10]), usage('grok', ['credits', 'weekly', 30])];
      expect(why(usages, [], 'high')).toEqual({
        out: 'model-e xhigh grok\nrank 4 grok on grok: gating 30% used\nskipped: rank 1 fable tripped at 95%; rank 2 cursor no open account; rank 3 opus tripped at 95%\n',
        err: '',
        code: 0
      });
    });

    it('says nothing was skipped by leaving the line out when rank 1 wins', () => {
      expect(why([usage('claude', ['session', 'rolling', 5])], [], 'high').out).toBe('model-h1 max claude\nrank 1 fable on claude: gating 5% used\n');
    });

    it('counts an ineligible provider as no open account for its rank', () => {
      expect(why([usage('claude', ['session', 'rolling', 5])], ['claude'], 'high')).toEqual({
        out: 'none\nnone: no chain entry is open\nskipped: rank 1 fable no open account; rank 2 cursor no open account; rank 3 opus no open account; rank 4 grok no open account; rank 5 agy no open account\n',
        err: '',
        code: 1
      });
    });

    it('lists every rank when the chain is empty', () => {
      expect(why([], [], 'high')).toEqual({
        out: 'none\nnone: no chain entry is open\nskipped: rank 1 fable no open account; rank 2 cursor no open account; rank 3 opus no open account; rank 4 grok no open account; rank 5 agy no open account\n',
        err: '',
        code: 1
      });
    });

    it('rejects a route mode it does not know', () => {
      const request = { mode: 'bogus', now: NOW, zone: 'UTC', why: true } as unknown as RouteRequest;
      expect(() => renderRoute(LINES, [], [], request)).toThrow('Unexpected route mode');
    });
  });
});


const SNAPSHOT_LINES = {
  route: {
    claude: { standard: 'model-a high', max: 'model-a max' },
    agy: { standard: 'model-c high', max: 'model-c max' }
  },
  high: { fable: 'model-h1 max', opus: 'model-a max' }
};
const GOOD: Routes = { lines: SNAPSHOT_LINES };
const SNAPSHOT_NOW = '2026-09-14T20:00:00.000Z';
const REQUEST = { now: SNAPSHOT_NOW, zone: 'UTC' };

const SNAPSHOT_USAGES: ProviderUsage[] = [
  {
    id: 'claude',
    displayName: 'claude',
    planLabel: 'personal',
    captionSuffix: 'hidden',
    fetchedAt: SNAPSHOT_NOW,
    status: 'ok',
    windows: [
      { label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: '2026-09-15T03:00:00.000Z' },
      { label: 'session', kind: 'rolling', usedPct: 10 }
    ]
  },
  { id: 'agy', displayName: 'agy', fetchedAt: SNAPSHOT_NOW, status: 'unavailable', windows: [], reason: 'agy is not installed' },
  { id: 'kilo', displayName: 'kilo', fetchedAt: SNAPSHOT_NOW, status: 'ok', windows: [], balance: { amount: 12.3, currency: 'USD', reference: 20 }, snapshotAt: '2026-09-14T19:00:00.000Z', note: 'fresh' }
];

function parsed(routes: Routes, ineligible: string[] = []) {
  const text = renderSnapshot(routes, SNAPSHOT_USAGES, ineligible, REQUEST);
  expect(text).not.toContain('\n');
  return JSON.parse(text);
}

describe('renderSnapshot', () => {
  it('lists every provider in order with only the fields it has', () => {
    expect(parsed(GOOD).providers).toEqual([
      {
        id: 'claude',
        displayName: 'claude',
        status: 'ok',
        planLabel: 'personal',
        eligible: true,
        windows: [
          { label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: '2026-09-15T03:00:00.000Z' },
          { label: 'session', kind: 'rolling', usedPct: 10 }
        ],
        fetchedAt: SNAPSHOT_NOW
      },
      { id: 'agy', displayName: 'agy', status: 'unavailable', eligible: true, windows: [], reason: 'agy is not installed', fetchedAt: SNAPSHOT_NOW },
      {
        id: 'kilo',
        displayName: 'kilo',
        status: 'ok',
        eligible: true,
        windows: [],
        balance: { amount: 12.3, currency: 'USD', reference: 20 },
        snapshotAt: '2026-09-14T19:00:00.000Z',
        note: 'fresh',
        fetchedAt: SNAPSHOT_NOW
      }
    ]);
    expect(parsed(GOOD).generatedAt).toBe(SNAPSHOT_NOW);
  });

  it('marks eligible false exactly for the ineligible providers', () => {
    expect(parsed(GOOD, ['agy']).providers.map((entry: { eligible: boolean }) => entry.eligible)).toEqual([true, false, true]);
  });

  it.each([['UTC'], ['Etc/GMT+7']])('carries the lines route and route --high print in %s, without the newline', (zone) => {
    const text = JSON.parse(renderSnapshot(GOOD, SNAPSHOT_USAGES, [], { now: SNAPSHOT_NOW, zone }));
    const request = { now: SNAPSHOT_NOW, zone };
    expect(text.route).toBe(renderRoute(SNAPSHOT_LINES, SNAPSHOT_USAGES, [], { mode: 'headroom', ...request }).out.slice(0, -1));
    expect(text.routeHigh).toBe(renderRoute(SNAPSHOT_LINES, SNAPSHOT_USAGES, [], { mode: 'high', ...request }).out.slice(0, -1));
  });

  it('carries none when nothing routes', () => {
    const text = JSON.parse(renderSnapshot(GOOD, [], [], REQUEST));
    expect([text.route, text.routeHigh]).toEqual(['none', 'none']);
  });

  it('nulls both routes and names the problem when the routes file is bad', () => {
    const snapshot = parsed({ fault: { path: '/x/routes.json', problem: 'is not valid JSON' } });
    expect([snapshot.route, snapshot.routeHigh, snapshot.routesError]).toEqual([null, null, '/x/routes.json: is not valid JSON']);
    expect(snapshot.providers).toHaveLength(3);
    expect(parsed(GOOD)).not.toHaveProperty('routesError');
  });
});
