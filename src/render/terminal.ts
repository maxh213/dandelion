import { formatCountdown, type Balance, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

const WIDTH = 72;
const GAUGE_CELLS = 20;
const LABEL_CELLS = 35;
const PERCENT_CELLS = 4;
const BOLD = '\x1b[1m';
const DIM = '\x1b[90m';
const RESET = '\x1b[0m';
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

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

export function renderBanner(instant: string, noColor: boolean): string {
  const title = 'ALLOWANCE';
  const time = clockTime(instant);
  const gap = repeatChar(' ', WIDTH - title.length - time.length);
  return styled(`${title}${gap}${time}`, BOLD, noColor);
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
  [80, 'hot'],
  [50, 'warm']
];

export function styleToken(usedPct: number): StyleToken {
  return RAMP.find(([threshold]) => usedPct >= threshold)?.[1] ?? 'calm';
}

function fitLabel(label: string): string {
  const cells = [...label];
  const fitted = cells.length > LABEL_CELLS ? `${cells.slice(0, LABEL_CELLS - 1).join('').trimEnd()}…` : label;
  return fitted.padEnd(LABEL_CELLS);
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
  if (usage.windows.length === 0) return [balanceLine(usage.balance, noColor)];
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
