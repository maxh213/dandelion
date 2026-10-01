import { describe, it, expect, vi } from 'vitest';
import {
  renderBanner,
  renderRule,
  renderGauge,
  renderEmptyGauge,
  renderPanelOk,
  renderPanelUnavailable,
  renderDashboard,
  viewportLines,
  renderWindowRow,
  styleToken,
  STYLE_TOKENS,
  cellCount,
  clockTime,
  columnsWidth,
  fitToWidth,
  layoutOf,
  type PanelMarks
} from './terminal.ts';
import { renderLiveFrame, type LiveView } from './live-frame.ts';
import { highRouteLine, nextLocalMidnight, routeLine, type HistorySample, type ProviderUsage, type RouteLines, type UsageWindow } from '../domain/index.ts';

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

vi.mock('../domain/index.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../domain/index.ts')>();
  return { ...original, nextLocalMidnight: vi.fn(original.nextLocalMidnight) };
});

const NOW = '2026-09-13T10:00:00.000Z';
const RESET = '\x1b[0m';
const ESCAPE = String.fromCharCode(27);
const ANSI_CODE = new RegExp(`${ESCAPE}\\[\\d+m`, 'g');
const PLAN_CAPTION = new RegExp(`(plan · [\\w-]+)(?=${ESCAPE})`, 'g');
const PLAIN: PanelMarks = { selected: false, ineligible: false };

