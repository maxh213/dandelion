import { HOT_PCT, formatCountdown, formatResetAt, type Balance, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

export const WIDTH = 72;
const GAUGE_CELLS = 20;
const MAX_GAUGE_CELLS = 80;
const MIN_GAUGE_CELLS = 6;
const MIN_LABEL_CELLS = 14;
const LABEL_CELLS = 35;
const ABSOLUTE_LABEL_CELLS = 31;
const PERCENT_CELLS = 4;
const BOLD = '\x1b[1m';
const DIM = '\x1b[90m';
const RESET = '\x1b[0m';
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const TITLE = 'DANDELION';
const ROUTING_OFF = 'routing off';
const HIDDEN = 'hidden';
const MARKER = '▸ ';

export type PanelMarks = { selected: boolean; ineligible: boolean; hidden?: boolean; caption?: string; age?: string; spinner?: string; absoluteZone?: string; width?: number };

export type Layout = { width: number; label: number; gauge: number };

function styled(text: string, code: string, noColor: boolean): string {
  if (noColor) return text;
  return text
    .split('\n')
    .map((line) => `${code}${line}${RESET}`)
    .join('\n');
}

export function bold(text: string, noColor: boolean): string {
  return styled(text, BOLD, noColor);
}

export function dim(text: string, noColor: boolean): string {
  return styled(text, DIM, noColor);
}

export function layoutOf(width = WIDTH): Layout {
  if (width >= WIDTH) return { width, label: LABEL_CELLS, gauge: Math.min(MAX_GAUGE_CELLS, GAUGE_CELLS + width - WIDTH) };
  const deficit = WIDTH - width;
  const gaugeCut = Math.min(deficit, GAUGE_CELLS - MIN_GAUGE_CELLS);
  const labelCut = Math.min(deficit - gaugeCut, LABEL_CELLS - MIN_LABEL_CELLS);
  return { width, label: LABEL_CELLS - labelCut, gauge: GAUGE_CELLS - gaugeCut };
}

export function columnsWidth(columns: number | undefined): number | undefined {
  return Number.isInteger(columns) && Number(columns) > 0 ? columns : undefined;
}

export function repeatChar(char: string, count: number): string {
  return char.repeat(Math.max(0, count));
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  const known = clockFormatters.get(timeZone);
  if (known !== undefined) return known;
  const made = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  clockFormatters.set(timeZone, made);
  return made;
}

export function clockTime(instant: string, zone: string): string {
  return clockFormatter(zone).format(new Date(instant));
}

export function cellCount(text: string): number {
  return [...text].length;
}

function bannerGap(right: string, width: number): string {
  return repeatChar(' ', width - TITLE.length - cellCount(right));
}

export function bannerLine(right: string, noColor: boolean, width = WIDTH): string {
  return styled(`${TITLE}${bannerGap(right, width)}${right}`, BOLD, noColor);
}

export function splitBanner(emphasis: string, right: string, noColor: boolean, width = WIDTH): string {
  const rest = ` · ${right}`;
  const lead = TITLE + bannerGap(emphasis + rest, width);
  return styled(lead, BOLD, noColor) + dim(emphasis, noColor) + styled(rest, BOLD, noColor);
}

export function renderBanner(instant: string, zone: string, noColor: boolean): string {
  return bannerLine(clockTime(instant, zone), noColor);
}

function plainRule(noColor: boolean, width = WIDTH): string {
  return repeatChar(noColor ? '=' : '━', width);
}

export function renderRule(noColor: boolean, width = WIDTH): string {
  return dim(plainRule(noColor, width), noColor);
}

function markedRule(marks: PanelMarks, noColor: boolean): string {
  return marks.selected ? styled(plainRule(noColor, marks.width), BOLD, noColor) : renderRule(noColor, marks.width);
}

function flagsOf(marks: PanelMarks): string {
  return [...(marks.hidden ? [HIDDEN] : []), ...(marks.ineligible ? [ROUTING_OFF] : [])].join(' · ');
}

function widthOfMarks(marks: PanelMarks): number {
  return marks.width ?? WIDTH;
}

function headerLine(name: string, marks: PanelMarks, tag: (text: string) => string): string {
  const titled = marks.spinner === undefined ? name : `${name} ${marks.spinner}`;
  const lead = marks.selected ? `${MARKER}${titled}` : titled;
  const flags = flagsOf(marks);
  return flags === '' ? lead : `${lead}${repeatChar(' ', widthOfMarks(marks) - cellCount(lead) - cellCount(flags))}${tag(flags)}`;
}

function dimPanel(lines: string[], marks: PanelMarks, noColor: boolean): string {
  if (!marks.selected) return dim([plainRule(noColor, marks.width), ...lines].join('\n'), noColor);
  return `${markedRule(marks, noColor)}\n${dim(lines.join('\n'), noColor)}`;
}

export function renderDimPanel(name: string, body: string[], noColor: boolean, marks: PanelMarks): string {
  return dimPanel([headerLine(name, marks, String), ...body], marks, noColor);
}

function gaugeCells(filledCells: number, noColor: boolean, cells: number): string {
  const [fillChar, emptyChar] = noColor ? ['#', '-'] : ['█', '░'];
  return repeatChar(fillChar, filledCells) + repeatChar(emptyChar, cells - filledCells);
}

export function renderGauge(amount: number, reference: number, noColor: boolean, cells = GAUGE_CELLS): string {
  const filledCells = Math.min(cells, Math.round((amount / reference) * cells));
  return gaugeCells(filledCells, noColor, cells);
}

export function renderEmptyGauge(noColor: boolean, cells = GAUGE_CELLS): string {
  return gaugeCells(0, noColor, cells);
}

export const STYLE_TOKENS = {
  calm: '\x1b[32m',
  warm: '\x1b[33m',
  hot: '\x1b[31m',
  critical: '\x1b[35m'
} as const satisfies Record<string, string>;

type StyleToken = keyof typeof STYLE_TOKENS;

const RAMP: [number, StyleToken][] = [
  [95, 'critical'],
  [HOT_PCT, 'hot'],
  [50, 'warm']
];

export function styleToken(usedPct: number): StyleToken {
  return RAMP.find(([threshold]) => usedPct >= threshold)?.[1] ?? 'calm';
}

export function cutCells(text: string, limit: number): string {
  const cells = [...text];
  return cells.length > limit ? `${cells.slice(0, limit - 1).join('').trimEnd()}…` : text;
}

function fitLabel(label: string, cells: number): string {
  return cutCells(label, cells).padEnd(cells);
}

function resetText(resetsAt: string, now: string, absoluteZone: string | undefined): string {
  return absoluteZone === undefined ? formatCountdown(resetsAt, now) : formatResetAt(resetsAt, now, absoluteZone);
}

function countdown(resetsAt: string | undefined, now: string, absoluteZone: string | undefined): string {
  return resetsAt === undefined ? '' : ` ↻ ${resetText(resetsAt, now, absoluteZone)}`;
}

function rowWith(window: UsageWindow, noColor: boolean, now: string, paint: (text: string) => string, absoluteZone: string | undefined, layout: Layout): string {
  const gauge = paint(renderGauge(window.usedPct, 100, noColor, layout.gauge));
  const percent = paint(`${window.usedPct}%`.padStart(PERCENT_CELLS));
  const label = fitLabel(window.label, absoluteZone === undefined ? layout.label : layout.label - (LABEL_CELLS - ABSOLUTE_LABEL_CELLS));
  return `${label} ${gauge} ${percent}${countdown(window.resetsAt, now, absoluteZone)}`;
}

export function renderWindowRow(window: UsageWindow, noColor: boolean, now: string, absoluteZone?: string, width?: number): string {
  const style = STYLE_TOKENS[styleToken(window.usedPct)];
  return rowWith(window, noColor, now, (text) => styled(text, style, noColor), absoluteZone, layoutOf(width));
}

function remainingPct(balance: Balance, reference: number): number {
  return Math.min(100, Math.max(0, Math.round((balance.amount / reference) * 100)));
}

function balanceCells(balance: Balance, noColor: boolean, paint: (text: string, usedPct: number) => string, layout: Layout): string {
  if (balance.reference === undefined) return renderEmptyGauge(noColor, layout.gauge);
  const remaining = remainingPct(balance, balance.reference);
  const gauge = paint(renderGauge(balance.amount, balance.reference, noColor, layout.gauge), 100 - remaining);
  return `${gauge} ${paint(`${remaining}%`.padStart(PERCENT_CELLS), 100 - remaining)}`;
}

function balanceTail(balance: Balance, layout: Layout): number {
  return balance.reference === undefined ? layout.gauge : layout.gauge + 1 + PERCENT_CELLS;
}

function balanceLine(balance: Balance | undefined, noColor: boolean, paint: (text: string, usedPct: number) => string, layout: Layout): string {
  if (!balance) return repeatChar(' ', layout.width);
  const label = fitLabel(`balance ${balance.currency}${balance.amount.toFixed(2)}`, layout.label);
  const padding = repeatChar(' ', layout.width - layout.label - 1 - balanceTail(balance, layout));
  return `${label} ${balanceCells(balance, noColor, paint, layout)}${padding}`;
}

function usageStyle(noColor: boolean): (text: string, usedPct: number) => string {
  return (text, usedPct) => styled(text, STYLE_TOKENS[styleToken(usedPct)], noColor);
}

function taggedCaption(usage: ProviderUsage): string {
  return usage.planLabel === undefined ? usage.displayName : `${usage.planLabel} · ${usage.displayName}`;
}

function caption(usage: ProviderUsage): string {
  return `${taggedCaption(usage)}${usage.captionSuffix ?? ''}`;
}

function agedCaption(usage: ProviderUsage, age: string | undefined, width = WIDTH): string {
  if (age === undefined) return caption(usage);
  return `${cutCells(caption(usage), width - cellCount(age))}${age}`;
}

function captionLine(usage: ProviderUsage, marks: PanelMarks): string {
  return marks.caption ?? agedCaption(usage, marks.age, marks.width);
}

type OkUsage = Extract<ProviderUsage, { status: 'ok' }>;
type FailedUsage = Exclude<ProviderUsage, OkUsage>;

function panelBody(usage: OkUsage, noColor: boolean, row: (window: UsageWindow) => string, paint: (text: string, usedPct: number) => string, layout: Layout): string[] {
  if (usage.windows.length === 0) return [usage.note ?? balanceLine(usage.balance, noColor, paint, layout)];
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

function renderPanelStale(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  const layout = layoutOf(marks.width);
  const rows = panelBody(usage, noColor, (window) => rowWith(window, noColor, now, String, marks.absoluteZone, layout), (text) => text, layout);
  return dimPanel([headerLine(usage.displayName, marks, String), ...rows, ...snapshotLines(usage, now), captionLine(usage, marks)], marks, noColor);
}

function renderPanelFresh(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  return [
    markedRule(marks, noColor),
    headerLine(usage.displayName, marks, (text) => dim(text, noColor)),
    ...panelBody(usage, noColor, (window) => renderWindowRow(window, noColor, now, marks.absoluteZone, marks.width), usageStyle(noColor), layoutOf(marks.width)),
    ...snapshotLines(usage, now).map((line) => dim(line, noColor)),
    dim(captionLine(usage, marks), noColor)
  ].join('\n');
}

export function renderPanelOk(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  return isStale(usage.snapshotAt, now) ? renderPanelStale(usage, noColor, now, marks) : renderPanelFresh(usage, noColor, now, marks);
}

export function renderPanelUnavailable(usage: FailedUsage, noColor: boolean, marks: PanelMarks): string {
  return dimPanel([headerLine(usage.displayName, marks, String), usage.reason, captionLine(usage, marks)], marks, noColor);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected provider status: ${JSON.stringify(value)}`);
}

export function renderPanel(usage: ProviderUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  switch (usage.status) {
    case 'ok':
      return renderPanelOk(usage, noColor, now, marks);
    case 'unavailable':
    case 'error':
      return renderPanelUnavailable(usage, noColor, marks);
    default:
      return assertNever(usage);
  }
}

export function renderDashboard(usages: ProviderUsage[], noColor: boolean, now: string, ineligible: string[], zone: string): string {
  const panels = usages.map((usage) => renderPanel(usage, noColor, now, { selected: false, ineligible: ineligible.includes(usage.id) }));
  return [renderBanner(now, zone, noColor), ...panels].join('\n');
}

const ESCAPE_CHAR = String.fromCharCode(27);
const TOKEN = new RegExp(`${ESCAPE_CHAR}\\[[0-9;]*m|[^]`, 'gu');

function isEscape(token: string): boolean {
  return token.length > 1 && token.startsWith('\x1b');
}

export function fitToWidth(line: string, width: number): string {
  const tokens = line.match(TOKEN) ?? [];
  if (tokens.filter((token) => !isEscape(token)).length <= width) return line;
  let cells = 0;
  const kept = tokens.filter((token) => isEscape(token) || cells++ < width);
  return `${kept.join('')}${RESET}`;
}

function panelLines(panels: string[]): string[][] {
  return panels.map((panel) => panel.split('\n'));
}

function lineCount(blocks: string[][]): number {
  return blocks.reduce((sum, block) => sum + block.length, 0);
}

function topFor(blocks: string[][], selected: number, height: number): number {
  const start = lineCount(blocks.slice(0, selected));
  const size = blocks[selected].length;
  return size > height ? start + 1 : Math.max(0, start + size - height);
}

export function viewportLines(panels: string[], selected: number | undefined, height: number): string[] {
  const blocks = panelLines(panels);
  const lines = blocks.flat();
  const hasSelection = selected !== undefined && selected >= 0 && selected < blocks.length;
  const top = hasSelection ? topFor(blocks, selected, height) : 0;
  return lines.slice(top, top + height);
}
