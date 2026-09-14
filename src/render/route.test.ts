import { describe, it, expect } from 'vitest';
import type { ProviderUsage } from '../domain/index.ts';
import { renderRoute } from './route.ts';

const NOW = '2026-09-14T20:00:00.000Z';
const CLAUDE: ProviderUsage[] = [
  { id: 'claude', displayName: 'claude', fetchedAt: NOW, status: 'ok', windows: [{ label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: '2026-09-15T03:00:00.000Z' }] }
];

describe('renderRoute', () => {
  it('evaporates a weekly that resets before local midnight in the given zone, not before UTC midnight', () => {
    expect(renderRoute(CLAUDE, NOW, 'Etc/GMT+7')).toBe('claude-opus-5 max');
    expect(renderRoute(CLAUDE, NOW, 'UTC')).toBe('claude-opus-5 high');
  });
});
