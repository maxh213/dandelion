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
  renderLiveFrame,
  styleToken,
  STYLE_TOKENS,
  type LiveView,
  type PanelMarks
} from './terminal.ts';
import { highRouteLine, nextLocalMidnight, routeLine, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const RESET = '\x1b[0m';
const PLAIN: PanelMarks = { selected: false, ineligible: false };

describe('terminal renderer', () => {
  it('renders banner', () => {
    const banner = renderBanner('2026-09-13T10:00:00.000Z', true);
    expect(banner).toContain('DANDELION');
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
      `\x1b[90m${'━'.repeat(72)}\ngrok\n${'credits'.padEnd(35)} ${'█'.repeat(19)}░  96%\nstale snapshot 2d16h old\ngrok · grok${RESET}`
    );
    expect(renderPanelOk({ ...usage, windows: [] }, true, NOW, PLAIN).split('\n')[2]).toBe(' '.repeat(72));
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
    const dash = renderDashboard(usages, true, '2026-09-13T10:00:00.000Z', []);
    expect(dash).toContain('DANDELION');
    expect(dash).toContain('##############------');
    expect(dash).toContain('other\nProbe crashed');

    const dashColor = renderDashboard(usages, false, '2026-09-13T10:00:00.000Z', []);
    expect(dashColor).toContain('\x1b[90m');
  });

  it('rejects a provider status it does not know', () => {
    const usage = { id: 'x', displayName: 'x', windows: [], fetchedAt: 'now', status: 'bogus' } as unknown as ProviderUsage;
    expect(() => renderDashboard([usage], true, '2026-09-13T10:00:00.000Z', [])).toThrow('Unexpected provider status');
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
  const okUsage = (id: string, windows: UsageWindow[], extra: Partial<ProviderUsage> = {}): ProviderUsage =>
    ({ id, displayName: id, planLabel: 'plan', windows, fetchedAt: NOW, status: 'ok', ...extra }) as ProviderUsage;
  const unavailable = (id: string): ProviderUsage => ({ id, displayName: id, windows: [], fetchedAt: NOW, status: 'unavailable', reason: `${id} CLI not found in PATH` });
  const viewOf = (usages: (ProviderUsage | undefined)[], extra: Partial<LiveView> = {}): LiveView => ({
    slots: usages.map((usage, index) => ({ id: usage?.id ?? `p${index}`, usage })),
    spinner: 0,
    refreshing: false,
    footer: false,
    ineligible: [],
    zone: 'UTC',
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

  it('shows only the clock in the banner while nothing has settled', () => {
    const frame = renderLiveFrame(viewOf([undefined]), true, NOW).split('\n');
    expect(frame[0]).toBe(renderBanner(NOW, true));
  });

  it('shows the age of the oldest on-screen result in the banner', () => {
    const usages = [okUsage('claude', [], { fetchedAt: NOW }), okUsage('agy', [], { fetchedAt: '2026-09-13T09:58:00.000Z' }), okUsage('kilo', [], { fetchedAt: '2026-09-13T09:59:00.000Z' })];
    const frame = renderLiveFrame(viewOf([...usages, undefined]), true, '2026-09-13T10:00:30.000Z').split('\n');
    expect(frame[0]).toBe('DANDELION'.padEnd(47) + 'data 0h2m old · 10:00:30Z');
  });

  it('renders a pending panel as the rule, the id and the spinner frame for the tick', () => {
    const plain = renderLiveFrame(viewOf([undefined], { spinner: 11 }), true, NOW).split('\n').slice(6);
    expect(plain).toEqual(['='.repeat(72), 'p0', '⠙ probing…']);
    const coloured = renderLiveFrame({ ...viewOf([]), slots: [{ id: 'kimi', usage: undefined }] }, false, NOW);
    expect(coloured.split('\n').slice(6).join('\n')).toBe(`\x1b[90m${'━'.repeat(72)}\nkimi\n⠋ probing…${RESET}`);
    expect([...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'].map((frame, spinner) => renderLiveFrame(viewOf([undefined], { spinner }), true, NOW).endsWith(`${frame} probing…`))).toEqual(Array(10).fill(true));
  });

  it('colours the refreshing banner in spans, the summary and the footer dim, and panels as in once mode', () => {
    const frameNow = '2026-09-13T10:01:05.000Z';
    const lines = renderLiveFrame(viewOf(background(), { refreshing: true, footer: true }), false, frameNow).split('\n');
    expect(lines[0]).toBe(`\x1b[1mDANDELION${' '.repeat(24)}${RESET}\x1b[90mrefreshing…${RESET}\x1b[1m · data 0h1m old · 10:01:05Z${RESET}`);
    expect(lines[1]).toBe(`\x1b[90m2/13 windows above 80% · next reset: claude session in 8h38m${RESET}`);
    expect(lines.at(-1)).toBe(`\x1b[90mkeys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help${RESET}`);
    expect(lines.slice(6, -1).join('\n')).toBe(renderDashboard(background(), false, frameNow, []).split('\n').slice(1).join('\n'));
  });

  it('renders the refreshing banner and footer as plain text under NO_COLOR within 72 cells', () => {
    const lines = renderLiveFrame(viewOf(background(), { refreshing: true, footer: true }), true, '2026-09-13T10:01:05.000Z').split('\n');
    expect(lines[0]).toBe('DANDELION'.padEnd(33) + 'refreshing… · data 0h1m old · 10:01:05Z');
    expect(lines.at(-1)).toBe('keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });
});

describe('panel marks', () => {
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[90m';
  const REASON = 'claude CLI not found in PATH';
  const CAPTION = 'claude · personal · claude';
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
    ...extra
  });
  const panelOf = (view: LiveView, noColor = false) => renderLiveFrame(view, noColor, NOW).split('\n').slice(6).join('\n');

  it.each<[string, ProviderUsage | undefined, number | undefined, string]>([
    ['unavailable, not selected', unavailableClaude, undefined, `${DIM}${'━'.repeat(72)}\nclaude${' '.repeat(55)}routing off\n${REASON}\n${CAPTION}${RESET}`],
    ['unavailable, selected', unavailableClaude, 0, `${BOLD}${'━'.repeat(72)}${RESET}\n${DIM}▸ claude${' '.repeat(53)}routing off\n${REASON}\n${CAPTION}${RESET}`],
    ['pending, not selected', undefined, undefined, `${DIM}${'━'.repeat(72)}\nclaude${' '.repeat(55)}routing off\n⠋ probing…${RESET}`],
    ['pending, selected', undefined, 0, `${BOLD}${'━'.repeat(72)}${RESET}\n${DIM}▸ claude${' '.repeat(53)}routing off\n⠋ probing…${RESET}`]
  ])('keeps the tag inside the dim span of an all-dim panel: %s', (_case, usage, selected, bytes) => {
    expect(panelOf(liveView(usage, { selected }))).toBe(bytes);
  });

  it('dims the tag on its own and bolds the selected rule of a fresh panel', () => {
    const row = renderWindowRow(WEEKLY, false, NOW);
    expect(panelOf(liveView(freshClaude, { selected: 0 }))).toBe(
      [`${BOLD}${'━'.repeat(72)}${RESET}`, `▸ claude${' '.repeat(53)}${DIM}routing off${RESET}`, row, `${DIM}${CAPTION}${RESET}`].join('\n')
    );
    expect(panelOf(liveView(freshClaude, { ineligible: [], selected: 0 }))).toBe(`${BOLD}${'━'.repeat(72)}${RESET}\n▸ claude\n${row}\n${DIM}${CAPTION}${RESET}`);
    expect(panelOf(liveView(freshClaude, { ineligible: ['claude-work'] }))).toBe(renderPanelOk(freshClaude, false, NOW, PLAIN));
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
    expect(panelOf({ ...view, flash: { index: 0, message } })).toContain(`\n${REASON}\n${message}${RESET}\n`);
    expect(panelOf({ ...view, flash: { index: 0, message } })).toContain(`${DIM}api balance · kilo${RESET}`);
  });

  it('tags the ineligible panels of the once dashboard and nothing else', () => {
    const kilo: ProviderUsage = { id: 'kilo', displayName: 'kilo', planLabel: 'api balance', windows: [], fetchedAt: NOW, status: 'ok' };
    const lines = renderDashboard([freshClaude, unavailableClaude, kilo], true, NOW, ['kilo']).split('\n');
    expect(lines.filter((line) => line.includes('routing off'))).toEqual([`kilo${' '.repeat(57)}routing off`]);
    expect(renderDashboard([freshClaude, kilo], true, NOW, [])).not.toContain('▸');
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
      '| claude-opus-5 high              |  | claude-fable-5-1 max            |',
      '| claude-work                     |  | claude-work                     |',
      BOTTOM
    ]);
    expect(lines.every((line) => [...line].length === 72)).toBe(true);
  });

  it('colours the borders dim, the model line bold and the account row plain', () => {
    const lines = boxLines(boxView(ROUTED), false, NOW);
    expect(lines[0]).toBe(`${DIM}┌─ route ${'─'.repeat(25)}┐${RESET}  ${DIM}┌─ route --high ${'─'.repeat(18)}┐${RESET}`);
    expect(lines[1]).toBe(`${DIM}│${RESET}${BOLD} claude-opus-5 high${' '.repeat(14)}${RESET}${DIM}│${RESET}  ${DIM}│${RESET}${BOLD} claude-fable-5-1 max${' '.repeat(12)}${RESET}${DIM}│${RESET}`);
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

  it('cuts a long model line with an ellipsis like a window label', () => {
    const kimi = ok('kimi', [{ label: 'weekly', kind: 'weekly', usedPct: 10 }]);
    expect(boxLines(boxView([kimi]), true, NOW)).toEqual([
      TOP,
      `| kimi-code/kimi-for-coding-high… |  | ${'none'.padEnd(31)} |`,
      `| ${'kimi'.padEnd(31)} |  | ${'no subscription available'.padEnd(31)} |`,
      BOTTOM
    ]);
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
    const [route, high] = [routeLine(usages, now, midnight, ineligible), highRouteLine(usages, ineligible)].map(splitLine);
    expect([rowText(lines[1], 0), rowText(lines[2], 0)]).toEqual([cut31(route[0]), route[1]]);
    expect([rowText(lines[1], 1), rowText(lines[2], 1)]).toEqual([cut31(high[0]), high[1]]);
  });

  it('never marks a box line as selected', () => {
    const lines = renderLiveFrame(boxView(ROUTED, { selected: 0, slots: [{ id: 'claude', usage: ROUTED[0] }] }), true, NOW).split('\n');
    expect(lines.slice(2, 6).join('\n')).not.toContain('▸');
    expect(lines[7]).toBe('▸ claude');
  });

  it('never draws the boxes in the once dashboard', () => {
    expect(renderDashboard(ROUTED, true, NOW, [])).not.toContain('+- route');
    expect(renderDashboard(ROUTED, false, NOW, [])).not.toContain('┌─ route');
  });
});
