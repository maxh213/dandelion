import type { ProviderUsage } from '../domain/types.ts';

function clockTime(instant: string): string {
  return `${instant.slice(11, 19)}Z`;
}

export function renderBanner(instant: string, noColor: boolean): string {
  const title = 'ALLOWANCE';
  const time = clockTime(instant);
  const spaces = 72 - title.length - time.length;
  const line = `${title}${' '.repeat(Math.max(0, spaces))}${time}`;
  if (noColor) return line;
  return `\x1b[1m${line}\x1b[0m`;
}

function repeatChar(char: string, count: number): string {
  let res = '';
  for (let i = 0; i < count; i++) {
    res += char;
  }
  return res;
}

function getRuleChar(noColor: boolean): string {
  if (noColor) return '=';
  return '━';
}

function dim(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `\x1b[90m${text}\x1b[0m`;
}

function plainRule(noColor: boolean): string {
  return repeatChar(getRuleChar(noColor), 72);
}

export function renderRule(noColor: boolean): string {
  return dim(plainRule(noColor), noColor);
}

export function renderGauge(amount: number, reference: number, noColor: boolean): string {
  const filledCells = Math.min(20, Math.round((amount / reference) * 20));
  const emptyCells = 20 - filledCells;
  
  const fillChar = noColor ? '#' : '█';
  const emptyChar = noColor ? '-' : '░';
  
  const filled = repeatChar(fillChar, filledCells);
  const empty = repeatChar(emptyChar, emptyCells);
  
  return `${filled}${empty}`;
}

export function renderEmptyGauge(noColor: boolean): string {
  const emptyChar = noColor ? '-' : '░';
  return repeatChar(emptyChar, 20);
}

function formatBalance(amount: number, currency: string): string {
  return `${currency}${amount.toFixed(2)}`;
}

function buildBalLine(usage: ProviderUsage, noColor: boolean): string {
  let gauge = '';
  let balText = '';
  if (usage.balance) {
    balText = formatBalance(usage.balance.amount, usage.balance.currency);
    if (usage.balance.reference !== undefined) {
      gauge = renderGauge(usage.balance.amount, usage.balance.reference, noColor);
    } else {
      gauge = renderEmptyGauge(noColor);
    }
  }

  const paddingLength = 72 - balText.length - gauge.length - 1;
  const padding = repeatChar(' ', Math.max(0, paddingLength));
  return `${balText} ${gauge}${padding}`;
}

export function renderPanelOk(usage: ProviderUsage, noColor: boolean): string {
  const rule = renderRule(noColor);
  const name = usage.displayName;
  const balLine = buildBalLine(usage, noColor);
  const caption = `api balance · ${name}`;
  const dimCaption = noColor ? caption : `\x1b[90m${caption}\x1b[0m`;
  return `${rule}\n${name}\n${balLine}\n${dimCaption}`;
}

export function renderPanelUnavailable(usage: ProviderUsage, noColor: boolean): string {
  const name = usage.displayName;
  const reason = usage.reason || 'Unknown error';
  const caption = `api balance · ${name}`;
  return dim(`${plainRule(noColor)}\n${name}\n${reason}\n${caption}`, noColor);
}

export function renderDashboard(usages: ProviderUsage[], noColor: boolean, now: string): string {
  let out = renderBanner(now, noColor);
  
  for (const usage of usages) {
    out += '\n';
    if (usage.status === 'ok') {
      out += renderPanelOk(usage, noColor);
    } else {
      out += renderPanelUnavailable(usage, noColor);
    }
  }
  
  return out;
}
