import {
  HOT_PCT,
  formatCountdown,
  summariseFleet,
  type Balance,
  type FleetReset,
  type FleetSummary,
  type ProviderUsage,
  type UsageWindow
} from '../domain/index.ts';

const WIDTH = 72;
const GAUGE_CELLS = 20;
const LABEL_CELLS = 35;
const PERCENT_CELLS = 4;
const BOLD = '\x1b[1m';
const DIM = '\x1b[90m';
const RESET = '\x1b[0m';
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const TITLE = 'ALLOWANCE';
const SPINNER_FRAMES = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];
const REFRESHING = 'refreshing…';
const HELP_FOOTER = 'keys: r refresh · q quit · ? help';

function styled(text: string, code: string, noColor: boolean): string {
  if (noColor) return text;
  return `${code}${text}${RESET}`;
}

function dim(text: string, noColor: boolean): string {
  return styled(text, DIM, noColor);
}

function repeatChar(char: string, count: number): string {
  return char.repeat(Math.max(0, count));
}

function clockTime(instant: string): string {
  return `${instant.slice(11, 19)}Z`;
}

function cellCount(text: string): number {
  return [...text].length;
}

function bannerGap(right: string): string {
  return repeatChar(' ', WIDTH - TITLE.length - cellCount(right));
}

function bannerLine(right: string, noColor: boolean): string {
  return styled(`${TITLE}${bannerGap(right)}${right}`, BOLD, noColor);
}

export function renderBanner(instant: string, noColor: boolean): string {
  return bannerLine(clockTime(instant), noColor);
}

function plainRule(noColor: boolean): string {
  return repeatChar(noColor ? '=' : '━', WIDTH);
}

export function renderRule(noColor: boolean): string {
  return dim(plainRule(noColor), noColor);
}

function gaugeCells(filledCells: number, noColor: boolean): string {
  const [fillChar, emptyChar] = noColor ? ['#', '-'] : ['█', '░'];
  return repeatChar(fillChar, filledCells) + repeatChar(emptyChar, GAUGE_CELLS - filledCells);
}

export function renderGauge(amount: number, reference: number, noColor: boolean): string {
  const filledCells = Math.min(GAUGE_CELLS, Math.round((amount / reference) * GAUGE_CELLS));
  return gaugeCells(filledCells, noColor);
}

export function renderEmptyGauge(noColor: boolean): string {
  return gaugeCells(0, noColor);
}

export const STYLE_TOKENS = {
  calm: '\x1b[32m',
  warm: '\x1b[33m',
  hot: '\x1b[31m',
  critical: '\x1b[35m'
} as const;

type StyleToken = keyof typeof STYLE_TOKENS;

const RAMP: [number, StyleToken][] = [
  [95, 'critical'],
  [HOT_PCT, 'hot'],
  [50, 'warm']
];

export function styleToken(usedPct: number): StyleToken {
  return RAMP.find(([threshold]) => usedPct >= threshold)?.[1] ?? 'calm';
}

function cutCells(text: string, limit: number): string {
  const cells = [...text];
  return cells.length > limit ? `${cells.slice(0, limit - 1).join('').trimEnd()}…` : text;
}

function fitLabel(label: string): string {
  return cutCells(label, LABEL_CELLS).padEnd(LABEL_CELLS);
}

function countdown(resetsAt: string | undefined, now: string): string {
  return resetsAt === undefined ? '' : ` ↻ ${formatCountdown(resetsAt, now)}`;
}

function rowWith(window: UsageWindow, noColor: boolean, now: string, paint: (text: string) => string): string {
  const gauge = paint(renderGauge(window.usedPct, 100, noColor));
  const percent = paint(`${window.usedPct}%`.padStart(PERCENT_CELLS));
  return `${fitLabel(window.label)} ${gauge} ${percent}${countdown(window.resetsAt, now)}`;
}

export function renderWindowRow(window: UsageWindow, noColor: boolean, now: string): string {
  const style = STYLE_TOKENS[styleToken(window.usedPct)];
  return rowWith(window, noColor, now, (text) => styled(text, style, noColor));
}

function balanceGauge(balance: Balance, noColor: boolean): string {
  if (balance.reference === undefined) return renderEmptyGauge(noColor);
  return renderGauge(balance.amount, balance.reference, noColor);
}

function balanceLine(balance: Balance | undefined, noColor: boolean): string {
  if (!balance) return ' '.repeat(WIDTH);
  const amount = `${balance.currency}${balance.amount.toFixed(2)}`;
  return `${amount} ${balanceGauge(balance, noColor)}`.padEnd(WIDTH);
}

function caption(usage: ProviderUsage): string {
  if (usage.planLabel === undefined) return usage.displayName;
  return `${usage.planLabel} · ${usage.displayName}`;
}

type OkUsage = Extract<ProviderUsage, { status: 'ok' }>;
type FailedUsage = Exclude<ProviderUsage, OkUsage>;

function panelBody(usage: OkUsage, noColor: boolean, row: (window: UsageWindow) => string): string[] {
  if (usage.windows.length === 0) return [usage.note ?? balanceLine(usage.balance, noColor)];
  return usage.windows.map(row);
}

