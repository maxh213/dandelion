import {
  HOT_PCT,
  NO_ROUTE,
  formatCountdown,
  formatResetAt,
  highRouteLine,
  nextLocalMidnight,
  routeLine,
  sortSuffix,
  summariseFleet,
  type HistorySample,
  type ProviderUsage,
  type RouteLines,
  type Routes,
  type SortOrder
} from '../domain/index.ts';
import {
  WIDTH,
  bannerLine,
  bold,
  columnsWidth,
  cellCount,
  clockTime,
  cutCells,
  dim,
  fitToWidth,
  renderDimPanel,
  renderPanel,
  repeatChar,
  splitBanner,
  viewportLines,
  type PanelMarks
} from './terminal.ts';

const SPINNER_FRAMES = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];
const REFRESHING = 'refreshing…';
const HIDE_HELP = 'h hide · H show hidden · R refresh panel · s sort';
const GRAPH_HINT = 'g usage graph of the selected panel · esc/q/g back';
const HELP_FOOTER = '↑↓/jk select · space route · r refresh · t times · c/C copy · q quit · ?';
const BOX_GAP = '  ';
const BOX_CHROME_CELLS = 4;
const ROUTE_TITLE = 'route';
const HIGH_TITLE = 'route --high';
const NO_SUBSCRIPTION = 'no subscription available';
const PROBING = 'probing…';
const ROUTES_FILE_ERROR = 'routes file error';
const FALLBACK_ROWS = 24;

export type LiveSlot = { id: string; usage: ProviderUsage | undefined; probing?: boolean };

export const ROUTE_FLASH = -1;

export type Flash = { index: number; message: string };

export type LiveView = {
  slots: LiveSlot[];
  spinner: number;
  refreshing: boolean;
  footer: boolean;
  absoluteResets?: boolean;
  order?: number[];
  sort?: SortOrder;
  ineligible: string[];
  hidden?: string[];
  showHidden?: boolean;
  zone: string;
  routes: Routes;
  settled?: ProviderUsage[];
  selected?: number;
  flash?: Flash;
  rows?: number;
  columns?: number;
  graph?: { id: string; samples: HistorySample[]; usage: ProviderUsage | undefined };
};

function settledUsages(slots: LiveSlot[]): ProviderUsage[] {
  return slots.flatMap((slot) => (slot.usage === undefined ? [] : [slot.usage]));
}

function dataAge(usages: ProviderUsage[], now: string): string {
  if (usages.length === 0) return '';
  const oldest = new Date(Math.min(...usages.map((usage) => Date.parse(usage.fetchedAt)))).toISOString();
  return `data ${formatCountdown(now, oldest)} old · `;
}

function widthOf(view: LiveView): number {
  return columnsWidth(view.columns) ?? WIDTH;
}

function liveBanner(view: LiveView, usages: ProviderUsage[], noColor: boolean, now: string): string {
  const tail = `${dataAge(usages, now)}${clockTime(now, view.zone)}`;
  return view.refreshing ? splitBanner(REFRESHING, tail, noColor, widthOf(view)) : bannerLine(tail, noColor, widthOf(view));
}

function hotSegment(hot: number, windows: number): string {
  return hot === 0 ? `all windows below ${HOT_PCT}%` : `${hot}/${windows} windows above ${HOT_PCT}%`;
}

function resetSuffix(resetsAt: string, now: string, absoluteZone: string | undefined): string {
  return absoluteZone === undefined ? ` in ${formatCountdown(resetsAt, now)}` : ` at ${formatResetAt(resetsAt, now, absoluteZone)}`;
}

function resetSegment(head: string, next: { id: string; label: string; resetsAt: string }, now: string, absoluteZone: string | undefined, width: number): string {
  const prefix = `${head}${next.id} `;
  const suffix = resetSuffix(next.resetsAt, now, absoluteZone);
  return `${prefix}${cutCells(next.label, width - cellCount(prefix) - cellCount(suffix))}${suffix}`;
}

