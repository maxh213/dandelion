import { describe, it, expect } from 'vitest';
import type { ProviderUsage, RouteLines } from '../domain/index.ts';
import { renderRoute, renderRoutesFault, type RouteRequest } from './route.ts';

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
});