function isStale(snapshotAt: string | undefined, now: string): boolean {
  return Date.parse(now) - new Date(snapshotAt ?? Number.NaN).getTime() > STALE_AFTER_MS;
}

function snapshotLine(snapshotAt: string, now: string): string {
  const age = `snapshot ${formatCountdown(now, snapshotAt)} old`;
  return isStale(snapshotAt, now) ? `stale ${age}` : age;
}

function snapshotLines(usage: OkUsage, now: string): string[] {
  return usage.snapshotAt === undefined ? [] : [snapshotLine(usage.snapshotAt, now)];
}

function renderPanelStale(usage: OkUsage, noColor: boolean, now: string): string {
  const rows = panelBody(usage, noColor, (window) => rowWith(window, noColor, now, String));
  return dim([plainRule(noColor), usage.displayName, ...rows, ...snapshotLines(usage, now), caption(usage)].join('\n'), noColor);
}

function renderPanelFresh(usage: OkUsage, noColor: boolean, now: string): string {
  return [
    renderRule(noColor),
    usage.displayName,
    ...panelBody(usage, noColor, (window) => renderWindowRow(window, noColor, now)),
    ...snapshotLines(usage, now).map((line) => dim(line, noColor)),
    dim(caption(usage), noColor)
  ].join('\n');
}

export function renderPanelOk(usage: OkUsage, noColor: boolean, now: string): string {
  return isStale(usage.snapshotAt, now) ? renderPanelStale(usage, noColor, now) : renderPanelFresh(usage, noColor, now);
}

export function renderPanelUnavailable(usage: FailedUsage, noColor: boolean): string {
  return dim([plainRule(noColor), usage.displayName, usage.reason, caption(usage)].join('\n'), noColor);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected provider status: ${JSON.stringify(value)}`);
}

function renderPanel(usage: ProviderUsage, noColor: boolean, now: string): string {
  switch (usage.status) {
    case 'ok':
      return renderPanelOk(usage, noColor, now);
    case 'unavailable':
    case 'error':
      return renderPanelUnavailable(usage, noColor);
    default:
      return assertNever(usage);
  }
}

export function renderDashboard(usages: ProviderUsage[], noColor: boolean, now: string): string {
  const panels = usages.map((usage) => renderPanel(usage, noColor, now));
  return [renderBanner(now, noColor), ...panels].join('\n');
}

export type LiveSlot = { id: string; usage: ProviderUsage | undefined };

export type LiveView = { slots: LiveSlot[]; spinner: number; refreshing: boolean; footer: boolean };

function settledUsages(slots: LiveSlot[]): ProviderUsage[] {
  return slots.flatMap((slot) => (slot.usage === undefined ? [] : [slot.usage]));
}

function dataAge(usages: ProviderUsage[], now: string): string {
  const oldest = usages.map((usage) => usage.fetchedAt).sort((a, b) => a.localeCompare(b))[0];
  return oldest === undefined ? '' : `data ${formatCountdown(now, oldest)} old · `;
}

function refreshingBanner(tail: string, noColor: boolean): string {
  const rest = ` · ${tail}`;
  const lead = TITLE + bannerGap(REFRESHING + rest);
  return styled(lead, BOLD, noColor) + dim(REFRESHING, noColor) + styled(rest, BOLD, noColor);
}

function liveBanner(view: LiveView, usages: ProviderUsage[], noColor: boolean, now: string): string {
  const tail = `${dataAge(usages, now)}${clockTime(now)}`;
  return view.refreshing ? refreshingBanner(tail, noColor) : bannerLine(tail, noColor);
}

function hotSegment({ hot, windows }: FleetSummary): string {
  return hot === 0 ? `all windows below ${HOT_PCT}%` : `${hot}/${windows} windows above ${HOT_PCT}%`;
}

function resetSegment(head: string, next: FleetReset, now: string): string {
  const prefix = `${head}${next.id} `;
  const suffix = ` in ${formatCountdown(next.resetsAt, now)}`;
  return `${prefix}${cutCells(next.label, WIDTH - cellCount(prefix) - cellCount(suffix))}${suffix}`;
}

function summaryLine(usages: ProviderUsage[], now: string): string {
  const fleet = summariseFleet(usages, now);
  const head = `${hotSegment(fleet)} · next reset: `;
  return fleet.next === undefined ? `${head}none` : resetSegment(head, fleet.next, now);
}

function pendingPanel(id: string, spinner: number, noColor: boolean): string {
  const frame = SPINNER_FRAMES[spinner % SPINNER_FRAMES.length];
  return dim([plainRule(noColor), id, `${frame} probing…`].join('\n'), noColor);
}

function livePanel(slot: LiveSlot, spinner: number, noColor: boolean, now: string): string {
  return slot.usage === undefined ? pendingPanel(slot.id, spinner, noColor) : renderPanel(slot.usage, noColor, now);
}

export function renderLiveFrame(view: LiveView, noColor: boolean, now: string): string {
  const usages = settledUsages(view.slots);
  const panels = view.slots.map((slot) => livePanel(slot, view.spinner, noColor, now));
  const footer = view.footer ? [dim(HELP_FOOTER, noColor)] : [];
  return [liveBanner(view, usages, noColor, now), dim(summaryLine(usages, now), noColor), ...panels, ...footer].join('\n');
}