function fleetLine(usages: ProviderUsage[], now: string, absoluteZone: string | undefined, width: number): string {
  const fleet = summariseFleet(usages, now);
  const head = `${hotSegment(fleet.hot, fleet.windows)} · next reset: `;
  return fleet.next === undefined ? `${head}none` : resetSegment(head, fleet.next, now, absoluteZone, width);
}

function summaryLine(view: LiveView, usages: ProviderUsage[], now: string): string {
  const width = widthOf(view);
  return cutCells(`${fleetLine(usages, now, absoluteZoneOf(view), width)}${sortSuffix(view.sort ?? 'dashboard')}`, width);
}

function absoluteZoneOf(view: LiveView): string | undefined {
  return view.absoluteResets === true ? view.zone : undefined;
}

function spinnerFrame(spinner: number): string {
  return SPINNER_FRAMES[spinner % SPINNER_FRAMES.length];
}

function probingLine(spinner: number): string {
  return `${spinnerFrame(spinner)} ${PROBING}`;
}

function pendingPanel(id: string, spinner: number, noColor: boolean, marks: PanelMarks): string {
  return renderDimPanel(id, [probingLine(spinner)], noColor, marks);
}

function isHidden(view: LiveView, slot: LiveSlot): boolean {
  return view.hidden?.includes(slot.id) === true;
}

function slotMarks(view: LiveView, slot: LiveSlot, index: number): PanelMarks {
  const caption = view.flash?.index === index ? view.flash.message : undefined;
  return { selected: view.selected === index, ineligible: view.ineligible.includes(slot.id), hidden: isHidden(view, slot), caption, absoluteZone: absoluteZoneOf(view), width: widthOf(view) };
}

function settledMarks(slot: LiveSlot, usage: ProviderUsage, spinner: number, now: string, marks: PanelMarks): PanelMarks {
  const age = ` · ${formatCountdown(now, usage.fetchedAt)} ago`;
  return { ...marks, age, spinner: slot.probing === true ? spinnerFrame(spinner) : undefined };
}

function livePanel(slot: LiveSlot, spinner: number, noColor: boolean, now: string, marks: PanelMarks): string {
  if (slot.usage === undefined) return pendingPanel(slot.id, spinner, noColor, marks);
  return renderPanel(slot.usage, noColor, now, settledMarks(slot, slot.usage, spinner, now, marks));
}

type BoxAnswer = { model: string; account: string; dimmed: boolean };

function boxTop(title: string, noColor: boolean, width: number): string {
  const [left, line, right] = noColor ? ['+', '-', '+'] : ['┌', '─', '┐'];
  const head = cutCells(`${left}${line} ${title} `, width - 1);
  return `${head}${repeatChar(line, width - cellCount(head) - 1)}${right}`;
}

function boxBottom(noColor: boolean, width: number): string {
  return noColor ? `+${repeatChar('-', width - 2)}+` : `└${repeatChar('─', width - 2)}┘`;
}

function boxSide(noColor: boolean): string {
  return noColor ? '|' : '│';
}

function boxText(text: string, width: number): string {
  const cells = Math.max(0, width - BOX_CHROME_CELLS);
  return ` ${cutCells(text, cells).padEnd(cells)} `;
}

function dimBoxRow(content: string, noColor: boolean): string {
  return dim(`${boxSide(noColor)}${content}${boxSide(noColor)}`, noColor);
}

function withSides(content: string, noColor: boolean): string {
  const side = dim(boxSide(noColor), noColor);
  return `${side}${content}${side}`;
}

function modelBoxRow(content: string, noColor: boolean): string {
  return withSides(bold(content, noColor), noColor);
}

function splitRouteLine(line: string): BoxAnswer {
  if (line === NO_ROUTE) return { model: NO_ROUTE, account: NO_SUBSCRIPTION, dimmed: true };
  const at = line.lastIndexOf(' ');
  return { model: line.slice(0, at), account: line.slice(at + 1), dimmed: false };
}

function probingAnswer(spinner: number): BoxAnswer {
  return { model: probingLine(spinner), account: '', dimmed: true };
}

let midnightZone: string | undefined;
let midnightFromMs: number | undefined;
let midnightUntilMs: number | undefined;
let midnightInstant: string | undefined;