describe('terminal renderer', () => {
  it('renders banner', () => {
    const banner = renderBanner('2026-09-13T10:00:00.000Z', 'UTC', true);
    expect(banner).toContain('DANDELION');
    expect(banner).toContain('10:00:00');
    expect(banner).toHaveLength(72);
  });

  it('renders the banner clock in the given zone without a Z suffix', () => {
    const instant = '2026-09-30T18:43:05Z';
    const london = renderBanner(instant, 'Europe/London', true);
    expect(london.endsWith('19:43:05')).toBe(true);
    expect(london).not.toContain('Z');
    expect(renderBanner(instant, 'UTC', true).endsWith('18:43:05')).toBe(true);
  });

  it.each([true, false])('keeps the banner 72 cells wide in any zone with noColor %s', (noColor) => {
    const plain = (text: string): string => text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
    expect(cellCount(plain(renderBanner('2026-09-30T18:43:05Z', 'Asia/Kolkata', noColor)))).toBe(72);
    expect(plain(renderBanner('2026-09-30T23:59:59Z', 'Pacific/Auckland', noColor)).endsWith('12:59:59')).toBe(true);
  });

  it('renders midnight as 00 with a fixed locale and h23 cycle', () => {
    expect(clockTime('2026-09-30T04:00:00Z', 'America/New_York')).toBe('00:00:00');
    expect(clockTime('2026-09-30T03:59:59Z', 'America/New_York')).toBe('23:59:59');
  });

  it('renders banner with color', () => {
    const banner = renderBanner('2026-09-13T10:00:00.000Z', 'UTC', false);
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
    const panel = renderPanelOk(usage, true, NOW, PLAIN);
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
    const panel = renderPanelOk(usage, true, NOW, PLAIN);
    expect(panel).toContain('--------------------');
  });

  describe('kilo balance row', () => {
    const kilo = (amount: number, reference?: number): ProviderUsage => ({
      id: 'kilo',
      displayName: 'kilo',
      windows: [],
      fetchedAt: 'now',
      status: 'ok',
      balance: { amount, currency: '$', reference }
    });
    const strip = (text: string): string => text.replace(ANSI_CODE, '');
    const balanceRow = (usage: ProviderUsage, noColor: boolean): string => renderPanelOk(usage as Extract<ProviderUsage, { status: 'ok' }>, noColor, NOW, PLAIN).split('\n')[2];
    const weeklyRow = (noColor: boolean): string => renderWindowRow({ label: 'weekly', kind: 'weekly', usedPct: 10, resetsAt: '2026-09-13T22:00:00Z' }, noColor, NOW);

    it.each([true, false])('starts the gauge in the window row gauge column with noColor %s', (noColor) => {
      const column = (row: string): number => strip(row).search(/[#█░-]{20}/);
      expect(column(balanceRow(kilo(14.15, 20), noColor))).toBe(36);
      expect(column(balanceRow(kilo(14.15, 20), noColor))).toBe(column(weeklyRow(noColor)));
      expect(column(balanceRow(kilo(14.15), noColor))).toBe(column(weeklyRow(noColor)));
    });

    it('fills the row to exactly the dashboard width with a percent column', () => {
      const row = strip(balanceRow(kilo(14.15, 20), false));
      expect([...row]).toHaveLength(72);
      expect(row.trimEnd()).toBe(`${'balance $14.15'.padEnd(35)} ██████████████░░░░░░  71%`);
    });

    it('colours the gauge by the spent share: calm when full, critical when nearly empty', () => {
      expect(balanceRow(kilo(20, 20), false)).toContain(`${STYLE_TOKENS.calm}${'█'.repeat(20)}`);
      expect(balanceRow(kilo(1, 20), false)).toContain(`${STYLE_TOKENS.critical}█`);
      expect(balanceRow(kilo(1, 20), false)).toContain(`${STYLE_TOKENS.critical}  5%`);
      expect(balanceRow(kilo(3, 20), false)).toContain(STYLE_TOKENS.hot);
    });

    it('clamps the percent between 0 and 100', () => {
      expect(strip(balanceRow(kilo(25, 20), true))).toContain('100%');
      expect(strip(balanceRow(kilo(-1, 20), true))).toContain('  0%');
    });

    it('keeps an empty gauge without a percent when there is no reference', () => {
      const row = balanceRow(kilo(14.15), true);
      expect(row).toBe(`${'balance $14.15'.padEnd(35)} ${'-'.repeat(20)}`.padEnd(72));
    });
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
    const panel = renderPanelOk(usage, true, NOW, PLAIN);
    expect(panel).toContain('kilo');
    expect(panel).toContain('api balance · kilo');
    expect(panel.split('\n')).toContain(' '.repeat(72));
  });

  it('renders the note unpadded where window rows would be', () => {
    const usage: ProviderUsage = { id: 'codex', displayName: 'codex', planLabel: 'codex', windows: [], fetchedAt: 'now', status: 'ok', note: 'api-key billing · no usage windows' };
    expect(renderPanelOk(usage, true, NOW, PLAIN).split('\n')).toEqual(['='.repeat(72), 'codex', 'api-key billing · no usage windows', 'codex · codex']);
    expect(renderPanelOk(usage, false, NOW, PLAIN)).toBe(`\x1b[90m${'━'.repeat(72)}${RESET}\ncodex\napi-key billing · no usage windows\n\x1b[90mcodex · codex${RESET}`);
  });

  it('renders a caption of just the name when the plan is unknown', () => {
    const usage: ProviderUsage = { id: 'x', displayName: 'x', windows: [], fetchedAt: 'now', status: 'ok' };
    expect(renderPanelOk(usage, true, NOW, PLAIN).split('\n').at(-1)).toBe('x');
  });

  it('appends a caption suffix after the display name', () => {
    const usage: ProviderUsage = {
      id: 'hermes',
      displayName: 'hermes',
      planLabel: 'Plus · $5.50 of $22',
      captionSuffix: ' · no paid access',
      windows: [{ label: 'credits', kind: 'weekly', usedPct: 75 }],
      fetchedAt: NOW,
      status: 'ok'
    };
    expect(renderPanelOk(usage, true, NOW, PLAIN).split('\n').at(-1)).toBe('Plus · $5.50 of $22 · hermes · no paid access');
  });

  it('ends a kimi 5h row with its reset countdown', () => {
    const usage: ProviderUsage = {
      id: 'kimi',
      displayName: 'kimi',
      planLabel: 'kimi code',
      windows: [{ label: '5h', kind: 'rolling', usedPct: 42, resetsAt: '2026-09-13T15:00:00Z' }],
      fetchedAt: 'now',
      status: 'ok'
    };
    expect(renderPanelOk(usage, true, NOW, PLAIN).split('\n')[2]).toMatch(/ 42% ↻ 5h0m$/);
  });

  it('renders window rows between the name and the caption', () => {
    const usage: ProviderUsage = {
      id: 'claude',
      displayName: 'claude',
      planLabel: 'claude · personal',
      windows: [
        { label: 'session', kind: 'rolling', usedPct: 3, resetsAt: '2026-09-13T18:40:00Z' },
        { label: 'weekly', kind: 'weekly', usedPct: 86, resetsAt: '2026-09-13T22:00:00Z' }
      ],
      fetchedAt: 'now',
      status: 'ok'
    };
    expect(renderPanelOk(usage, true, NOW, PLAIN).split('\n')).toEqual([
      '='.repeat(72),
      'claude',
      'session                             #-------------------   3% ↻ 8h40m',
      'weekly                              #################---  86% ↻ 12h0m',
      'claude · personal · claude'
    ]);
  });

  it('renders a dim snapshot age line between the rows and the caption', () => {
    const usage: ProviderUsage = {
      id: 'grok',
      displayName: 'grok',
      planLabel: 'SuperGrok Heavy',
      windows: [{ label: 'credits', kind: 'weekly', usedPct: 75, resetsAt: '2026-09-13T21:15:36Z' }],
      fetchedAt: 'now',
      status: 'ok',
      snapshotAt: '2026-09-12T16:00:00.000Z'
    };
    expect(renderPanelOk(usage, true, NOW, PLAIN).split('\n')).toEqual([
      '='.repeat(72),
      'grok',
      'credits                             ###############-----  75% ↻ 11h15m',
      'snapshot 18h0m old',
      'SuperGrok Heavy · grok'
    ]);
    expect(renderPanelOk(usage, false, NOW, PLAIN)).toContain(`\x1b[90msnapshot 18h0m old${RESET}\n\x1b[90mSuperGrok Heavy · grok${RESET}`);
  });

  it.each([
    ['2026-09-11T10:00:00.000Z', 'snapshot 2d0h old'],
    ['2026-09-11T09:59:59.999Z', 'stale snapshot 2d0h old']
  ])('marks a snapshot at %s as "%s"', (snapshotAt, line) => {
    const usage: ProviderUsage = { id: 'g', displayName: 'g', windows: [{ label: 'credits', kind: 'weekly', usedPct: 10 }], fetchedAt: 'now', status: 'ok', snapshotAt };
    expect(renderPanelOk(usage, true, NOW, PLAIN).split('\n')[3]).toBe(line);
  });

  it('dims a stale panel as one block with plain gauge glyphs and no ramp escape', () => {
    const usage: ProviderUsage = {
      id: 'grok',
      displayName: 'grok',
      planLabel: 'grok',
      windows: [{ label: 'credits', kind: 'weekly', usedPct: 96 }],
      fetchedAt: 'now',
      status: 'ok',
      snapshotAt: '2026-09-10T17:14:22.812Z'
    };
    expect(renderPanelOk(usage, false, NOW, PLAIN)).toBe(
      `\x1b[90m${'━'.repeat(72)}${RESET}\n\x1b[90mgrok${RESET}\n\x1b[90m${'credits'.padEnd(35)} ${'█'.repeat(19)}░  96%${RESET}\n\x1b[90mstale snapshot 2d16h old${RESET}\n\x1b[90mgrok · grok${RESET}`
    );
    expect(renderPanelOk({ ...usage, windows: [] }, true, NOW, PLAIN).split('\n')[2]).toBe(' '.repeat(72));
    const credits = renderPanelOk({ ...usage, windows: [], balance: { amount: 5, currency: '$', reference: 20 } }, true, NOW, PLAIN).split('\n')[2];
    expect(credits).toBe(`${'balance $5.00'.padEnd(35)} #####---------------  25%`.padEnd(72));
  });

  it('draws the balance row of a stale panel dim', () => {
    const usage: ProviderUsage = {
      id: 'kilo',
      displayName: 'kilo',
      planLabel: 'api balance',
      windows: [],
      fetchedAt: 'now',
      status: 'ok',
      snapshotAt: '2026-09-10T17:14:22.812Z',
      balance: { amount: 14.15, currency: '$', reference: 20 }
    };
    expect(renderPanelOk(usage, false, NOW, PLAIN).split('\n')[2]).toBe(`\x1b[90m${'balance $14.15'.padEnd(35)} ${'█'.repeat(14)}${'░'.repeat(6)}  71%${' '.repeat(11)}${RESET}`);
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
    const panel = renderPanelUnavailable(usage, true, PLAIN);
    expect(panel).toBe(`${'='.repeat(72)}\nkilo\nMissing CLI\napi balance · kilo`);

    const panelColor = renderPanelUnavailable(usage, false, PLAIN);
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
    const dash = renderDashboard(usages, true, '2026-09-13T10:00:00.000Z', [], 'UTC');
    expect(dash).toContain('DANDELION');
    expect(dash).toContain('##############------');
    expect(dash).toContain('other\nProbe crashed');

    const dashColor = renderDashboard(usages, false, '2026-09-13T10:00:00.000Z', [], 'UTC');
    expect(dashColor).toContain('\x1b[90m');
  });

  it('rejects a provider status it does not know', () => {
    const usage = { id: 'x', displayName: 'x', windows: [], fetchedAt: 'now', status: 'bogus' } as unknown as ProviderUsage;
    expect(() => renderDashboard([usage], true, '2026-09-13T10:00:00.000Z', [], 'UTC')).toThrow('Unexpected provider status');
  });
});

describe('window rows', () => {
  it('pads the label, gauge and right-aligned percent then the countdown', () => {
    expect(renderWindowRow({ label: 'weekly', kind: 'weekly', usedPct: 86, resetsAt: '2026-09-13T22:00:00Z' }, true, NOW))
      .toBe('weekly                              #################---  86% ↻ 12h0m');
  });

  it('truncates labels longer than 35 cells with an ellipsis', () => {
    const weekly: UsageWindow = { label: 'Claude and GPT models · Weekly Limit', kind: 'weekly', usedPct: 0, resetsAt: '2026-09-20T17:13:45Z' };
    const fiveHour: UsageWindow = { label: 'Claude and GPT models · Five Hour Limit', kind: 'rolling', usedPct: 75, resetsAt: '2026-09-13T22:13:45Z' };
    expect(renderWindowRow(weekly, true, NOW)).toBe('Claude and GPT models · Weekly Lim… --------------------   0% ↻ 7d7h');
    expect(renderWindowRow(fiveHour, true, NOW)).toBe('Claude and GPT models · Five Hour…  ###############-----  75% ↻ 12h13m');
  });

  it('keeps a label of exactly 35 cells whole', () => {
    expect(renderWindowRow({ label: 'y'.repeat(35), kind: 'other', usedPct: 50 }, true, NOW))
      .toBe(`${'y'.repeat(35)} ##########----------  50%`);
  });

  it('omits the countdown when the window has no reset', () => {
    expect(renderWindowRow({ label: 'weekly', kind: 'weekly', usedPct: 50 }, true, NOW))
      .toBe('weekly                              ##########----------  50%');
  });

  it('fits the longest countdown in 72 cells', () => {
    const resetsAt = new Date(Date.parse(NOW) + (9999 * 24 + 23) * 3600 * 1000).toISOString();
    const row = renderWindowRow({ label: 'x'.repeat(40), kind: 'other', usedPct: 100, resetsAt }, true, NOW);
    expect(row.endsWith('100% ↻ 9999d23h')).toBe(true);
    expect([...row]).toHaveLength(72);
  });

  it('wraps only the gauge and the percent in the style escape', () => {
    const calm = STYLE_TOKENS.calm;
    expect(renderWindowRow({ label: 'session', kind: 'rolling', usedPct: 3, resetsAt: '2026-09-13T18:40:00Z' }, false, NOW))
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
    const row = renderWindowRow({ label: 'weekly', kind: 'weekly', usedPct }, false, NOW);
    expect(row.startsWith(`${'weekly'.padEnd(35)} ${STYLE_TOKENS[token]}`)).toBe(true);
  });

  it('maps the four tokens to distinct escapes', () => {
    expect(new Set(Object.values(STYLE_TOKENS)).size).toBe(4);
    expect(Object.keys(STYLE_TOKENS)).toEqual(['calm', 'warm', 'hot', 'critical']);
  });
});

describe('live frame', () => {
  type OkUsage = Extract<ProviderUsage, { status: 'ok' }>;
  const okUsage = (id: string, windows: UsageWindow[], extra: Partial<Omit<OkUsage, 'id' | 'displayName' | 'windows' | 'status'>> = {}): OkUsage =>
    ({ id, displayName: id, planLabel: 'plan', windows, fetchedAt: NOW, status: 'ok', ...extra });
  const unavailable = (id: string): ProviderUsage => ({ id, displayName: id, windows: [], fetchedAt: NOW, status: 'unavailable', reason: `${id} CLI not found in PATH` });
  const viewOf = (usages: (ProviderUsage | undefined)[], extra: Partial<LiveView> = {}): LiveView => ({
    slots: usages.map((usage, index) => ({ id: usage?.id ?? `p${index}`, usage })),
    spinner: 0,
    refreshing: false,
    footer: false,
    ineligible: [],
    zone: 'UTC',
    routes: { lines: LINES },
    rows: 60,
    ...extra
  });
  const AGY_FIVE_HOUR = 'Claude and GPT models · Five Hour Limit';
  const background = (agyFiveHourReset = '2026-09-13T22:13:45Z'): ProviderUsage[] => [
    okUsage('claude', [
      { label: 'session', kind: 'rolling', usedPct: 3, resetsAt: '2026-09-13T18:40:00.000Z' },
      { label: 'weekly', kind: 'weekly', usedPct: 86, resetsAt: '2026-09-13T22:00:00.000Z' },
      { label: 'weekly Fable', kind: 'weekly', usedPct: 100, resetsAt: '2026-09-13T22:00:00.000Z' }
    ]),
    okUsage('agy', [
      { label: 'Gemini Models · Weekly Limit', kind: 'weekly', usedPct: 0, resetsAt: '2026-09-20T17:13:45Z' },
      { label: 'Gemini Models · Five Hour Limit', kind: 'rolling', usedPct: 0, resetsAt: '2026-09-13T22:13:45Z' },
      { label: 'Claude and GPT models · Weekly Limit', kind: 'weekly', usedPct: 0, resetsAt: '2026-09-20T17:13:45Z' },
      { label: AGY_FIVE_HOUR, kind: 'rolling', usedPct: 75, resetsAt: agyFiveHourReset }
    ]),
    okUsage('kimi', [{ label: 'weekly', kind: 'weekly', usedPct: 59, resetsAt: '2026-09-18T10:00:00Z' }, { label: '5h', kind: 'rolling', usedPct: 42 }]),
    okUsage('grok', [{ label: 'credits', kind: 'weekly', usedPct: 75, resetsAt: '2026-09-13T21:15:36.133Z' }], { snapshotAt: '2026-09-12T16:00:00.000Z' }),
    okUsage('codex', [], { note: 'api-key billing · no usage windows' }),
    okUsage('cursor', [
      { label: 'total', kind: 'weekly', usedPct: 31, resetsAt: '2026-09-30T16:45:06.000Z' },
      { label: 'auto', kind: 'weekly', usedPct: 32, resetsAt: '2026-09-30T16:45:06.000Z' },
      { label: 'api', kind: 'weekly', usedPct: 16, resetsAt: '2026-09-30T16:45:06.000Z' }
    ]),
    okUsage('kilo', [], { balance: { amount: 14.15, currency: '$', reference: 20 } })
  ];
  const summaryOf = (usages: ProviderUsage[]) => renderLiveFrame(viewOf(usages), true, NOW).split('\n')[1];

  it.each<[string, ProviderUsage[], string]>([
    ['the Background results', background(), '2/13 windows above 80% · next reset: claude session in 8h40m'],
    [
      'kimi weekly and cursor total without a reset',
      [okUsage('kimi', [{ label: 'weekly', kind: 'weekly', usedPct: 59, resetsAt: '2026-09-18T10:00:00Z' }]), okUsage('cursor', [{ label: 'total', kind: 'weekly', usedPct: 31 }])],
      'all windows below 80% · next reset: kimi weekly in 5d0h'
    ],
    [
      'a claude and codex tie',
      [okUsage('claude', [{ label: 'weekly', kind: 'weekly', usedPct: 86, resetsAt: '2026-09-13T12:30:00Z' }]), okUsage('codex', [{ label: '5h', kind: 'rolling', usedPct: 80, resetsAt: '2026-09-13T12:30:00Z' }])],
      '2/2 windows above 80% · next reset: claude weekly in 2h30m'
    ],
    [
      'a past reset and a balance',
      [okUsage('grok', [{ label: 'credits', kind: 'weekly', usedPct: 79, resetsAt: '2026-09-13T09:00:00Z' }]), okUsage('kilo', [], { balance: { amount: 14.15, currency: '$' } })],
      'all windows below 80% · next reset: none'
    ],
    [
      'a hot claude window next to an unavailable kimi',
      [okUsage('claude', [{ label: 'weekly', kind: 'weekly', usedPct: 86, resetsAt: '2026-09-13T12:30:00Z' }]), unavailable('kimi')],
      '1/1 windows above 80% · next reset: claude weekly in 2h30m'
    ],
    ['a reset exactly at the frame time', [okUsage('grok', [{ label: 'credits', kind: 'weekly', usedPct: 79, resetsAt: NOW }])], 'all windows below 80% · next reset: none'],
    ['seven unavailable panels',['claude', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'].map(unavailable), 'all windows below 80% · next reset: none'],
    ['the Background with agy five hour soonest', background('2026-09-13T11:59:00Z'), '2/13 windows above 80% · next reset: agy Claude and GPT models… in 1h59m'],
    [
      'only the agy five hour window',
      [okUsage('agy', [{ label: AGY_FIVE_HOUR, kind: 'rolling', usedPct: 75, resetsAt: '2026-09-13T11:59:00Z' }])],
      'all windows below 80% · next reset: agy Claude and GPT models… in 1h59m'
    ]
  ])('summarises %s', (_case, usages, summary) => {
    expect(summaryOf(usages)).toBe(summary);
    expect([...summary].length).toBeLessThanOrEqual(72);
  });

  it('ignores the windows of unavailable results in the summary', () => {
    const failed = { ...unavailable('claude'), windows: [{ label: 'weekly', kind: 'weekly' as const, usedPct: 99, resetsAt: '2026-09-13T11:00:00Z' }] };
    expect(summaryOf([failed])).toBe('all windows below 80% · next reset: none');
  });

  it('renders the live banner variants in the view zone', () => {
    const now = '2026-09-30T18:43:05.000Z';
    const fetched = okUsage('claude', [], { fetchedAt: now });
    const london = (extra: Partial<LiveView> = {}): string => renderLiveFrame(viewOf([fetched], { zone: 'Europe/London', ...extra }), true, now).split('\n')[0] ?? '';
    expect(london().endsWith('data 0h0m old · 19:43:05')).toBe(true);
    expect(london({ refreshing: true }).endsWith('refreshing… · data 0h0m old · 19:43:05')).toBe(true);
    expect(cellCount(london())).toBe(72);
    expect(cellCount(london({ refreshing: true }))).toBe(72);
  });

  describe('terminal width', () => {
    const visible = (line: string): number => cellCount(line.replace(ANSI_CODE, ''));
    const frameAt = (columns: number | undefined, noColor: boolean, rows = 80): string[] =>
      renderLiveFrame(viewOf(background(), { columns, rows }), noColor, NOW).split('\n');
    const widest = (lines: string[]): number => Math.max(...lines.map(visible));

    it.each([true, false])('stretches the banner, dividers, route boxes and gauges to 200 columns (noColor %s)', (noColor) => {
      const lines = frameAt(200, noColor);
      const plain = lines.map((line) => line.replace(ANSI_CODE, ''));
      expect(visible(lines[0])).toBe(200);
      expect(visible(lines[2])).toBe(200);
      expect(plain.filter((line) => /^[=━]+$/.test(line)).map((line) => line.length)).toEqual(Array(plain.filter((line) => /^[=━]+$/.test(line)).length).fill(200));
      expect(plain.filter((line) => /^[=━]+$/.test(line)).length).toBeGreaterThan(3);
      expect(widest(lines)).toBe(200);
      const row = plain.find((line) => line.startsWith('session')) ?? '';
      expect(row.search(/[#█]/)).toBe(36);
      expect(row.search(/\d+%/)).toBeGreaterThan(72);
      expect(row.search(/↻/)).toBeGreaterThan(72);
    });

    it('keeps the 72-wide labels and caps the gauge', () => {
      expect(layoutOf(200)).toEqual({ width: 200, label: 35, gauge: 80 });
      expect(layoutOf(72)).toEqual({ width: 72, label: 35, gauge: 20 });
      expect(layoutOf(80)).toEqual({ width: 80, label: 35, gauge: 28 });
    });

    it('shrinks the gauge and then the label below 72 columns', () => {
      expect(layoutOf(60)).toEqual({ width: 60, label: 35, gauge: 8 });
      expect(layoutOf(50)).toEqual({ width: 50, label: 27, gauge: 6 });
      expect(layoutOf(10)).toEqual({ width: 10, label: 14, gauge: 6 });
    });

    it.each([true, false])('keeps every line within 50 columns and the row budget (noColor %s)', (noColor) => {
      const lines = frameAt(50, noColor, 20);
      expect(widest(lines)).toBeLessThanOrEqual(50);
      expect(lines.length).toBeLessThanOrEqual(20);
      expect(visible(lines[0])).toBeLessThanOrEqual(50);
    });

    it.each([undefined, 0, -3, 12.5, Number.NaN])('renders the 72-wide frame for columns %s', (columns) => {
      const reference = renderLiveFrame(viewOf(background(), { rows: 80 }), false, NOW);
      expect(renderLiveFrame(viewOf(background(), { rows: 80, columns }), false, NOW)).toBe(reference);
      expect(columnsWidth(columns)).toBeUndefined();
    });

    it('accepts a positive integer width', () => {
      expect(columnsWidth(120)).toBe(120);
    });

    it('cuts a coloured line on a cell boundary, closing the style', () => {
      const line = `\x1b[1mDANDELION\x1b[0m \x1b[90mrefreshing\x1b[0m`;
      const cut = fitToWidth(line, 12);
      expect(cut).toBe(`\x1b[1mDANDELION\x1b[0m \x1b[90mre\x1b[0m${RESET}`);
      expect(visible(cut)).toBe(12);
      expect(cut.endsWith(RESET)).toBe(true);
      expect(cut.replace(ANSI_CODE, '')).not.toContain(ESCAPE);
    });

    it('leaves a line that fits untouched', () => {
      expect(fitToWidth('', 3)).toBe('');
      expect(fitToWidth('\x1b[1mabc\x1b[0m', 3)).toBe('\x1b[1mabc\x1b[0m');
    });

    it('cuts a plain line without a reset escape being invented in the text', () => {
      expect(fitToWidth('abcdef', 3)).toBe(`abc${RESET}`);
    });

    it('stretches the graph view to the width', () => {
      const samples: HistorySample[] = [{ id: 'claude', label: 'weekly', slot: 0, usedPct: 10, resetsAt: '2026-09-14T00:00:00.000Z', at: '2026-09-13T08:00:00.000Z' }];
      const lines = renderLiveFrame(viewOf([], { columns: 100, graph: { id: 'claude', samples, usage: undefined } }), true, NOW).split('\n');
      expect(widest(lines)).toBeLessThanOrEqual(100);
    });
  });

  it('shows only the clock in the banner while nothing has settled', () => {
    const frame = renderLiveFrame(viewOf([undefined]), true, NOW).split('\n');
    expect(frame[0]).toBe(renderBanner(NOW, 'UTC', true));
  });

  it('shows the age of the oldest on-screen result in the banner', () => {
    const usages = [okUsage('claude', [], { fetchedAt: NOW }), okUsage('agy', [], { fetchedAt: '2026-09-13T09:58:00.000Z' }), okUsage('kilo', [], { fetchedAt: '2026-09-13T09:59:00.000Z' })];
    const frame = renderLiveFrame(viewOf([...usages, undefined]), true, '2026-09-13T10:00:30.000Z').split('\n');
    expect(frame[0]).toBe('DANDELION'.padEnd(48) + 'data 0h2m old · 10:00:30');
  });

  it('renders a pending panel as the rule, the id and the spinner frame for the tick', () => {
    const plain = renderLiveFrame(viewOf([undefined], { spinner: 11 }), true, NOW).split('\n').slice(6);
    expect(plain).toEqual(['='.repeat(72), 'p0', '⠙ probing…']);
    const coloured = renderLiveFrame({ ...viewOf([]), slots: [{ id: 'kimi', usage: undefined }] }, false, NOW);
    expect(coloured.split('\n').slice(6).join('\n')).toBe(`\x1b[90m${'━'.repeat(72)}${RESET}\n\x1b[90mkimi${RESET}\n\x1b[90m⠋ probing…${RESET}`);
    expect([...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'].map((frame, spinner) => renderLiveFrame(viewOf([undefined], { spinner }), true, NOW).endsWith(`${frame} probing…`))).toEqual(Array(10).fill(true));
  });

  it('colours the refreshing banner in spans, the summary and the footer dim, and panels as in once mode', () => {
    const frameNow = '2026-09-13T10:01:05.000Z';
    const lines = renderLiveFrame(viewOf(background(), { refreshing: true, footer: true }), false, frameNow).split('\n');
    expect(lines[0]).toBe(`\x1b[1mDANDELION${' '.repeat(25)}${RESET}\x1b[90mrefreshing…${RESET}\x1b[1m · data 0h1m old · 10:01:05${RESET}`);
    expect(lines[1]).toBe(`\x1b[90m2/13 windows above 80% · next reset: claude session in 8h38m${RESET}`);
    expect(lines.at(-1)).toBe(`\x1b[90m↑↓/jk select · space route · r refresh · t times · c/C copy · q quit · ?${RESET}`);
    expect(lines.at(-2)).toBe(`\x1b[90mg usage graph of the selected panel · esc/q/g back${RESET}`);
    expect(lines.slice(6, -3).join('\n')).toBe(renderDashboard(background(), false, frameNow, [], 'UTC').split('\n').slice(1).join('\n').replace(PLAN_CAPTION, '$1 · 0h1m ago'));
  });

  it('renders the refreshing banner and footer as plain text under NO_COLOR within 72 cells', () => {
    const lines = renderLiveFrame(viewOf(background(), { refreshing: true, footer: true }), true, '2026-09-13T10:01:05.000Z').split('\n');
    expect(lines[0]).toBe('DANDELION'.padEnd(34) + 'refreshing… · data 0h1m old · 10:01:05');
    expect(lines.at(-1)).toBe('↑↓/jk select · space route · r refresh · t times · c/C copy · q quit · ?');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  describe('absolute reset times', () => {
    const weekly = (resetsAt?: string): UsageWindow => ({ label: 'Claude and GPT models · Weekly Limit', kind: 'weekly', usedPct: 100, resetsAt });
    const view = (absoluteResets: boolean, zone = 'UTC'): LiveView => viewOf(background(), { absoluteResets, zone });

    it('switches every window row between countdown and local time and back', () => {
      const rows = (absoluteResets: boolean): string[] => renderLiveFrame(view(absoluteResets, 'Europe/London'), true, NOW).split('\n').filter((line) => line.includes('↻'));
      const relative = rows(false);
      const absolute = rows(true);
      expect(relative.length).toBeGreaterThan(0);
      expect(relative.every((line) => /↻ \d+[dh]\d+[hm]$/.test(line))).toBe(true);
      expect(absolute).toHaveLength(relative.length);
      expect(absolute.every((line) => /↻ (\w{3} \d{2}:\d{2}|\w{3} \d+ \d{2}:\d{2})$/.test(line))).toBe(true);
      expect(rows(false)).toEqual(relative);
    });

    it('renders a reset two days away as weekday and time in the zone and one nine days away as month, day and time', () => {
      const row = (resetsAt: string): string => renderWindowRow(weekly(resetsAt), true, '2026-10-03T10:00:00Z', 'Europe/London');
      expect(row('2026-10-05T08:05:00Z')).toMatch(/ ↻ Mon 09:05$/);
      expect(row('2026-10-12T20:40:00Z')).toMatch(/ ↻ Oct 12 21:40$/);
      expect(row('2026-10-09T10:00:00Z')).toMatch(/ ↻ Oct 9 11:00$/);
      expect(row('2026-10-09T09:59:00Z')).toMatch(/ ↻ Fri 10:59$/);
    });

    it('uses 24-hour time at midnight', () => {
      expect(renderWindowRow(weekly('2026-10-04T23:00:00Z'), true, '2026-10-03T10:00:00Z', 'Europe/London')).toMatch(/ ↻ Mon 00:00$/);
    });

    it('never widens a row past 72 cells in either mode and shows nothing without a reset', () => {
      const widest = (resetsAt: string | undefined, zone: string | undefined): number => cellsOf(renderWindowRow(weekly(resetsAt), true, NOW, zone));
      const cellsOf = (text: string): number => [...text].length;
      expect(widest('2026-10-12T20:40:00Z', 'UTC')).toBeLessThanOrEqual(72);
      expect(widest('2026-09-15T20:40:00Z', 'UTC')).toBeLessThanOrEqual(72);
      expect(widest('2026-12-30T20:40:00Z', undefined)).toBeLessThanOrEqual(72);
      expect(renderWindowRow(weekly(), true, NOW, 'UTC')).not.toContain('↻');
      expect(renderWindowRow(weekly(), true, NOW)).not.toContain('↻');
    });

    it('turns the summary line into next reset at an absolute time', () => {
      const summary = (absoluteResets: boolean): string => renderLiveFrame(view(absoluteResets), true, NOW).split('\n')[1];
      expect(summary(false)).toBe('2/13 windows above 80% · next reset: claude session in 8h40m');
      expect(summary(true)).toBe('2/13 windows above 80% · next reset: claude session at Sun 18:40');
    });

    it('renders a stale balance panel without windows', () => {
      const stale = { id: 'kilo', displayName: 'kilo', windows: [], fetchedAt: NOW, status: 'ok' as const, snapshotAt: '2026-09-01T10:00:00Z', balance: { amount: 5, currency: '$', reference: 10 } };
      expect(renderPanelOk(stale, true, NOW, PLAIN)).toContain('balance $5.00');
    });

    it('marks stale panels with the same absolute times', () => {
      const stale = okUsage('grok', [{ label: 'credits', kind: 'weekly', usedPct: 10, resetsAt: '2026-09-15T20:40:00Z' }], { snapshotAt: '2026-09-01T10:00:00Z' });
      expect(renderPanelOk(stale, true, NOW, { ...PLAIN, absoluteZone: 'UTC' })).toContain('↻ Tue 20:40');
    });
  });

  describe('frame height and scrolling', () => {
    const LATER = '2026-09-16T10:00:00.000Z';
    const RULE = '='.repeat(72);
    const BANNER = `${'DANDELION'.padEnd(48)}data 0h0m old · 10:00:00`;
    const SUMMARY = '8/14 windows above 80% · next reset: claude session in 3d0h';
    const FOOTER = '↑↓/jk select · space route · r refresh · t times · c/C copy · q quit · ?';
    const BOX_BLOCK = [
      '+- route -------------------------+  +- route --high ------------------+',
      '| model-a high                    |  | model-h1 max                    |',
      '| claude-work                     |  | claude-work                     |',
      '+---------------------------------+  +---------------------------------+'
    ];
    const CLAUDE_PANEL = [
      RULE,
      'claude',
      'session                             #-------------------   3% ↻ 3d0h',
      'weekly                              #################---  86% ↻ 3d0h',
      '  → 100% in ~15h37m (before reset)',
      'weekly Fable                        #################### 100% ↻ 3d0h',
      'claude · personal · claude · 0h0m ago'
    ];
    const WORK_PANEL = [
      RULE,
      'claude-work',
      'session                             --------------------   0% ↻ 3d0h',
      'weekly                              ##------------------  12% ↻ 3d0h',
      'weekly Fable                        #####---------------  23% ↻ 3d0h',
      'claude · work · claude-work · 0h0m ago'
    ];
    const AGY_PANEL = [
      RULE,
      'agy',
      'Gemini Models · Five Hour Limit     ##########----------  50% ↻ 3d0h',
      'Gemini Models · Weekly Limit        ##########----------  50% ↻ 3d0h',
      'agy · agy · 0h0m ago'
    ];
    const win = (label: string, kind: 'rolling' | 'weekly', usedPct: number): UsageWindow => ({ label, kind, usedPct, resetsAt: LATER });
    const down = (id: string, reason: string): ProviderUsage => ({ id, displayName: id, planLabel: id, windows: [], fetchedAt: NOW, status: 'unavailable', reason });
    const tenPanels = (): ProviderUsage[] => [
      okUsage('claude', [win('session', 'rolling', 3), win('weekly', 'weekly', 86), win('weekly Fable', 'weekly', 100)], { planLabel: 'claude · personal' }),
      okUsage('claude-work', [win('session', 'rolling', 0), win('weekly', 'weekly', 12), win('weekly Fable', 'weekly', 23)], { planLabel: 'claude · work' }),
      okUsage('agy', [win('Gemini Models · Five Hour Limit', 'rolling', 50), win('Gemini Models · Weekly Limit', 'weekly', 50)], { planLabel: 'agy' }),
      okUsage('kimi', [win('weekly', 'weekly', 85), win('5h', 'rolling', 85)], { planLabel: 'kimi code' }),
      okUsage('grok', [win('credits', 'weekly', 90)], { planLabel: 'SuperGrok', snapshotAt: NOW }),
      okUsage('codex', [], { planLabel: 'codex', note: 'api-key billing · no usage windows' }),
      okUsage('cursor', [win('total', 'weekly', 80), win('auto', 'weekly', 80), win('api', 'weekly', 80)], { planLabel: 'Ultra' }),
      down('junie', 'no junie quota snapshot — run junie once'),
      down('hermes', 'no hermes auth — run hermes portal login'),
      okUsage('kilo', [], { planLabel: 'api balance', balance: { amount: 14.15, currency: '$', reference: 20 } })
    ];
    const tenPanelView = (extra: Partial<LiveView> = {}): LiveView => {
      const usages = tenPanels();
      return viewOf(usages, { settled: usages, selected: -1, rows: 12, ...extra });
    };
    const frameOf = (extra: Partial<LiveView> = {}): string[] => renderLiveFrame(tenPanelView(extra), true, NOW).split('\n');

    it('opens a short terminal on the banner, the summary, the boxes and the personal claude panel', () => {
      const frame = renderLiveFrame(tenPanelView(), true, NOW);
      expect(frame.endsWith('\n')).toBe(false);
      expect(frame.split('\n')).toEqual([BANNER, SUMMARY, ...BOX_BLOCK, ...CLAUDE_PANEL.slice(0, -1)]);
    });

    it('opens the all-pending frame on the probing boxes and the first two pending panels', () => {
      const slots = tenPanels().map(({ id }) => ({ id, usage: undefined }));
      expect(renderLiveFrame(tenPanelView({ slots, settled: undefined }), true, NOW).split('\n')).toEqual([
        `${'DANDELION'.padEnd(64)}10:00:00`,
        'all windows below 80% · next reset: none',
        BOX_BLOCK[0],
        `| ${'⠋ probing…'.padEnd(31)} |  | ${'⠋ probing…'.padEnd(31)} |`,
        `| ${''.padEnd(31)} |  | ${''.padEnd(31)} |`,
        BOX_BLOCK[3],
        RULE,
        'claude',
        '⠋ probing…',
        RULE,
        'claude-work',
        '⠋ probing…'
      ]);
    });

    it.each([24, 0, undefined, 12.5])('renders the 24-line budget when rows is %s', (rows) => {
      expect(frameOf({ rows })).toEqual([BANNER, SUMMARY, ...BOX_BLOCK, ...CLAUDE_PANEL, ...WORK_PANEL, ...AGY_PANEL]);
    });

    it('starts the panel region at offset 0 when selected is omitted', () => {
      expect(frameOf({ selected: undefined })).toEqual([BANNER, SUMMARY, ...BOX_BLOCK, ...CLAUDE_PANEL.slice(0, -1)]);
    });

    it('scrolls only as far as needed to keep the whole selected panel in view', () => {
      expect(frameOf({ selected: 9 })).toEqual([
        BANNER,
        SUMMARY,
        ...BOX_BLOCK,
        'no hermes auth — run hermes portal login',
        'hermes · hermes · 0h0m ago',
        RULE,
        '▸ kilo',
        `${'balance $14.15'.padEnd(35)} ##############------  71%`.padEnd(72),
        'api balance · kilo · 0h0m ago'
      ]);
      expect(frameOf({ selected: 6 })).toEqual([
        BANNER,
        SUMMARY,
        ...BOX_BLOCK,
        RULE,
        '▸ cursor',
        'total                               ################----  80% ↻ 3d0h',
        'auto                                ################----  80% ↻ 3d0h',
        'api                                 ################----  80% ↻ 3d0h',
        'Ultra · cursor · 0h0m ago'
      ]);
    });

    it('walks back to the first panel with the boxes still in the chrome', () => {
      expect(frameOf({ selected: 0 })).toEqual([BANNER, SUMMARY, ...BOX_BLOCK, '▸ claude', ...CLAUDE_PANEL.slice(2)]);
    });

    it.each([0, 4, 9])('shows every panel from the first one when they all fit and %i is selected', (selected) => {
      const frame = frameOf({ selected, rows: 200 });
      const ids = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];
      expect(frame.slice(6, 8)).toEqual([RULE, selected === 0 ? '▸ claude' : 'claude']);
      expect(frame.filter((line) => ids.includes(line.replace(/^▸ /, '').split(' ')[0]) && !line.startsWith('=') && !line.includes('·'))).toHaveLength(10);
      expect(frame.filter((line) => line.startsWith('▸ '))).toEqual([`▸ ${ids[selected]}`]);
    });

    it('keeps the selected header visible when that panel is taller than the region', () => {
      expect(frameOf({ selected: 0, rows: 8 })).toEqual([BANNER, SUMMARY, ...BOX_BLOCK, '▸ claude', CLAUDE_PANEL[2]]);
    });

    it('keeps the help footer as the last line of the frame', () => {
      expect(frameOf({ selected: 0, footer: true })).toEqual([BANNER, SUMMARY, ...BOX_BLOCK, '▸ claude', ...CLAUDE_PANEL.slice(2, -3), 'h hide · H show hidden · R refresh panel', 'g usage graph of the selected panel · esc/q/g back', FOOTER]);
    });

    it.each<[number, string[]]>([
      [4, [BANNER, SUMMARY, BOX_BLOCK[0], BOX_BLOCK[1]]],
      [1, [BANNER]]
    ])('clips the chrome from the bottom when rows is %i', (rows, expected) => {
      expect(frameOf({ rows })).toEqual(expected);
      expect(frameOf({ rows, footer: true })).toEqual(expected);
    });

    it('lays the same view out against a new row budget', () => {
      const grown = frameOf({ rows: 30 });
      expect(grown).toHaveLength(30);
      expect(grown.slice(0, 12)).toEqual(frameOf());
      expect(grown.at(-1)).toBe('kimi code · kimi · 0h0m ago');
      expect(frameOf({ rows: 10 })).toEqual([BANNER, SUMMARY, ...BOX_BLOCK, ...CLAUDE_PANEL.slice(0, 4)]);
      expect(frameOf({ rows: 30, selected: 9 })).toHaveLength(30);
      expect(frameOf({ rows: 30, selected: 9 }).slice(-4)).toEqual([RULE, ...frameOf({ selected: 9 }).slice(-3)]);
    });

    it('never clips the once dashboard and draws no boxes there', () => {
      const once = renderDashboard(tenPanels(), true, NOW, [], 'UTC');
      expect(once.split('\n')).toHaveLength(52);
      expect(once).not.toContain('+- route');
      const ids = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];
      expect(ids.every((id) => once.includes(`\n${id}\n`))).toBe(true);
    });
  });
});

describe('panel marks', () => {
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[90m';
  const REASON = 'claude CLI not found in PATH';
  const CAPTION = 'claude · personal · claude · 0h0m ago';
  const WEEKLY: UsageWindow = { label: 'weekly', kind: 'weekly', usedPct: 86 };
  const freshClaude: ProviderUsage = { id: 'claude', displayName: 'claude', planLabel: 'claude · personal', windows: [WEEKLY], fetchedAt: NOW, status: 'ok' };
  const unavailableClaude: ProviderUsage = { id: 'claude', displayName: 'claude', planLabel: 'claude · personal', windows: [], fetchedAt: NOW, status: 'unavailable', reason: REASON };
  const liveView = (usage: ProviderUsage | undefined, extra: Partial<LiveView> = {}): LiveView => ({
    slots: [{ id: 'claude', usage }],
    spinner: 0,
    refreshing: false,
    footer: false,
    ineligible: ['claude'],
    zone: 'UTC',
    routes: { lines: LINES },
    ...extra
  });
  const SELECTED_RULE = `${BOLD}${'━'.repeat(72)}${RESET}`;
  const panelOf = (view: LiveView, noColor = false) => renderLiveFrame(view, noColor, NOW).split('\n').slice(6).join('\n');

  it.each<[string, ProviderUsage | undefined, number | undefined, string]>([
    ['unavailable, not selected', unavailableClaude, undefined, `${DIM}${'━'.repeat(72)}${RESET}\n${DIM}claude${' '.repeat(55)}routing off${RESET}\n${DIM}${REASON}${RESET}\n${DIM}${CAPTION}${RESET}`],
    ['unavailable, selected', unavailableClaude, 0, `${SELECTED_RULE}\n${DIM}▸ claude${' '.repeat(53)}routing off${RESET}\n${DIM}${REASON}${RESET}\n${DIM}${CAPTION}${RESET}`],
    ['pending, not selected', undefined, undefined, `${DIM}${'━'.repeat(72)}${RESET}\n${DIM}claude${' '.repeat(55)}routing off${RESET}\n${DIM}⠋ probing…${RESET}`],
    ['pending, selected', undefined, 0, `${SELECTED_RULE}\n${DIM}▸ claude${' '.repeat(53)}routing off${RESET}\n${DIM}⠋ probing…${RESET}`]
  ])('keeps the tag inside the dim span of an all-dim panel: %s', (_case, usage, selected, bytes) => {
    expect(panelOf(liveView(usage, { selected }))).toBe(bytes);
  });

  it('dims the tag on its own and bolds the selected rule of a fresh panel', () => {
    const row = renderWindowRow(WEEKLY, false, NOW);
    expect(renderPanelOk(freshClaude, false, NOW, { selected: true, ineligible: true }).split('\n')[0]).toBe(`${BOLD}${'━'.repeat(72)}${RESET}`);
    expect(panelOf(liveView(freshClaude, { selected: 0 }))).toBe(
      [SELECTED_RULE, `▸ claude${' '.repeat(53)}${DIM}routing off${RESET}`, row, `${DIM}${CAPTION}${RESET}`].join('\n')
    );
    expect(panelOf(liveView(freshClaude, { ineligible: [], selected: 0 }))).toBe(`${SELECTED_RULE}\n▸ claude\n${row}\n${DIM}${CAPTION}${RESET}`);
    expect(panelOf(liveView(freshClaude, { ineligible: ['claude-work'] }))).toBe(renderPanelOk(freshClaude, false, NOW, { ...PLAIN, age: ' · 0h0m ago' }));
  });

  it('keeps the plain rule and ends the tag at column 72 under NO_COLOR', () => {
    const row = renderWindowRow(WEEKLY, true, NOW);
    expect(panelOf(liveView(freshClaude, { selected: 0 }), true).split('\n')).toEqual(['='.repeat(72), `▸ claude${' '.repeat(53)}routing off`, row, CAPTION]);
    const stale = renderPanelOk({ ...freshClaude, snapshotAt: '2026-09-10T00:00:00.000Z' }, true, NOW, { selected: true, ineligible: true });
    expect(stale.split('\n').slice(0, 2)).toEqual(['='.repeat(72), `▸ claude${' '.repeat(53)}routing off`]);
    expect(panelOf(liveView(unavailableClaude), true).split('\n')[1]).toHaveLength(72);
  });

  it('shows the flash in place of the caption of the flashed panel only, in the caption style', () => {
    const kilo: ProviderUsage = { id: 'kilo', displayName: 'kilo', planLabel: 'api balance', windows: [], fetchedAt: NOW, status: 'ok' };
    const view: LiveView = { ...liveView(unavailableClaude), slots: [{ id: 'claude', usage: unavailableClaude }, { id: 'kilo', usage: kilo }], ineligible: [] };
    const message = 'not routable (no usage windows)';
    expect(panelOf({ ...view, flash: { index: 1, message } }).split('\n').slice(-2)).toEqual([' '.repeat(72), `${DIM}${message}${RESET}`]);
    expect(panelOf({ ...view, flash: { index: 0, message } })).toContain(`\n${DIM}${REASON}${RESET}\n${DIM}${message}${RESET}\n`);
    expect(panelOf({ ...view, flash: { index: 0, message } })).toContain(`${DIM}api balance · kilo · 0h0m ago${RESET}`);
  });

  it('appends the spinner frame of the tick after the name of a probing slot and keeps its windows and age caption', () => {
    const slot = (probing?: boolean) => ({ id: 'claude', usage: freshClaude, probing });
    const header = (extra: Partial<LiveView>, probing?: boolean) => panelOf({ ...liveView(freshClaude, { ineligible: [], ...extra }), slots: [slot(probing)] }, true).split('\n');
    expect(header({ spinner: 13 }, true)).toEqual(['='.repeat(72), 'claude ⠸', renderWindowRow(WEEKLY, true, NOW), 'claude · personal · claude · 0h0m ago']);
    expect(header({ spinner: 13 }, false)[1]).toBe('claude');
    expect(header({ spinner: 13 })[1]).toBe('claude');
    expect(header({ selected: 0 }, true)[1]).toBe('▸ claude ⠋');
    expect(header({ ineligible: ['claude'] }, true)[1]).toBe(`claude ⠋${' '.repeat(53)}routing off`);
    expect(panelOf({ ...liveView(freshClaude, { ineligible: [] }), slots: [slot(true)] }).split('\n')[1]).toBe('claude ⠋');
    expect(panelOf({ ...liveView(unavailableClaude), slots: [{ id: 'claude', usage: unavailableClaude, probing: true }], ineligible: [] }).split('\n')[1]).toBe(`${DIM}claude ⠋${RESET}`);
  });

  it('still shows the pending panel for a slot with no result even when it is probing', () => {
    const view = { ...liveView(undefined, { ineligible: [] }), slots: [{ id: 'claude', usage: undefined, probing: true }] };
    expect(panelOf(view, true).split('\n')).toEqual(['='.repeat(72), 'claude', '⠋ probing…']);
  });

  it('ends every settled caption with the age from its fetch time and cuts the caption to keep 72 cells', () => {
    const longName = 'x'.repeat(80);
    const old = { ...freshClaude, planLabel: longName, fetchedAt: '2026-09-11T09:00:00.000Z' };
    const caption = panelOf(liveView(old, { ineligible: [] }), true).split('\n').at(-1) ?? '';
    expect(caption.endsWith(' · 2d1h ago')).toBe(true);
    expect([...caption]).toHaveLength(72);
    expect(caption).toContain('…');
    expect(panelOf(liveView({ ...freshClaude, fetchedAt: '2026-09-13T09:57:00.000Z' }, { ineligible: [] }), true).split('\n').at(-1)).toBe('claude · personal · claude · 0h3m ago');
  });

  it('replaces the whole caption with the flash and adds no age to it', () => {
    const view = { ...liveView(freshClaude, { ineligible: [] }), flash: { index: 0, message: 'saved' } };
    expect(panelOf(view, true).split('\n').at(-1)).toBe('saved');
  });

  it('tags the ineligible panels of the once dashboard and nothing else', () => {
    const kilo: ProviderUsage = { id: 'kilo', displayName: 'kilo', planLabel: 'api balance', windows: [], fetchedAt: NOW, status: 'ok' };
    const lines = renderDashboard([freshClaude, unavailableClaude, kilo], true, NOW, ['kilo'], 'UTC').split('\n');
    expect(lines.filter((line) => line.includes('routing off'))).toEqual([`kilo${' '.repeat(57)}routing off`]);
    expect(renderDashboard([freshClaude, kilo], true, NOW, [], 'UTC')).not.toContain('▸');
  });
});

describe('route boxes', () => {
  const DIM = '\x1b[90m';
  const BOLD = '\x1b[1m';
  const LATER = '2026-09-16T10:00:00.000Z';
  const TOP = '+- route -------------------------+  +- route --high ------------------+';
  const BOTTOM = '+---------------------------------+  +---------------------------------+';
  const ok = (id: string, windows: UsageWindow[]): ProviderUsage => ({ id, displayName: id, planLabel: 'plan', windows, fetchedAt: NOW, status: 'ok' });
  const down = (id: string): ProviderUsage => ({ id, displayName: id, windows: [], fetchedAt: NOW, status: 'unavailable', reason: 'gone' });
  const boxView = (settled: ProviderUsage[] | undefined, extra: Partial<LiveView> = {}): LiveView => ({
    slots: [],
    spinner: 0,
    refreshing: false,
    footer: false,
    ineligible: [],
    zone: 'UTC',
    routes: { lines: LINES },
    settled,
    ...extra
  });
  const boxLines = (view: LiveView, noColor: boolean, now: string): string[] => renderLiveFrame(view, noColor, now).split('\n').slice(2, 6);
  const ROUTED: ProviderUsage[] = [
    ok('claude', [
      { label: 'session', kind: 'rolling', usedPct: 3, resetsAt: LATER },
      { label: 'weekly', kind: 'weekly', usedPct: 86, resetsAt: LATER },
      { label: 'weekly Fable', kind: 'weekly', usedPct: 100, resetsAt: LATER }
    ]),
    ok('claude-work', [
      { label: 'session', kind: 'rolling', usedPct: 0, resetsAt: LATER },
      { label: 'weekly', kind: 'weekly', usedPct: 12, resetsAt: LATER },
      { label: 'weekly Fable', kind: 'weekly', usedPct: 23, resetsAt: LATER }
    ]),
    ok('agy', [
      { label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: LATER },
      { label: '5h', kind: 'rolling', usedPct: 50, resetsAt: LATER }
    ]),
    ok('kimi', [
      { label: 'weekly', kind: 'weekly', usedPct: 85, resetsAt: LATER },
      { label: '5h', kind: 'rolling', usedPct: 85, resetsAt: LATER }
    ]),
    ok('grok', [{ label: 'credits', kind: 'weekly', usedPct: 90, resetsAt: LATER }]),
    ok('cursor', [{ label: 'total', kind: 'weekly', usedPct: 80, resetsAt: LATER }])
  ];

  it('draws the settled answers as two 35-cell boxes with a 2-cell gap under NO_COLOR', () => {
    const lines = boxLines(boxView(ROUTED), true, NOW);
    expect(lines).toEqual([
      TOP,
      `| ${'model-a high'.padEnd(31)} |  | ${'model-h1 max'.padEnd(31)} |`,
      '| claude-work                     |  | claude-work                     |',
      BOTTOM
    ]);
    expect(lines.every((line) => [...line].length === 72)).toBe(true);
  });

  it('colours the borders dim, the model line bold and the account row plain', () => {
    const lines = boxLines(boxView(ROUTED), false, NOW);
    expect(lines[0]).toBe(`${DIM}┌─ route ${'─'.repeat(25)}┐${RESET}  ${DIM}┌─ route --high ${'─'.repeat(18)}┐${RESET}`);
    expect(lines[1]).toBe(`${DIM}│${RESET}${BOLD} model-a high${' '.repeat(20)}${RESET}${DIM}│${RESET}  ${DIM}│${RESET}${BOLD} model-h1 max${' '.repeat(20)}${RESET}${DIM}│${RESET}`);
    expect(lines[2]).toBe(`${DIM}│${RESET} claude-work${' '.repeat(21)}${DIM}│${RESET}  ${DIM}│${RESET} claude-work${' '.repeat(21)}${DIM}│${RESET}`);
    expect(lines[3]).toBe(`${DIM}└${'─'.repeat(33)}┘${RESET}  ${DIM}└${'─'.repeat(33)}┘${RESET}`);
  });

  it('shows the spinner over an empty row until the first round settles', () => {
    expect(boxLines(boxView(undefined), true, NOW)).toEqual([
      TOP,
      `| ${'⠋ probing…'.padEnd(31)} |  | ${'⠋ probing…'.padEnd(31)} |`,
      `| ${''.padEnd(31)} |  | ${''.padEnd(31)} |`,
      BOTTOM
    ]);
    expect(boxLines(boxView(undefined, { spinner: 3 }), true, NOW)[1]).toContain('| ⠸ probing…');
    const coloured = boxLines(boxView(undefined), false, NOW);
    expect(coloured[1]).toBe(`${DIM}│ ⠋ probing…${' '.repeat(22)}│${RESET}  ${DIM}│ ⠋ probing…${' '.repeat(22)}│${RESET}`);
    expect(coloured[2]).toBe(`${DIM}│${' '.repeat(33)}│${RESET}  ${DIM}│${' '.repeat(33)}│${RESET}`);
  });

  it('shows the lines of the routes file it is given', () => {
    const route = { ...LINES.route, 'claude-work': { standard: 'model-b high', max: 'model-b max' } };
    const lines = boxLines(boxView(ROUTED, { routes: { lines: { route, high: { ...LINES.high, fable: 'model-h1 max' } } } }), true, NOW);
    expect(lines.slice(1, 3)).toEqual([
      `| ${'model-b high'.padEnd(31)} |  | ${'model-h1 max'.padEnd(31)} |`,
      `| ${'claude-work'.padEnd(31)} |  | ${'claude-work'.padEnd(31)} |`
    ]);
  });

  const WROK = { routes: { fault: { path: '/tmp/r/bad.json', problem: 'unknown key route.claude-wrok' } } };

  it('shows routes file error over what is wrong in both boxes once settled, as one dim span per row', () => {
    const lines = boxLines(boxView(ROUTED, WROK), true, NOW);
    expect(lines).toEqual([
      TOP,
      `| routes file error${' '.repeat(15)}|  | routes file error${' '.repeat(15)}|`,
      `| ${'unknown key route.claude-wrok'.padEnd(31)} |  | ${'unknown key route.claude-wrok'.padEnd(31)} |`,
      BOTTOM
    ]);
    const coloured = boxLines(boxView(ROUTED, WROK), false, NOW);
    expect(coloured[0]).toBe(`${DIM}┌─ route ${'─'.repeat(25)}┐${RESET}  ${DIM}┌─ route --high ${'─'.repeat(18)}┐${RESET}`);
    expect(coloured[1]).toBe(`${DIM}│ routes file error${' '.repeat(15)}│${RESET}  ${DIM}│ routes file error${' '.repeat(15)}│${RESET}`);
    expect(coloured[2]).toBe(`${DIM}│ unknown key route.claude-wrok${' '.repeat(3)}│${RESET}  ${DIM}│ unknown key route.claude-wrok${' '.repeat(3)}│${RESET}`);
    expect(coloured[3]).toBe(`${DIM}└${'─'.repeat(33)}┘${RESET}  ${DIM}└${'─'.repeat(33)}┘${RESET}`);
    expect(coloured.join('\n')).not.toContain(BOLD);
  });

  it('cuts a long routes file problem to the box and keeps the spinner until the first round settles', () => {
    const long = { routes: { fault: { path: '/r', problem: 'route.claude.max is not "<model>" or "<model> <effort>"' } } };
    expect(boxLines(boxView(ROUTED, long), true, NOW)[2]).toBe('| route.claude.max is not "<mode… |  | route.claude.max is not "<mode… |');
    expect(boxLines(boxView(undefined, long), true, NOW)[1]).toBe(`| ${'⠋ probing…'.padEnd(31)} |  | ${'⠋ probing…'.padEnd(31)} |`);
  });

  it('shows none over no subscription available as one dim span per row', () => {
    expect(boxLines(boxView([]), true, NOW)).toEqual([
      TOP,
      `| ${'none'.padEnd(31)} |  | ${'none'.padEnd(31)} |`,
      `| ${'no subscription available'.padEnd(31)} |  | ${'no subscription available'.padEnd(31)} |`,
      BOTTOM
    ]);
    const coloured = boxLines(boxView([]), false, NOW);
    expect(coloured[1]).toBe(`${DIM}│ none${' '.repeat(28)}│${RESET}  ${DIM}│ none${' '.repeat(28)}│${RESET}`);
    expect(coloured[2]).toBe(`${DIM}│ no subscription available${' '.repeat(7)}│${RESET}  ${DIM}│ no subscription available${' '.repeat(7)}│${RESET}`);
  });

  it('shows the route model line and account for a routable provider', () => {
    const kimi = ok('kimi', [{ label: 'weekly', kind: 'weekly', usedPct: 10 }]);
    expect(boxLines(boxView([kimi]), true, NOW)).toEqual([
      TOP,
      `| ${'model-d max'.padEnd(31)} |  | ${'none'.padEnd(31)} |`,
      `| ${'kimi'.padEnd(31)} |  | ${'no subscription available'.padEnd(31)} |`,
      BOTTOM
    ]);
  });

  it('The dashboard route boxes show the new lines', () => {
    const liveNow = '2026-09-14T12:39:00.000Z';
    const live = [
      ok('claude', [
        { label: 'session', kind: 'rolling', usedPct: 2 },
        { label: 'weekly', kind: 'weekly', usedPct: 13, resetsAt: '2026-09-19T22:39:00.000Z' },
        { label: 'weekly Fable', kind: 'weekly', usedPct: 2, resetsAt: '2026-09-19T22:39:00.000Z' }
      ]),
      ok('claude-work', [
        { label: 'session', kind: 'rolling', usedPct: 100, resetsAt: '2026-09-14T15:50:00.000Z' },
        { label: 'weekly', kind: 'weekly', usedPct: 72, resetsAt: '2026-09-14T18:00:00.000Z' },
        { label: 'weekly Fable', kind: 'weekly', usedPct: 52, resetsAt: '2026-09-14T17:59:00.000Z' }
      ]),
      ok('agy', [
        { label: 'Weekly Limit', kind: 'weekly', usedPct: 17, resetsAt: '2026-09-19T18:39:00.000Z' },
        { label: 'Five Hour Limit', kind: 'rolling', usedPct: 0 }
      ]),
      ok('kimi', [
        { label: 'weekly', kind: 'weekly', usedPct: 95, resetsAt: '2026-09-17T13:39:00.000Z' },
        { label: '5h', kind: 'rolling', usedPct: 0 }
      ]),
      ok('grok', [{ label: 'credits', kind: 'weekly', usedPct: 9, resetsAt: '2026-09-19T22:39:00.000Z' }]),
      ok('cursor', [
        { label: 'total', kind: 'weekly', usedPct: 36, resetsAt: '2026-09-29T17:39:00.000Z' },
        { label: 'auto', kind: 'weekly', usedPct: 36, resetsAt: '2026-09-29T17:39:00.000Z' },
        { label: 'api', kind: 'weekly', usedPct: 33, resetsAt: '2026-09-29T17:39:00.000Z' }
      ]),
      ok('junie', [{ label: 'credits', kind: 'weekly', usedPct: 30 }]),
      ok('hermes', [{ label: 'credits', kind: 'weekly', usedPct: 75, resetsAt: '2026-09-20T00:00:00.000Z' }])
    ];
    const lines = boxLines(boxView(live), true, liveNow);
    expect(lines[1]).toBe(`| ${'model-e xhigh'.padEnd(31)} |  | ${'model-h1 max'.padEnd(31)} |`);
    expect(lines[2]).toBe(`| ${'grok'.padEnd(31)} |  | ${'claude'.padEnd(31)} |`);
  });

  const weekly = (usedPct: number, resetsAt?: string): UsageWindow => ({ label: 'weekly', kind: 'weekly', usedPct, resetsAt });
  const cut31 = (text: string): string => ([...text].length > 31 ? `${[...text].slice(0, 30).join('').trimEnd()}…` : text);
  const rowText = (row: string, box: number): string => row.slice(box * 37 + 2, box * 37 + 33).trimEnd();
  const splitLine = (line: string): string[] => (line === 'none' ? ['none', 'no subscription available'] : [line.slice(0, line.lastIndexOf(' ')), line.slice(line.lastIndexOf(' ') + 1)]);

  it.each<[string, ProviderUsage[], string[], string, string]>([
    ['evaporation near local midnight', [ok('claude', [weekly(86, '2026-09-13T22:30:00.000Z')])], [], 'UTC', NOW],
    ['a zone whose midnight is earlier', [ok('claude', [weekly(86, '2026-09-13T22:30:00.000Z')])], [], 'Etc/GMT-2', NOW],
    ['a reset that just passed', [ok('claude', [weekly(86, '2026-09-13T22:30:00.000Z')])], [], 'UTC', '2026-09-13T22:30:01.000Z'],
    ['a headroom tie', [ok('claude', [weekly(10)]), ok('agy', [weekly(10)])], [], 'UTC', NOW],
    ['chain rank 1', ROUTED, [], 'UTC', NOW],
    ['chain rank 2', [ok('cursor', [weekly(10)])], [], 'UTC', NOW],
    ['chain rank 3', [ok('claude', [{ label: 'session', kind: 'rolling', usedPct: 10 }, { label: 'weekly Fable', kind: 'weekly', usedPct: 95 }])], [], 'UTC', NOW],
    ['chain rank 4', [ok('grok', [weekly(10)])], [], 'UTC', NOW],
    ['chain rank 5', [ok('agy', [weekly(10)])], [], 'UTC', NOW],
    ['no results at all', [], [], 'UTC', NOW],
    ['everything ineligible', [ok('claude', [weekly(10)])], ['claude'], 'UTC', NOW],
    ['unavailable results skipped', [down('claude'), ok('kimi', [weekly(10)])], [], 'UTC', NOW],
    ['a model line longer than 31 cells', [ok('kimi', [weekly(10)])], [], 'UTC', NOW],
    ['the named account toggled off', ROUTED, ['claude-work'], 'UTC', NOW]
  ])('boxes equal routeLine and highRouteLine split at the last space: %s', (_case, usages, ineligible, zone, now) => {
    const lines = boxLines(boxView(usages, { ineligible, zone }), true, now);
    const midnight = nextLocalMidnight(zone, now);
    const [route, high] = [routeLine(LINES, usages, now, midnight, ineligible), highRouteLine(LINES, usages, ineligible)].map(splitLine);
    expect([rowText(lines[1], 0), rowText(lines[2], 0)]).toEqual([cut31(route[0]), route[1]]);
    expect([rowText(lines[1], 1), rowText(lines[2], 1)]).toEqual([cut31(high[0]), high[1]]);
  });

  it('recomputes the cached midnight once the frame time passes it', () => {
    const view = boxView([ok('claude', [weekly(86, '2026-09-14T01:30:00.000Z')])], { zone: 'Etc/GMT-2' });
    expect(rowText(boxLines(view, true, '2026-09-13T21:00:00.000Z')[1], 0)).toBe('model-a high');
    expect(rowText(boxLines(view, true, '2026-09-13T21:30:00.000Z')[1], 0)).toBe('model-a high');
    expect(rowText(boxLines(view, true, '2026-09-13T23:00:00.000Z')[1], 0)).toBe('model-a max');
  });

  it('recomputes the cached midnight when the frame time moves backwards', () => {
    boxLines(boxView([ok('claude', [weekly(10)])]), true, '2026-09-14T23:00:00.000Z');
    const view = boxView([ok('claude', [weekly(86, '2026-09-14T10:00:00.000Z')])]);
    expect(rowText(boxLines(view, true, '2026-09-13T09:00:00.000Z')[1], 0)).toBe('model-a high');
  });

  it('computes the midnight once for repeated settled frames in the same zone and day', () => {
    const view = boxView(ROUTED, { zone: 'Etc/GMT-5' });
    boxLines(view, true, '2026-09-13T10:00:00.000Z');
    vi.mocked(nextLocalMidnight).mockClear();
    boxLines(view, true, '2026-09-13T10:30:00.000Z');
    boxLines(view, true, '2026-09-13T11:00:00.000Z');
    boxLines(view, true, '2026-09-13T12:00:00.000Z');
    expect(vi.mocked(nextLocalMidnight)).not.toHaveBeenCalled();
  });

  it('serves the cached midnight to a frame at the exact millisecond it was computed', () => {
    const view = boxView(ROUTED, { zone: 'Etc/GMT-6' });
    boxLines(view, true, '2026-09-13T10:00:00.000Z');
    vi.mocked(nextLocalMidnight).mockClear();
    boxLines(view, true, '2026-09-13T10:00:00.000Z');
    expect(vi.mocked(nextLocalMidnight)).not.toHaveBeenCalled();
  });

  it('recomputes the midnight for a frame landing exactly on it', () => {
    const view = boxView([ok('claude', [weekly(86, '2026-09-14T01:30:00.000Z')])], { zone: 'Etc/GMT-7' });
    expect(rowText(boxLines(view, true, '2026-09-13T16:00:00.000Z')[1], 0)).toBe('model-a high');
    vi.mocked(nextLocalMidnight).mockClear();
    const lines = boxLines(view, true, '2026-09-13T17:00:00.000Z');
    expect(vi.mocked(nextLocalMidnight)).toHaveBeenCalledTimes(1);
    expect(rowText(lines[1], 0)).toBe('model-a max');
  });

  it('never marks a box line as selected', () => {
    const lines = renderLiveFrame(boxView(ROUTED, { selected: 0, slots: [{ id: 'claude', usage: ROUTED[0] }] }), true, NOW).split('\n');
    expect(lines.slice(2, 6).join('\n')).not.toContain('▸');
    expect(lines[6]).toBe('='.repeat(72));
    expect(lines[7]).toBe('▸ claude');
  });

  it('never draws the boxes in the once dashboard', () => {
    expect(renderDashboard(ROUTED, true, NOW, [], 'UTC')).not.toContain('+- route');
    expect(renderDashboard(ROUTED, false, NOW, [], 'UTC')).not.toContain('┌─ route');
  });
});

describe('style balance', () => {
  const closed = (line: string): boolean => {
    const last = line.lastIndexOf('\x1b[');
    return last < 0 || line.startsWith('0m', last + 2);
  };
  const okOf = (id: string, snapshotAt?: string): ProviderUsage => ({
    id,
    displayName: id,
    windows: [{ label: 'credits', kind: 'weekly', usedPct: 60, resetsAt: '2026-09-13T21:15:36.133Z' }],
    fetchedAt: NOW,
    status: 'ok',
    snapshotAt
  });
  const mixed: ProviderUsage[] = [
    okOf('claude'),
    okOf('grok', '2026-09-10T17:14:22.812Z'),
    okOf('junie', '2026-09-13T09:00:00.000Z'),
    { id: 'hermes', displayName: 'hermes', windows: [], fetchedAt: NOW, status: 'unavailable', reason: 'token expired' },
    { id: 'kilo', displayName: 'kilo', windows: [], fetchedAt: NOW, status: 'error', reason: 'boom' }
  ];
  const dimJunie: ProviderUsage[] = [okOf('claude'), okOf('junie', '2026-09-10T17:14:22.812Z')];
  const liveViewOf = (usages: ProviderUsage[], rows: number): LiveView => ({
    slots: [...usages.map((usage) => ({ id: usage.id, usage })), { id: 'pending', usage: undefined }],
    spinner: 0,
    refreshing: false,
    footer: true,
    ineligible: ['hermes'],
    zone: 'UTC',
    routes: { lines: LINES },
    settled: usages,
    selected: -1,
    rows
  });

  it('closes every styled line of the once dashboard', () => {
    const lines = renderDashboard(mixed, false, NOW, ['kilo'], 'UTC').split('\n');
    expect(lines.filter((line) => line.includes('\x1b['))).not.toHaveLength(0);
    expect(lines.every(closed)).toBe(true);
    expect(lines.filter((line) => line.includes('token expired') || line.includes('stale'))).toSatisfy((dimmed: string[]) =>
      dimmed.every((line) => line.startsWith('\x1b[90m') && line.endsWith(RESET))
    );
  });

  it.each([60, 12, 8, 7, 6])('closes every styled line of a live frame with %i rows', (rows) => {
    const lines = renderLiveFrame(liveViewOf(mixed, rows), false, NOW).split('\n');
    expect(lines.every(closed)).toBe(true);
  });

  it('closes a dim junie panel cut after its rule and header', () => {
    const full = renderLiveFrame(liveViewOf(dimJunie, 60), false, NOW).split('\n');
    const rows = full.findIndex((line) => line.includes('junie')) + 1;
    const lines = renderLiveFrame({ ...liveViewOf(dimJunie, rows), footer: false }, false, NOW).split('\n');
    expect(lines.at(-1)).toBe(`\x1b[90mjunie${RESET}`);
    expect(lines.at(-2)).toBe(`\x1b[90m${'━'.repeat(72)}${RESET}`);
    expect(lines.every(closed)).toBe(true);
  });

  it('leaves NO_COLOR output free of escapes', () => {
    expect(renderDashboard(mixed, true, NOW, [], 'UTC')).not.toContain('\x1b');
    expect(renderLiveFrame(liveViewOf(mixed, 12), true, NOW)).not.toContain('\x1b');
  });
});

const GRAPH_NOW = '2026-09-30T12:00:00.000Z';

function graphSlot(label: string): number {
  return label === 'session' ? 1 : 0;
}

function graphSample(label: string, usedPct: number, at: string): HistorySample {
  return { id: 'claude', slot: graphSlot(label), label, usedPct, at };
}

const GRAPH_SAMPLES = [
  graphSample('weekly', 10, '2026-09-30T00:00:00.000Z'),
  graphSample('weekly', 90, '2026-09-30T06:00:00.000Z'),
  graphSample('weekly', 5, '2026-09-30T09:00:00.000Z'),
  graphSample('session', 50, '2026-09-30T00:00:00.000Z')
];

function graphView(samples: HistorySample[], rows = 24, zone = 'UTC'): LiveView {
  return { slots: [], spinner: 0, refreshing: false, footer: false, ineligible: [], zone, routes: { lines: LINES }, rows, graph: { id: 'claude', samples, usage: undefined } };
}

function renderHistoryView(view: LiveView, noColor: boolean): string {
  return renderLiveFrame(view, noColor, GRAPH_NOW);
}

describe('usage graph', () => {
  it('draws one chart per window with its latest value, reset marks and a local time axis', () => {
    const lines = renderHistoryView(graphView(GRAPH_SAMPLES), true).split('\n');
    expect(lines[0]).toBe('claude · usage over time · last 12h0m');
    expect(lines.filter((line) => line === 'weekly  5%' || line === 'session  50%')).toHaveLength(2);
    expect(lines.filter((line) => /^ +v +$/.test(line))).toHaveLength(1);
    expect(lines.at(-2)).toBe(`     09-30 00:00${' '.repeat(72 - 5 - 11 - 11)}09-30 12:00`);
    expect(lines.at(-1)).toBe('v usage dropped (reset) · esc/q/g back');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
    expect(lines.join('')).not.toMatch(/[▀-▟]/);
    expect(lines.join('')).not.toContain('\x1b');
  });

  it('uses block characters and colour outside NO_COLOR', () => {
    const text = renderHistoryView(graphView(GRAPH_SAMPLES), false);
    expect(text).toContain('█');
    expect(text).toContain('↓');
    expect(text).toContain('\x1b[');
  });

  it('labels the axis in the given zone', () => {
    const lines = renderHistoryView(graphView(GRAPH_SAMPLES, 24, 'Asia/Tokyo'), true).split('\n');
    expect(lines.at(-2)).toMatch(/^ {5}09-30 09:00 +09-30 21:00$/);
  });

  it('fits the row budget', () => {
    for (const rows of [1, 2, 3, 5, 8, 12, 40]) {
      expect(renderHistoryView(graphView(GRAPH_SAMPLES, rows), true).split('\n').length).toBeLessThanOrEqual(rows);
    }
    const tall = renderHistoryView(graphView(GRAPH_SAMPLES, 200), true).split('\n');
    expect(tall.length).toBeLessThan(30);
  });

  it('shows partial cells for in-between values and a flat line for one sample', () => {
    const lines = renderHistoryView(graphView([graphSample('w', 50, GRAPH_NOW), graphSample('w', 12, GRAPH_NOW)], 10), false).split('\n');
    expect(lines.join('\n')).toMatch(/[▁-▇]/);
    expect(renderHistoryView(graphView([graphSample('w', 150, GRAPH_NOW)], 10), false)).toContain('█');
    expect(renderHistoryView(graphView([graphSample('w', 0, GRAPH_NOW)], 10), false)).not.toContain('█');
  });

  it('uses the arrow in the legend outside NO_COLOR', () => {
    expect(renderHistoryView(graphView(GRAPH_SAMPLES), false).split('\n').at(-1)).toContain('↓ usage dropped (reset) · esc/q/g back');
  });

  it('says how long the history spans in days once it is longer than a day', () => {
    const lines = renderHistoryView(graphView([graphSample('w', 1, '2026-09-27T09:00:00.000Z'), graphSample('w', 2, GRAPH_NOW)]), true).split('\n');
    expect(lines[0]).toBe('claude · usage over time · last 3d3h');
  });

  it('charts windows that share a label separately and marks no reset between them', () => {
    const twin = (slot: number, usedPct: number, at: string): HistorySample => ({ id: 'kimi', slot, label: '5h', usedPct, at });
    const samples = [twin(0, 80, '2026-09-30T00:00:00.000Z'), twin(1, 10, '2026-09-30T00:00:00.000Z'), twin(0, 85, '2026-09-30T06:00:00.000Z'), twin(1, 20, '2026-09-30T06:00:00.000Z')];
    const lines = renderHistoryView(graphView(samples), true).split('\n');
    expect(lines.filter((line) => line.startsWith('5h  '))).toEqual(['5h  85%', '5h  20%']);
    expect(lines.filter((line) => /^ +v +$/.test(line))).toHaveLength(0);
  });

  it('tells how many windows were cut off on a short terminal instead of dropping them silently', () => {
    const many = Array.from({ length: 5 }, (_, slot) => ({ id: 'agy', slot, label: `w${slot}`, usedPct: slot, at: GRAPH_NOW }));
    const lines = renderHistoryView(graphView(many, 12), true).split('\n');
    expect(lines).toHaveLength(10);
    expect(lines.filter((line) => /^w\d /.test(line))).toHaveLength(2);
    expect(lines.at(-3)).toBe('… 3 more windows (enlarge the terminal)');
    expect(renderHistoryView(graphView(many, 9), true).split('\n').filter((line) => line.includes('more window'))).toEqual(['… 4 more windows (enlarge the terminal)']);
    expect(renderHistoryView(graphView(many.slice(0, 2), 8), true)).toContain('… 1 more window (enlarge the terminal)');
    expect(renderHistoryView(graphView(many, 30), true)).not.toContain('more window');
  });

  const graphUsage = (windows: UsageWindow[]): ProviderUsage => ({ id: 'claude', displayName: 'claude', status: 'ok', windows, fetchedAt: GRAPH_NOW });

  it.each<[string, ProviderUsage | undefined, string]>([
    ['probing', undefined, 'no samples yet · provider still probing'],
    ['unavailable', { id: 'claude', displayName: 'claude', status: 'unavailable' as const, reason: 'no cli', windows: [], fetchedAt: GRAPH_NOW }, 'no samples · provider unavailable'],
    ['without windows', graphUsage([]), 'no usage windows to chart'],
    ['waiting for a round', graphUsage([{ label: 'w', kind: 'weekly', usedPct: 1 }]), 'no history yet · samples are recorded after each refresh round']
  ])('gives the empty graph a reason when the provider is %s', (_name, usage, reason) => {
    expect(renderHistoryView({ ...graphView([]), graph: { id: 'claude', samples: [], usage } }, true).split('\n')).toEqual(['claude · usage over time', reason, 'v usage dropped (reset) · esc/q/g back']);
  });
});

const PANELS = ['a1\na2\na3', 'b1\nb2\nb3', 'c1\nc2\nc3', 'd1\nd2\nd3'];

describe('viewportLines', () => {
  it('shows every line from the top when they fit, whatever is selected', () => {
    const all = PANELS.flatMap((panel) => panel.split('\n'));
    expect(viewportLines(PANELS, 3, 12)).toEqual(all);
    expect(viewportLines(PANELS, 3, 20)).toEqual(all);
    expect(viewportLines(PANELS, 0, 12)).toEqual(all);
  });

  it('cuts from the top without a selection', () => {
    expect(viewportLines(PANELS, undefined, 5)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
    expect(viewportLines(PANELS, -1, 5)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
    expect(viewportLines(PANELS, 4, 5)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
  });

  it('keeps the first panel at the top while the selected one still fits below it', () => {
    expect(viewportLines(PANELS, 0, 6)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
    expect(viewportLines(PANELS, 1, 6)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
  });

  it('scrolls down just far enough to show the whole selected panel', () => {
    expect(viewportLines(PANELS, 2, 6)).toEqual(['b1', 'b2', 'b3', 'c1', 'c2', 'c3']);
    expect(viewportLines(PANELS, 3, 5)).toEqual(['c2', 'c3', 'd1', 'd2', 'd3']);
    expect(viewportLines(PANELS, 3, 3)).toEqual(['d1', 'd2', 'd3']);
  });

  it('starts at the header when the selected panel is taller than the region', () => {
    expect(viewportLines(PANELS, 1, 2)).toEqual(['b2', 'b3']);
    expect(viewportLines(PANELS, 2, 1)).toEqual(['c2']);
    expect(viewportLines(PANELS, 0, 0)).toEqual([]);
  });
});

describe('pace warning', () => {
  const risky: ProviderUsage = {
    id: 'kimi',
    displayName: 'kimi',
    planLabel: 'kimi code',
    windows: [{ label: '5h', kind: 'rolling', usedPct: 60, resetsAt: '2026-09-13T13:00:00Z' }],
    fetchedAt: 'now',
    status: 'ok'
  };
  const safe: ProviderUsage = { ...risky, windows: [{ label: '5h', kind: 'rolling', usedPct: 30, resetsAt: '2026-09-13T13:00:00Z' }] };
  const WARNING = '  → 100% in ~1h20m (before reset)';

  it('adds a dim line under the at-risk row', () => {
    expect(renderPanelOk(risky as Extract<ProviderUsage, { status: 'ok' }>, true, NOW, PLAIN).split('\n')[3]).toBe(WARNING);
    expect(renderPanelOk(risky as Extract<ProviderUsage, { status: 'ok' }>, false, NOW, PLAIN).split('\n')[3]).toBe(`\x1b[90m${WARNING}${RESET}`);
  });

  it('leaves panels without an at-risk window at their old height', () => {
    expect(renderPanelOk(safe as Extract<ProviderUsage, { status: 'ok' }>, true, NOW, PLAIN).split('\n')).toHaveLength(4);
  });
});
