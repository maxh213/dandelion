import { describe, it, expect } from 'vitest';
import type { ProviderUsage } from '../domain/index.ts';
import { renderRoute } from './route.ts';

const NOW = '2026-09-14T20:00:00.000Z';
const CLAUDE: ProviderUsage[] = [
  { id: 'claude', displayName: 'claude', fetchedAt: NOW, status: 'ok', windows: [{ label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: '2026-09-15T03:00:00.000Z' }] }
];

describe('renderRoute', () => {
  it('evaporates a weekly that resets before local midnight in the given zone, not before UTC midnight', () => {
    expect(renderRoute(CLAUDE, NOW, 'Etc/GMT+7', [])).toEqual({ line: 'claude-opus-5 max', routed: true });
    expect(renderRoute(CLAUDE, NOW, 'UTC', [])).toEqual({ line: 'claude-opus-5 high', routed: true });
  });

  it('is not routed when no provider can take the work', () => {
    expect(renderRoute([], NOW, 'UTC', [])).toEqual({ line: 'none', routed: false });
  });

  it('is not routed when the only routable provider is ineligible', () => {
    expect(renderRoute(CLAUDE, NOW, 'Etc/GMT+7', ['claude'])).toEqual({ line: 'none', routed: false });
  });
});
