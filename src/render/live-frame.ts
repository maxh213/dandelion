import {
  HOT_PCT,
  NO_ROUTE,
  formatCountdown,
  formatResetAt,
  highRouteLine,
  nextLocalMidnight,
  routeLine,
  summariseFleet,
  type ProviderUsage,
  type Routes
} from '../domain/index.ts';
import {
  WIDTH,
  bannerLine,
  bold,
  cellCount,
  clockTime,
  cutCells,
  dim,
  renderDimPanel,
  renderPanel,
  repeatChar,
  splitBanner,
  type PanelMarks
} from './terminal.ts';

const SPINNER_FRAMES = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];
const REFRESHING = 'refreshing…';
const HIDE_HELP = 'h hide · H show hidden';
const HELP_FOOTER = '↑↓/jk select · space route · r refresh · t reset times · q quit · ? help';
const BOX_WIDTH = 35;
const BOX_TEXT_CELLS = 31;
const BOX_GAP = '  ';
const ROUTE_TITLE = 'route';
const HIGH_TITLE = 'route --high';
const NO_SUBSCRIPTION = 'no subscription available';
const PROBING = 'probing…';
const ROUTES_FILE_ERROR = 'routes file error';
const FALLBACK_ROWS = 24;

export type LiveSlot = { id: string; usage: ProviderUsage | undefined; probing?: boolean };

export type Flash = { index: number; message: string };

export type LiveView = {
  slots: LiveSlot[];
  spinner: number;
  refreshing: boolean;
  footer: boolean;
  absoluteResets?: boolean;
  ineligible: string[];
  hidden?: string[];
  showHidden?: boolean;
  zone: string;
  routes: Routes;
  settled?: ProviderUsage[];
  selected?: number;
  flash?: Flash;
  rows?: number;
};

function settledUsages(slots: LiveSlot[]): ProviderUsage[] {
  return slots.flatMap((slot) => (slot.usage === undefined ? [] : [slot.usage]));
}

function dataAge(usages: ProviderUsage[], now: string): string {
  if (usages.length === 0) return '';
  const oldest = new Date(Math.min(...usages.map((usage) => Date.parse(usage.fetchedAt)))).toISOString();
  return `data ${formatCountdown(now, oldest)} old · `;
}

function liveBanner(view: LiveView, usages: ProviderUsage[], noColor: boolean, now: string): string {
  const tail = `${dataAge(usages, now)}${clockTime(now, view.zone)}`;
  return view.refreshing ? splitBanner(REFRESHING, tail, noColor) : bannerLine(tail, noColor);
}

function hotSegment(hot: number, windows: number): string {
  return hot === 0 ? `all windows below ${HOT_PCT}%` : `${hot}/${windows} windows above ${HOT_PCT}%`;
}

function resetSuffix(resetsAt: string, now: string, absoluteZone: string | undefined): string {
  return absoluteZone === undefined ? ` in ${formatCountdown(resetsAt, now)}` : ` at ${formatResetAt(resetsAt, now, absoluteZone)}`;
}

function resetSegment(head: string, next: { id: string; label: string; resetsAt: string }, now: string, absoluteZone: string | undefined): string {
  const prefix = `${head}${next.id} `;
  const suffix = resetSuffix(next.resetsAt, now, absoluteZone);
  return `${prefix}${cutCells(next.label, WIDTH - cellCount(prefix) - cellCount(suffix))}${suffix}`;
}