function cacheHolds(zone: string, nowMs: number): boolean {
  return midnightZone === zone && nowMs >= Number(midnightFromMs) && nowMs < Number(midnightUntilMs);
}

function cachedMidnight(zone: string, now: string): string {
  const nowMs = Date.parse(now);
  if (cacheHolds(zone, nowMs)) return String(midnightInstant);
  const midnight = nextLocalMidnight(zone, now);
  midnightZone = zone;
  midnightFromMs = nowMs;
  midnightUntilMs = Date.parse(midnight);
  midnightInstant = midnight;
  return midnight;
}

function faultAnswer(problem: string): BoxAnswer {
  return { model: ROUTES_FILE_ERROR, account: problem, dimmed: true };
}

function answerLines(lines: RouteLines, settled: ProviderUsage[], view: LiveView, now: string): [string, string] {
  const midnight = cachedMidnight(view.zone, now);
  return [routeLine(lines, settled, now, midnight, view.ineligible), highRouteLine(lines, settled, view.ineligible)];
}

export function currentRouteLines(view: LiveView, now: string): [string, string] | undefined {
  const { lines, fault } = view.routes;
  if (view.settled === undefined || fault !== undefined) return undefined;
  return answerLines(lines, view.settled, view, now);
}

function boxAnswers(view: LiveView, now: string): [BoxAnswer, BoxAnswer] {
  const { lines, fault } = view.routes;
  if (view.settled === undefined) return [probingAnswer(view.spinner), probingAnswer(view.spinner)];
  if (fault !== undefined) return [faultAnswer(fault.problem), faultAnswer(fault.problem)];
  const [route, high] = answerLines(lines, view.settled, view, now);
  return [splitRouteLine(route), splitRouteLine(high)];
}

function renderBox(title: string, answer: BoxAnswer, noColor: boolean, width: number): string[] {
  const top = dim(boxTop(title, noColor, width), noColor);
  const bottom = dim(boxBottom(noColor, width), noColor);
  const [model, account] = [boxText(answer.model, width), boxText(answer.account, width)];
  if (answer.dimmed) return [top, dimBoxRow(model, noColor), dimBoxRow(account, noColor), bottom];
  return [top, modelBoxRow(model, noColor), withSides(account, noColor), bottom];
}

function routeBoxes(view: LiveView, noColor: boolean, now: string): string[] {
  const [route, high] = boxAnswers(view, now);
  const leftWidth = Math.floor((widthOf(view) - BOX_GAP.length) / 2);
  const left = renderBox(ROUTE_TITLE, route, noColor, leftWidth);
  const right = renderBox(HIGH_TITLE, high, noColor, widthOf(view) - BOX_GAP.length - leftWidth);
  return left.map((line, row) => `${line}${BOX_GAP}${right[row]}`);
}

function rowBudget(rows = FALLBACK_ROWS): number {
  return Number.isInteger(rows) && rows > 0 ? rows : FALLBACK_ROWS;
}

function summaryOrFlash(view: LiveView, usages: ProviderUsage[], now: string): string {
  return view.flash?.index === ROUTE_FLASH ? view.flash.message : summaryLine(view, usages, now);
}

function liveChrome(view: LiveView, usages: ProviderUsage[], noColor: boolean, now: string): string[] {
  return [liveBanner(view, usages, noColor, now), dim(summaryOrFlash(view, usages, now), noColor), ...routeBoxes(view, noColor, now)];
}

function liveFooter(noColor: boolean): string[] {
  return [dim(HIDE_HELP, noColor), dim(GRAPH_HINT, noColor), dim(HELP_FOOTER, noColor)];
}

function shownIndexes(view: LiveView): number[] {
  const indexes = view.order ?? view.slots.map((_, index) => index);
  return view.showHidden === true ? indexes : indexes.filter((index) => !isHidden(view, view.slots[index]));
}

function hiddenNote(view: LiveView, shown: number[], noColor: boolean): string[] {
  const count = view.slots.length - shown.length;
  return count === 0 ? [] : [dim(`${count} hidden · H to show`, noColor)];
}

