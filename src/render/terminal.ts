import type { Balance, ProviderUsage } from '../domain/index.ts';

const WIDTH = 72;
const GAUGE_CELLS = 20;
const BOLD = '\x1b[1m';
const DIM = '\x1b[90m';
const RESET = '\x1b[0m';

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

function balanceGauge(balance: Balance, noColor: boolean): string {
  if (balance.reference === undefined) return renderEmptyGauge(noColor);
  return renderGauge(balance.amount, balance.reference, noColor);
}

function balanceLine(balance: Balance | undefined, noColor: boolean): string {
  if (!balance) return ' '.padEnd(WIDTH);
  const amount = `${balance.currency}${balance.amount.toFixed(2)}`;
  return `${amount} ${balanceGauge(balance, noColor)}`.padEnd(WIDTH);
}

function caption(usage: ProviderUsage): string {
  return `api balance · ${usage.displayName}`;
}

export function renderPanelOk(usage: ProviderUsage, noColor: boolean): string {
  return [
    renderRule(noColor),
    usage.displayName,
    balanceLine(usage.balance, noColor),
    dim(caption(usage), noColor)
  ].join('\n');
}

export function renderPanelUnavailable(usage: ProviderUsage, noColor: boolean): string {
  const reason = usage.reason || 'Unknown error';
  return dim([plainRule(noColor), usage.displayName, reason, caption(usage)].join('\n'), noColor);
}

function renderPanel(usage: ProviderUsage, noColor: boolean): string {
  if (usage.status === 'ok') return renderPanelOk(usage, noColor);
  return renderPanelUnavailable(usage, noColor);
}

export function renderDashboard(usages: ProviderUsage[], noColor: boolean, now: string): string {
  const panels = usages.map((usage) => renderPanel(usage, noColor));
  return [renderBanner(now, noColor), ...panels].join('\n');
}