function summaryLine(usages: ProviderUsage[], now: string, absoluteZone: string | undefined): string {
  const fleet = summariseFleet(usages, now);
  const head = `${hotSegment(fleet.hot, fleet.windows)} · next reset: `;
  return fleet.next === undefined ? `${head}none` : resetSegment(head, fleet.next, now, absoluteZone);
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
  return { selected: view.selected === index, ineligible: view.ineligible.includes(slot.id), hidden: isHidden(view, slot), caption, absoluteZone: absoluteZoneOf(view) };
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

function boxTop(title: string, noColor: boolean): string {
  const [left, line, right] = noColor ? ['+', '-', '+'] : ['┌', '─', '┐'];
  const head = `${left}${line} ${title} `;
  return `${head}${repeatChar(line, BOX_WIDTH - cellCount(head) - 1)}${right}`;
}

function boxBottom(noColor: boolean): string {
  return noColor ? `+${repeatChar('-', BOX_WIDTH - 2)}+` : `└${repeatChar('─', BOX_WIDTH - 2)}┘`;
}

function boxSide(noColor: boolean): string {
  return noColor ? '|' : '│';
}

function boxText(text: string): string {
  return ` ${cutCells(text, BOX_TEXT_CELLS).padEnd(BOX_TEXT_CELLS)} `;
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

function boxAnswers(view: LiveView, now: string): [BoxAnswer, BoxAnswer] {
  const { lines, fault } = view.routes;
  if (view.settled === undefined) return [probingAnswer(view.spinner), probingAnswer(view.spinner)];
  if (fault !== undefined) return [faultAnswer(fault.problem), faultAnswer(fault.problem)];
  const midnight = cachedMidnight(view.zone, now);
  return [
    splitRouteLine(routeLine(lines, view.settled, now, midnight, view.ineligible)),
    splitRouteLine(highRouteLine(lines, view.settled, view.ineligible))
  ];
}

function renderBox(title: string, answer: BoxAnswer, noColor: boolean): string[] {
  const top = dim(boxTop(title, noColor), noColor);
  const bottom = dim(boxBottom(noColor), noColor);
  if (answer.dimmed) return [top, dimBoxRow(boxText(answer.model), noColor), dimBoxRow(boxText(answer.account), noColor), bottom];
  return [top, modelBoxRow(boxText(answer.model), noColor), withSides(boxText(answer.account), noColor), bottom];
}

function routeBoxes(view: LiveView, noColor: boolean, now: string): string[] {
  const [route, high] = boxAnswers(view, now);
  const left = renderBox(ROUTE_TITLE, route, noColor);
  const right = renderBox(HIGH_TITLE, high, noColor);
  return left.map((line, row) => `${line}${BOX_GAP}${right[row]}`);
}

function rowBudget(rows = FALLBACK_ROWS): number {
  return Number.isInteger(rows) && rows > 0 ? rows : FALLBACK_ROWS;
}

function panelLines(panels: string[]): string[] {
  return panels.flatMap((panel) => panel.split('\n'));
}

function fromSelectedHeader(panels: string[], selected: number): string[] {
  return panelLines(panels.slice(selected)).slice(1);
}

function hasSelection(selected = -1): selected is number {
  return selected >= 0;
}

function regionLines(panels: string[], selected: number | undefined, height: number): string[] {
  const lines = hasSelection(selected) ? fromSelectedHeader(panels, selected) : panelLines(panels);
  return lines.slice(0, height);
}

function liveChrome(view: LiveView, usages: ProviderUsage[], noColor: boolean, now: string): string[] {
  return [liveBanner(view, usages, noColor, now), dim(summaryLine(usages, now, absoluteZoneOf(view)), noColor), ...routeBoxes(view, noColor, now)];
}

function liveFooter(noColor: boolean): string[] {
  return [dim(HIDE_HELP, noColor), dim(HELP_FOOTER, noColor)];
}

function shownIndexes(view: LiveView): number[] {
  const indexes = view.slots.map((_, index) => index);
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

export function renderLiveFrame(view: LiveView, noColor: boolean, now: string): string {
  const rows = rowBudget(view.rows);
  const chrome = liveChrome(view, settledUsages(view.slots), noColor, now);
  const footer = view.footer ? liveFooter(noColor) : [];
  const shown = shownIndexes(view);
  const region = regionLines(livePanels(view, shown, noColor, now), shown.indexOf(view.selected ?? -1), regionHeight(rows, chrome, footer));
  return [...chrome, ...region, ...footer].slice(0, rows).join('\n');
}