function livePanels(view: LiveView, shown: number[], noColor: boolean, now: string): string[] {
  return [
    ...shown.map((index) => livePanel(view.slots[index], view.spinner, noColor, now, slotMarks(view, view.slots[index], index))),
    ...hiddenNote(view, shown, noColor)
  ];
}

function regionHeight(rows: number, chrome: string[], footer: string[]): number {
  return Math.max(0, rows - chrome.length - footer.length);
}

const Y_LABEL_CELLS = 5;
const MAX_CHART_ROWS = 6;
const LEVELS = [...'▁▂▃▄▅▆▇█'];
const FULL_PCT = 100;
const CHROME_ROWS = 3;
const WINDOW_OVERHEAD_ROWS = 2;
const NO_HISTORY = 'no history yet · samples are recorded after each refresh round';
const GRAPH_PROBING = 'no samples yet · provider still probing';
const UNAVAILABLE = 'no samples · provider unavailable';
const NO_WINDOWS = 'no usage windows to chart';

type HistoryView = {
  id: string;
  samples: HistorySample[];
  usage?: ProviderUsage;
  zone: string;
  rows: number;
  now: string;
  width: number;
};

type Column = { usedPct: number; dropped: boolean } | undefined;

function atMs(sample: HistorySample): number {
  return Date.parse(sample.at);
}

type Series = { slot: number; label: string; samples: HistorySample[] };

function seriesOf(samples: HistorySample[]): Series[] {
  const slots = [...new Set(samples.map((sample) => sample.slot))].sort((a, b) => a - b);
  return slots.map((slot) => {
    const own = samples.filter((sample) => sample.slot === slot);
    return { slot, label: own[own.length - 1].label, samples: own };
  });
}

function emptyReason(usage: ProviderUsage | undefined): string {
  if (usage === undefined) return GRAPH_PROBING;
  if (usage.status !== 'ok') return UNAVAILABLE;
  return usage.windows.length === 0 ? NO_WINDOWS : NO_HISTORY;
}

function plotCells(width: number): number {
  return Math.max(1, width - Y_LABEL_CELLS);
}

function bucketOf(sample: HistorySample, from: number, span: number, plot: number): number {
  return Math.min(plot - 1, Math.floor(((atMs(sample) - from) / span) * plot));
}

function dropFlags(samples: HistorySample[]): boolean[] {
  return samples.map((sample, index) => index > 0 && sample.usedPct < samples[index - 1].usedPct);
}

function columnsOf(samples: HistorySample[], from: number, to: number, plot: number): Column[] {
  const columns: Column[] = Array.from({ length: plot }, () => undefined);
  const span = Math.max(1, to - from);
  const drops = dropFlags(samples);
  samples.forEach((sample, index) => {
    const at = bucketOf(sample, from, span, plot);
    columns[at] = { usedPct: sample.usedPct, dropped: drops[index] || columns[at]?.dropped === true };
  });
  return columns;
}

function clampPct(usedPct: number): number {
  return Math.min(FULL_PCT, Math.max(0, usedPct));
}

function fillGlyph(filled: number, noColor: boolean): string {
  if (filled <= 0) return ' ';
  if (noColor) return '#';
  return LEVELS[Math.min(LEVELS.length, Math.ceil(filled * LEVELS.length)) - 1];
}

function cellOf(column: Column, row: number, rows: number, noColor: boolean): string {
  if (column === undefined) return ' ';
  return fillGlyph((clampPct(column.usedPct) / FULL_PCT) * rows - row, noColor);
}

function yLabel(row: number, rows: number): string {
  if (row === rows - 1) return '100%'.padStart(Y_LABEL_CELLS - 1) + ' ';
  return row === 0 ? '0%'.padStart(Y_LABEL_CELLS - 1) + ' ' : repeatChar(' ', Y_LABEL_CELLS);
}

function chartRows(columns: Column[], rows: number, noColor: boolean): string[] {
  return Array.from({ length: rows }, (_, index) => rows - 1 - index).map(
    (row) => `${yLabel(row, rows)}${columns.map((column) => cellOf(column, row, rows, noColor)).join('')}`
  );
}

