import { elapsedFraction, formatCountdown, formatResetAt, isStale, printable, projectFull, usageClass, type Balance, type ClaudeStatus, type HistorySample, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

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
const FIX_HINT = ' · x fix';
const TITLE = 'DANDELION';
const ROUTING_OFF = 'routing off';
const HIDDEN = 'hidden';
const MARKER = '▸ ';
const COMPACT_LEAD_CELLS = 20;
const SPARK_BUCKETS = 8;
const SPARK_SPAN_MS = 24 * 60 * 60 * 1000;
const SPARK_BUCKET_MS = SPARK_SPAN_MS / SPARK_BUCKETS;
const SPARK_MIN_SAMPLES = 2;
const SPARK_BLOCKS = [...'▁▂▃▄▅▆▇█'];
const SPARK_ASCII = [...'_.-=#'];

export type PanelMarks = { selected: boolean; ineligible: boolean; hidden?: boolean; caption?: string; fixable?: boolean; age?: string; spinner?: string; absoluteZone?: string; width?: number; status?: ClaudeStatus; samples?: HistorySample[] };

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

const ZERO_WIDTH: [number, number][] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xe0100, 0xe01ef]
];

const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd]
];

function within(ranges: [number, number][], code: number): boolean {
  return ranges.some(([from, to]) => code >= from && code <= to);
}

export function cellWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (within(ZERO_WIDTH, code)) return 0;
  return within(WIDE, code) ? 2 : 1;
}

export function cellCount(text: string): number {
  return [...text].reduce((sum, char) => sum + cellWidth(char), 0);
}

