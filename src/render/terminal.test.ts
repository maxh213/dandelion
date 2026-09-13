import { describe, it, expect } from 'vitest';
import {
  renderBanner,
  renderRule,
  renderGauge,
  renderEmptyGauge,
  renderPanelOk,
  renderPanelUnavailable,
  renderDashboard,
  renderWindowRow,
  styleToken,
  STYLE_TOKENS
} from './terminal.ts';
import type { ProviderUsage } from '../domain/index.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const RESET = '\x1b[0m';

describe('terminal renderer', () => {
  it('renders banner', () => {
    const banner = renderBanner('2026-09-13T10:00:00.000Z', true);
    expect(banner).toContain('ALLOWANCE');
    expect(banner).toContain('10:00:00Z');
    expect(banner).toHaveLength(72);
  });

  it('renders banner with color', () => {
    const banner = renderBanner('2026-09-13T10:00:00.000Z', false);
    expect(banner).toContain('\x1b[1m');
  });

  it('renders rule', () => {
    expect(renderRule(true)).toHaveLength(72);
    expect(renderRule(false)).toContain('\x1b[90m');
  });

  it('renders gauge', () => {
    expect(renderGauge(14.15, 20, true)).toBe('##############------');
    expect(renderGauge(14.50, 20, true)).toBe('###############-----');
    expect(renderGauge(25, 20, true)).toBe('####################');
    expect(renderGauge(14.15, 20, false)).toBe('██████████████░░░░░░');
  });

  it('renders empty gauge', () => {
    expect(renderEmptyGauge(true)).toBe('--------------------');
    expect(renderEmptyGauge(false)).toBe('░░░░░░░░░░░░░░░░░░░░');
  });

  it('renders ok panel', () => {
    const usage: ProviderUsage = {
      id: 'kilo',
      displayName: 'kilo',
      windows: [],
      fetchedAt: 'now',
      status: 'ok',
      balance: { amount: 14.15, currency: '$', reference: 20 }
    };
    const panel = renderPanelOk(usage, true, NOW);
    expect(panel).toContain('kilo');
    expect(panel).toContain('$14.15');
    expect(panel).toContain('##############------');
  });

  it('renders ok panel with no reference', () => {
    const usage: ProviderUsage = {
      id: 'kilo',
      displayName: 'kilo',
      windows: [],
      fetchedAt: 'now',
      status: 'ok',
      balance: { amount: 14.15, currency: '$' }
    };
    const panel = renderPanelOk(usage, true, NOW);
    expect(panel).toContain('--------------------');
  });

  it('renders ok panel with no balance', () => {
    const usage: ProviderUsage = {
      id: 'kilo',
      displayName: 'kilo',
      planLabel: 'api balance',
      windows: [],
      fetchedAt: 'now',
      status: 'ok'
    };
    const panel = renderPanelOk(usage, true, NOW);
    expect(panel).toContain('kilo');
    expect(panel).toContain('api balance · kilo');
    expect(panel.split('\n')).toContain(' '.repeat(72));
  });

  it('renders a caption of just the name when the plan is unknown', () => {
    const usage: ProviderUsage = { id: 'x', displayName: 'x', windows: [], fetchedAt: 'now', status: 'ok' };
    expect(renderPanelOk(usage, true, NOW).split('\n').at(-1)).toBe('x');
  });

  it('renders window rows between the name and the caption', () => {
    const usage: ProviderUsage = {
      id: 'claude',
      displayName: 'claude',
      planLabel: 'claude code',
      windows: [
        { label: 'session', usedPct: 3, resetsAt: '2026-09-13T18:40:00Z' },
        { label: 'weekly', usedPct: 86, resetsAt: '2026-09-13T22:00:00Z' }
      ],
      fetchedAt: 'now',
      status: 'ok'
    };
    expect(renderPanelOk(usage, true, NOW).split('\n')).toEqual([
      '='.repeat(72),
      'claude',
      'session                             #-------------------   3% ↻ 8h40m',
      'weekly                              #################---  86% ↻ 12h0m',
      'claude code · claude'
    ]);
  });

  it('renders unavailable panel', () => {
    const usage: ProviderUsage = {
      id: 'kilo',
      displayName: 'kilo',
      planLabel: 'api balance',
      windows: [],
      fetchedAt: 'now',
      status: 'unavailable',
      reason: 'Missing CLI'
    };
    const panel = renderPanelUnavailable(usage, true);
    expect(panel).toBe(`${'='.repeat(72)}\nkilo\nMissing CLI\napi balance · kilo`);

    const panelColor = renderPanelUnavailable(usage, false);
    expect(panelColor).toContain('\x1b[90m');
  });

  it('renders full dashboard', () => {
    const usages: ProviderUsage[] = [
      {
        id: 'kilo',
        displayName: 'kilo',
        windows: [],
        fetchedAt: 'now',
        status: 'ok',
        balance: { amount: 14.15, currency: '$', reference: 20 }
      },
      {
        id: 'other',
        displayName: 'other',
        windows: [],
        fetchedAt: 'now',
        status: 'error',
        reason: 'Probe crashed'
      }
    ];
    const dash = renderDashboard(usages, true, '2026-09-13T10:00:00.000Z');
    expect(dash).toContain('ALLOWANCE');
    expect(dash).toContain('##############------');
    expect(dash).toContain('other\nProbe crashed');

    const dashColor = renderDashboard(usages, false, '2026-09-13T10:00:00.000Z');
    expect(dashColor).toContain('\x1b[90m');
  });

  it('rejects a provider status it does not know', () => {
    const usage = { id: 'x', displayName: 'x', windows: [], fetchedAt: 'now', status: 'bogus' } as unknown as ProviderUsage;
    expect(() => renderDashboard([usage], true, '2026-09-13T10:00:00.000Z')).toThrow('Unexpected provider status');
  });
});

describe('window rows', () => {
  it('pads the label, gauge and right-aligned percent then the countdown', () => {
    expect(renderWindowRow({ label: 'weekly', usedPct: 86, resetsAt: '2026-09-13T22:00:00Z' }, true, NOW))
      .toBe('weekly                              #################---  86% ↻ 12h0m');
  });

  it('truncates labels longer than 35 cells with an ellipsis', () => {
    const weekly = { label: 'Claude and GPT models · Weekly Limit', usedPct: 0, resetsAt: '2026-09-20T17:13:45Z' };
    const fiveHour = { label: 'Claude and GPT models · Five Hour Limit', usedPct: 75, resetsAt: '2026-09-13T22:13:45Z' };
    expect(renderWindowRow(weekly, true, NOW)).toBe('Claude and GPT models · Weekly Lim… --------------------   0% ↻ 7d7h');
    expect(renderWindowRow(fiveHour, true, NOW)).toBe('Claude and GPT models · Five Hour…  ###############-----  75% ↻ 12h13m');
  });

  it('keeps a label of exactly 35 cells whole', () => {
    expect(renderWindowRow({ label: 'y'.repeat(35), usedPct: 50 }, true, NOW))
      .toBe(`${'y'.repeat(35)} ##########----------  50%`);
  });

  it('omits the countdown when the window has no reset', () => {
    expect(renderWindowRow({ label: 'weekly', usedPct: 50 }, true, NOW))
      .toBe('weekly                              ##########----------  50%');
  });

  it('fits the longest countdown in 72 cells', () => {
    const resetsAt = new Date(Date.parse(NOW) + (9999 * 24 + 23) * 3600 * 1000).toISOString();
    const row = renderWindowRow({ label: 'x'.repeat(40), usedPct: 100, resetsAt }, true, NOW);
    expect(row.endsWith('100% ↻ 9999d23h')).toBe(true);
    expect([...row]).toHaveLength(72);
  });

  it('wraps only the gauge and the percent in the style escape', () => {
    const calm = STYLE_TOKENS.calm;
    expect(renderWindowRow({ label: 'session', usedPct: 3, resetsAt: '2026-09-13T18:40:00Z' }, false, NOW))
      .toBe(`${'session'.padEnd(35)} ${calm}█${'░'.repeat(19)}${RESET} ${calm}  3%${RESET} ↻ 8h40m`);
  });

  it.each<[number, keyof typeof STYLE_TOKENS]>([
    [0, 'calm'],
    [49, 'calm'],
    [50, 'warm'],
    [79, 'warm'],
    [80, 'hot'],
    [94, 'hot'],
    [95, 'critical'],
    [100, 'critical']
  ])('styles a %i%% row as %s', (usedPct, token) => {
    expect(styleToken(usedPct)).toBe(token);
    const row = renderWindowRow({ label: 'weekly', usedPct }, false, NOW);
    expect(row.startsWith(`${'weekly'.padEnd(35)} ${STYLE_TOKENS[token]}`)).toBe(true);
  });

  it('maps the four tokens to distinct escapes', () => {
    expect(new Set(Object.values(STYLE_TOKENS)).size).toBe(4);
    expect(Object.keys(STYLE_TOKENS)).toEqual(['calm', 'warm', 'hot', 'critical']);
  });
});