function resetRow(columns: Column[], noColor: boolean): string {
  const mark = noColor ? 'v' : '↓';
  return `${repeatChar(' ', Y_LABEL_CELLS)}${columns.map((column) => (column?.dropped ? mark : ' ')).join('')}`;
}

function stamp(ms: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function axisRow(from: number, to: number, zone: string, plot: number): string {
  const left = stamp(from, zone);
  const right = stamp(to, zone);
  return `${repeatChar(' ', Y_LABEL_CELLS)}${left}${repeatChar(' ', plot - left.length - right.length)}${right}`;
}

function windowBlock(label: string, samples: HistorySample[], rows: number, range: [number, number], noColor: boolean, width: number): string[] {
  const columns = columnsOf(samples, range[0], range[1], plotCells(width));
  const latest = samples[samples.length - 1].usedPct;
  const title = `${cutCells(label, width - 8)}  ${latest}%`;
  return [bold(title, noColor), ...chartRows(columns, rows, noColor), dim(resetRow(columns, noColor), noColor)];
}

function chartHeight(rows: number, windows: number): number {
  const share = Math.floor((rows - CHROME_ROWS) / windows) - WINDOW_OVERHEAD_ROWS;
  return Math.min(MAX_CHART_ROWS, Math.max(1, share));
}

function header(view: HistoryView, span: string, noColor: boolean): string {
  return bold(`${view.id} · usage over time${span}`, noColor);
}

function spanOf(from: number, to: number): string {
  return ` · last ${formatCountdown(new Date(to).toISOString(), new Date(from).toISOString())}`;
}

function backHint(noColor: boolean): string {
  return `${noColor ? 'v' : '↓'} usage dropped (reset) · esc/q/g back`;
}

function visibleBlocks(blocks: string[][], budget: number): string[] {
  const all = blocks.flat();
  if (all.length <= budget) return all;
  const shown = Math.max(0, Math.floor((budget - 1) / blocks[0].length));
  const hidden = blocks.length - shown;
  return [...blocks.slice(0, shown).flat(), `… ${hidden} more window${hidden === 1 ? '' : 's'} (enlarge the terminal)`];
}

function renderHistoryView(view: HistoryView, noColor: boolean): string {
  const samples = [...view.samples].sort((a, b) => atMs(a) - atMs(b));
  const hint = dim(backHint(noColor), noColor);
  if (samples.length === 0) return [header(view, '', noColor), dim(emptyReason(view.usage), noColor), hint].slice(0, view.rows).join('\n');
  const range: [number, number] = [atMs(samples[0]), Math.max(atMs(samples[samples.length - 1]), Date.parse(view.now))];
  const series = seriesOf(samples);
  const height = chartHeight(view.rows, series.length);
  const blocks = series.map((one) => windowBlock(one.label, one.samples, height, range, noColor, view.width));
  const axis = dim(axisRow(range[0], range[1], view.zone, plotCells(view.width)), noColor);
  const body = visibleBlocks(blocks, Math.max(0, view.rows - CHROME_ROWS));
  return [header(view, spanOf(range[0], range[1]), noColor), ...body, axis, hint].slice(0, view.rows).join('\n');
}

function fitFrame(frame: string, columns: number | undefined): string {
  const width = columnsWidth(columns);
  return width === undefined ? frame : frame.split('\n').map((line) => fitToWidth(line, width)).join('\n');
}

export function renderLiveFrame(view: LiveView, noColor: boolean, now: string): string {
  return fitFrame(composeFrame(view, noColor, now), view.columns);
}

function composeFrame(view: LiveView, noColor: boolean, now: string): string {
  const rows = rowBudget(view.rows);
  if (view.graph) return renderHistoryView({ ...view.graph, zone: view.zone, rows, now, width: widthOf(view) }, noColor);
  const chrome = liveChrome(view, settledUsages(view.slots), noColor, now);
  const footer = view.footer ? liveFooter(noColor) : [];
  const shown = shownIndexes(view);
  const region = viewportLines(livePanels(view, shown, noColor, now), shown.indexOf(view.selected ?? -1), regionHeight(rows, chrome, footer));
  return [...chrome, ...region, ...footer].slice(0, rows).join('\n');
}