export function padCells(text: string, cells: number): string {
  return text + repeatChar(' ', cells - cellCount(text));
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

function statusRows(marks: PanelMarks, noColor: boolean): string[] {
  if (marks.status === undefined) return [];
  const text = cutCells(`status: ${printable(marks.status.description)}`, widthOfMarks(marks));
  return [noColor ? text : `${STYLE_TOKENS[marks.status.severity]}${text}${RESET}`];
}

function dimPanel(lines: string[], marks: PanelMarks, noColor: boolean): string {
  if (!marks.selected) return dim([plainRule(noColor, marks.width), ...lines].join('\n'), noColor);
  return `${markedRule(marks, noColor)}\n${dim(lines.join('\n'), noColor)}`;
}

export function renderDimPanel(name: string, body: string[], noColor: boolean, marks: PanelMarks): string {
  return dimPanel([headerLine(name, marks, String), ...statusRows(marks, noColor), ...body], marks, noColor);
}

function gaugeCells(filledCells: number, noColor: boolean, cells: number): string {
  const [fillChar, emptyChar] = noColor ? ['#', '-'] : ['█', '░'];
  return repeatChar(fillChar, filledCells) + repeatChar(emptyChar, cells - filledCells);
}

export function renderGauge(amount: number, reference: number, noColor: boolean, cells = GAUGE_CELLS): string {
  const filledCells = Math.min(cells, Math.floor((amount * cells) / reference));
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

export function cutCells(text: string, limit: number): string {
  if (cellCount(text) <= limit) return text;
  return limit <= 0 ? '' : `${headCells(text, limit - 1).trimEnd()}…`;
}

function headCells(text: string, limit: number): string {
  let used = 0;
  let head = '';
  for (const char of text) {
    used += cellWidth(char);
    if (used > limit) break;
    head += char;
  }
  return head;
}

function fitLabel(label: string, cells: number): string {
  return padCells(cutCells(label, cells), cells);
}

function resetText(resetsAt: string, now: string, absoluteZone: string | undefined): string {
  return absoluteZone === undefined ? formatCountdown(resetsAt, now) : formatResetAt(resetsAt, now, absoluteZone);
}

function countdown(resetsAt: string | undefined, now: string, absoluteZone: string | undefined): string {
  return resetsAt === undefined ? '' : ` ↻ ${resetText(resetsAt, now, absoluteZone)}`;
}

function paceGauge(window: UsageWindow, noColor: boolean, now: string, paint: (text: string) => string, mark: (text: string) => string, cells: number): string {
  const gauge = renderGauge(window.usedPct, 100, noColor, cells);
  const fraction = elapsedFraction(window, now);
  if (fraction === undefined) return paint(gauge);
  const index = Math.min(cells - 1, Math.floor(fraction * cells));
  const chars = [...gauge];
  return paintSlice(chars.slice(0, index), paint) + mark(noColor ? '|' : '│') + paintSlice(chars.slice(index + 1), paint);
}

function paintSlice(chars: string[], paint: (text: string) => string): string {
  return chars.length === 0 ? '' : paint(chars.join(''));
}

function sparkCells(spark: string): number {
  return spark === '' ? 0 : SPARK_BUCKETS + 1;
}

function rowWith(window: UsageWindow, noColor: boolean, now: string, paint: (text: string) => string, mark: (text: string) => string, absoluteZone: string | undefined, layout: Layout, spark = ''): string {
  const gauge = paceGauge(window, noColor, now, paint, mark, layout.gauge - sparkCells(spark));
  const percent = paint(`${Math.round(window.usedPct)}%`.padStart(PERCENT_CELLS));
  const label = fitLabel(window.label, absoluteZone === undefined ? layout.label : layout.label - (LABEL_CELLS - ABSOLUTE_LABEL_CELLS));
  return `${label} ${gauge} ${percent}${spark}${countdown(window.resetsAt, now, absoluteZone)}`;
}

export function renderWindowRow(window: UsageWindow, noColor: boolean, now: string, absoluteZone?: string, width?: number, spark?: string): string {
  const style = STYLE_TOKENS[usageClass(window.usedPct)];
  return rowWith(window, noColor, now, (text) => styled(text, style, noColor), (text) => dim(text, noColor), absoluteZone, layoutOf(width), spark);
}

function sparkLevel(usedPct: number, glyphs: string[]): string {
  return glyphs[Math.round((Math.min(100, Math.max(0, usedPct)) / 100) * (glyphs.length - 1))];
}

function sparkBucket(sample: HistorySample, from: number): number {
  return Math.min(SPARK_BUCKETS - 1, Math.floor((Date.parse(sample.at) - from) / SPARK_BUCKET_MS));
}

function recentSamples(samples: HistorySample[], window: UsageWindow, slot: number, now: string): HistorySample[] {
  const to = Date.parse(now);
  const own = samples.filter((sample) => sample.slot === slot && sample.label === window.label);
  return own.filter((sample) => Date.parse(sample.at) >= to - SPARK_SPAN_MS && Date.parse(sample.at) <= to).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function sparkline(samples: HistorySample[], now: string, noColor: boolean): string {
  const from = Date.parse(now) - SPARK_SPAN_MS;
  const cells = Array.from({ length: SPARK_BUCKETS }, () => ' ');
  samples.forEach((sample) => {
    cells[sparkBucket(sample, from)] = sparkLevel(sample.usedPct, noColor ? SPARK_ASCII : SPARK_BLOCKS);
  });
  return ` ${dim(cells.join(''), noColor)}`;
}

function sparkFor(window: UsageWindow, slot: number, noColor: boolean, now: string, marks: PanelMarks): string | undefined {
  const recent = recentSamples(marks.samples ?? [], window, slot, now);
  const roomy = layoutOf(marks.width).gauge - SPARK_BUCKETS - 1 >= MIN_GAUGE_CELLS;
  return recent.length >= SPARK_MIN_SAMPLES && roomy ? sparkline(recent, now, noColor) : undefined;
}

function pacedRow(window: UsageWindow, slot: number, noColor: boolean, now: string, marks: PanelMarks): string {
  const row = renderWindowRow(window, noColor, now, marks.absoluteZone, marks.width, sparkFor(window, slot, noColor, now, marks));
  const full = projectFull(window, now);
  return full === undefined ? row : `${row}\n${dim(`  → 100% in ~${formatCountdown(full, now)} (before reset)`, noColor)}`;
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
  return (text, usedPct) => styled(text, STYLE_TOKENS[usageClass(usedPct)], noColor);
}

function taggedCaption(usage: ProviderUsage): string {
  return usage.planLabel === undefined ? usage.displayName : `${usage.planLabel} · ${usage.displayName}`;
}

function caption(usage: ProviderUsage): string {
  return `${taggedCaption(usage)}${usage.captionSuffix ?? ''}`;
}

function agedCaption(usage: ProviderUsage, age: string | undefined, width = WIDTH, hint = ''): string {
  const room = width - cellCount(hint);
  const text = age === undefined ? caption(usage) : `${cutCells(caption(usage), room - cellCount(age))}${age}`;
  return `${text}${hint}`;
}

function captionLine(usage: ProviderUsage, marks: PanelMarks): string {
  return marks.caption ?? agedCaption(usage, marks.age, marks.width, marks.fixable === true ? FIX_HINT : '');
}

type OkUsage = Extract<ProviderUsage, { status: 'ok' }>;
type FailedUsage = Exclude<ProviderUsage, OkUsage>;

function panelBody(usage: OkUsage, noColor: boolean, row: (window: UsageWindow, slot: number) => string, paint: (text: string, usedPct: number) => string, layout: Layout): string[] {
  if (usage.windows.length === 0) return [usage.note ?? balanceLine(usage.balance, noColor, paint, layout)];
  return usage.windows.map(row);
}

function snapshotLine(snapshotAt: string, now: string): string {
  const age = `snapshot ${formatCountdown(now, snapshotAt)} old`;
  return isStale(snapshotAt, now) ? `stale ${age}` : age;
}

function snapshotLines(usage: OkUsage, now: string): string[] {
  return usage.snapshotAt === undefined ? [] : [snapshotLine(usage.snapshotAt, now)];
}

function plainRows(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string[] {
  const layout = layoutOf(marks.width);
  return panelBody(usage, noColor, (window) => rowWith(window, noColor, now, String, String, marks.absoluteZone, layout), (text) => text, layout);
}

function renderPanelStale(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  return dimPanel([headerLine(usage.displayName, marks, String), ...statusRows(marks, noColor), ...plainRows(usage, noColor, now, marks), ...snapshotLines(usage, now), captionLine(usage, marks)], marks, noColor);
}

export function renderPanelRemembered(good: OkUsage, failed: FailedUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  const lines = [headerLine(good.displayName, marks, String), ...statusRows(marks, noColor), ...plainRows(good, noColor, now, marks), `last probe failed: ${failed.reason}`, captionLine(good, marks)];
  return dimPanel(lines, marks, noColor);
}

function renderPanelFresh(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  return [
    markedRule(marks, noColor),
    headerLine(usage.displayName, marks, (text) => dim(text, noColor)),
    ...statusRows(marks, noColor),
    ...panelBody(usage, noColor, (window, slot) => pacedRow(window, slot, noColor, now, marks), usageStyle(noColor), layoutOf(marks.width)),
    ...snapshotLines(usage, now).map((line) => dim(line, noColor)),
    dim(captionLine(usage, marks), noColor)
  ].join('\n');
}

export function renderPanelOk(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  return isStale(usage.snapshotAt, now) ? renderPanelStale(usage, noColor, now, marks) : renderPanelFresh(usage, noColor, now, marks);
}

export function renderPanelUnavailable(usage: FailedUsage, noColor: boolean, marks: PanelMarks): string {
  return dimPanel([headerLine(usage.displayName, marks, String), ...statusRows(marks, noColor), usage.reason, captionLine(usage, marks)], marks, noColor);
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
  if (cellCount(tokens.filter((token) => !isEscape(token)).join('')) <= width) return line;
  let cells = 0;
  let full = false;
  const kept = tokens.filter((token) => {
    if (isEscape(token)) return true;
    cells += cellWidth(token);
    full = full || cells > width;
    return !full;
  });
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

function worstWindow(windows: UsageWindow[]): UsageWindow {
  const pool = windows.filter((window) => window.kind !== 'other');
  return (pool.length > 0 ? pool : windows).reduce((worst, window) => (window.usedPct > worst.usedPct ? window : worst));
}

function soonestReset(windows: UsageWindow[], now: string): string | undefined {
  const times = windows.flatMap((window) => (window.resetsAt === undefined || Date.parse(window.resetsAt) <= Date.parse(now) ? [] : [window.resetsAt]));
  return times.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

function compactLead(id: string, marks: PanelMarks): string {
  const titled = marks.spinner === undefined ? id : `${id} ${marks.spinner}`;
  return `${marks.selected ? MARKER : '  '}${titled}`.padEnd(COMPACT_LEAD_CELLS);
}

function rightAligned(left: string, marks: PanelMarks): string {
  const flags = flagsOf(marks);
  return flags === '' ? left : `${left}${repeatChar(' ', widthOfMarks(marks) - cellCount(left) - cellCount(flags))}${flags}`;
}

function textRow(id: string, text: string, marks: PanelMarks, paint: (line: string) => string): string {
  const lead = compactLead(id, marks);
  return paint(rightAligned(`${lead}${cutCells(text, widthOfMarks(marks) - cellCount(lead) - cellCount(flagsOf(marks)) - 1)}`, marks));
}

function dimRow(id: string, text: string, marks: PanelMarks, noColor: boolean): string {
  return textRow(id, text, marks, (line) => styled(line, marks.selected ? BOLD + DIM : DIM, noColor));
}

function balanceText(balance: Balance | undefined): string {
  return balance === undefined ? '' : `balance ${balance.currency}${balance.amount.toFixed(2)}`;
}

function windowRow(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  const worst = worstWindow(usage.windows);
  const lead = compactLead(usage.id, marks);
  const meter = `${renderGauge(worst.usedPct, 100, noColor)} ${`${Math.round(worst.usedPct)}%`.padStart(PERCENT_CELLS)}`;
  const reset = cutCells(countdown(soonestReset(usage.windows, now), now, marks.absoluteZone), widthOfMarks(marks) - cellCount(lead) - cellCount(meter) - cellCount(flagsOf(marks)) - 1);
  const weight = marks.selected ? BOLD : '';
  const tail = rightAligned(`${lead}${meter}${reset}`, marks).slice(cellCount(lead) + cellCount(meter));
  return `${styled(lead, weight, noColor || !marks.selected)}${styled(meter, weight + STYLE_TOKENS[usageClass(worst.usedPct)], noColor)}${styled(tail, weight, noColor || !marks.selected)}`;
}

function usageRow(usage: ProviderUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  if (usage.status !== 'ok') return dimRow(usage.id, usage.reason, marks, noColor);
  if (usage.windows.length === 0) return dimRow(usage.id, usage.note ?? balanceText(usage.balance), marks, noColor);
  return windowRow(usage, noColor, now, marks);
}

export function renderCompactRow(id: string, usage: ProviderUsage | undefined, noColor: boolean, now: string, marks: PanelMarks, pending: string): string {
  if (marks.caption !== undefined) return textRow(id, marks.caption, marks, (line) => bold(line, noColor));
  return usage === undefined ? dimRow(id, pending, marks, noColor) : usageRow(usage, noColor, now, marks);
}
