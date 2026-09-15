import { describe, it, expect } from 'vitest';
import type { ProviderUsage } from '../domain/index.ts';
import { renderRoute } from './route.ts';

const NOW = '2026-09-14T20:00:00.000Z';
const CLAUDE: ProviderUsage[] = [
  { id: 'claude', displayName: 'claude', fetchedAt: NOW, status: 'ok', windows: [{ label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: '2026-09-15T03:00:00.000Z' }] }
];

describe('renderRoute', () => {
  it('evaporates a weekly that resets before local midnight in the given zone, not before UTC midnight', () => {
    expect(renderRoute(CLAUDE, [], { mode: 'headroom', now: NOW, zone: 'Etc/GMT+7' })).toEqual({ line: 'claude-opus-5 max claude', routed: true });
    expect(renderRoute(CLAUDE, [], { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ line: 'claude-opus-5 high claude', routed: true });
  });

  it('is not routed when no provider can take the work', () => {
    expect(renderRoute([], [], { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ line: 'none', routed: false });
  });

  it('is not routed when the only routable provider is ineligible', () => {
    expect(renderRoute(CLAUDE, ['claude'], { mode: 'headroom', now: NOW, zone: 'Etc/GMT+7' })).toEqual({ line: 'none', routed: false });
  });

  it('walks the quality chain instead of the 010 rules when high', () => {
    expect(renderRoute(CLAUDE, [], { mode: 'high', now: NOW, zone: 'Etc/GMT+7' })).toEqual({ line: 'claude-fable-5-1 max claude', routed: true });
    expect(renderRoute(CLAUDE, ['claude'], { mode: 'high', now: NOW, zone: 'Etc/GMT+7' })).toEqual({ line: 'none', routed: false });
  });
});
