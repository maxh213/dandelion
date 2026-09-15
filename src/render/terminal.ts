import {
  HOT_PCT,
  NO_ROUTE,
  formatCountdown,
  highRouteLine,
  nextLocalMidnight,
  routeLine,
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
const TITLE = 'DANDELION';
const SPINNER_FRAMES = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];
const REFRESHING = 'refreshing…';
const HELP_FOOTER = 'keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help';
const ROUTING_OFF = 'routing off';
const MARKER = '▸ ';
const BOX_WIDTH = 35;
const BOX_TEXT = 31;
const BOX_GAP = '  ';
const ROUTE_TITLE = 'route';
const HIGH_TITLE = 'route --high';
const NO_SUBSCRIPTION = 'no subscription available';
const PROBING = 'probing…';

export type PanelMarks = { selected: boolean; ineligible: boolean; caption?: string };

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

function markedRule(marks: PanelMarks, noColor: boolean): string {
  return marks.selected ? styled(plainRule(noColor), BOLD, noColor) : renderRule(noColor);
}

function headerLine(name: string, marks: PanelMarks, tag: (text: string) => string): string {
  const lead = marks.selected ? `${MARKER}${name}` : name;
  if (!marks.ineligible) return lead;
  return `${lead}${repeatChar(' ', WIDTH - cellCount(lead) - ROUTING_OFF.length)}${tag(ROUTING_OFF)}`;
}

function dimPanel(lines: string[], marks: PanelMarks, noColor: boolean): string {
  if (!marks.selected) return dim([plainRule(noColor), ...lines].join('\n'), noColor);
  return `${markedRule(marks, noColor)}\n${dim(lines.join('\n'), noColor)}`;
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

function captionLine(usage: ProviderUsage, marks: PanelMarks): string {
  return marks.caption ?? caption(usage);
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

function renderPanelStale(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  const rows = panelBody(usage, noColor, (window) => rowWith(window, noColor, now, String));
  return dimPanel([headerLine(usage.displayName, marks, String), ...rows, ...snapshotLines(usage, now), captionLine(usage, marks)], marks, noColor);
}

function renderPanelFresh(usage: OkUsage, noColor: boolean, now: string, marks: PanelMarks): string {
  return [
    markedRule(marks, noColor),
    headerLine(usage.displayName, marks, (text) => dim(text, noColor)),
    ...panelBody(usage, noColor, (window) => renderWindowRow(window, noColor, now)),
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

function renderPanel(usage: ProviderUsage, noColor: boolean, now: string, marks: PanelMarks): string {
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

export function renderDashboard(usages: ProviderUsage[], noColor: boolean, now: string, ineligible: string[]): string {
  const panels = usages.map((usage) => renderPanel(usage, noColor, now, { selected: false, ineligible: ineligible.includes(usage.id) }));
  return [renderBanner(now, noColor), ...panels].join('\n');
}

export type LiveSlot = { id: string; usage: ProviderUsage | undefined };

export type Flash = { index: number; message: string };

export type LiveView = {
  slots: LiveSlot[];
  spinner: number;
  refreshing: boolean;
  footer: boolean;
  ineligible: string[];
  zone: string;
  settled?: ProviderUsage[];
  selected?: number;
  flash?: Flash;
};

function settledUsages(slots: LiveSlot[]): ProviderUsage[] {
  return slots.flatMap((slot) => (slot.usage === undefined ? [] : [slot.usage]));
}

function dataAge(usages: ProviderUsage[], now: string): string {
  if (usages.length === 0) return '';
  const oldest = new Date(Math.min(...usages.map((usage) => Date.parse(usage.fetchedAt)))).toISOString();
  return `data ${formatCountdown(now, oldest)} old · `;
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

function pendingPanel(id: string, spinner: number, noColor: boolean, marks: PanelMarks): string {
  const frame = SPINNER_FRAMES[spinner % SPINNER_FRAMES.length];
  return dimPanel([headerLine(id, marks, String), `${frame} probing…`], marks, noColor);
}

function slotMarks(view: LiveView, slot: LiveSlot, index: number): PanelMarks {
  const caption = view.flash?.index === index ? view.flash.message : undefined;
  return { selected: view.selected === index, ineligible: view.ineligible.includes(slot.id), caption };
}

function livePanel(slot: LiveSlot, spinner: number, noColor: boolean, now: string, marks: PanelMarks): string {
  return slot.usage === undefined ? pendingPanel(slot.id, spinner, noColor, marks) : renderPanel(slot.usage, noColor, now, marks);
}

type BoxAnswer = { model: string; account: string; dimmed: boolean };

function boxTop(title: string, noColor: boolean): string {
  const [corner, line] = noColor ? ['+', '-'] : ['┌', '─'];
  const head = `${corner}${line} ${title} `;
  return `${head}${repeatChar(line, BOX_WIDTH - cellCount(head) - 1)}${noColor ? '+' : '┐'}`;
}

function boxBottom(noColor: boolean): string {
  return noColor ? `+${repeatChar('-', BOX_WIDTH - 2)}+` : `└${repeatChar('─', BOX_WIDTH - 2)}┘`;
}

function boxSide(noColor: boolean): string {
  return noColor ? '|' : '│';
}

function boxText(text: string): string {
  return ` ${cutCells(text, BOX_TEXT).padEnd(BOX_TEXT)} `;
}

function dimBoxRow(content: string, noColor: boolean): string {
  return dim(`${boxSide(noColor)}${content}${boxSide(noColor)}`, noColor);
}

function modelBoxRow(content: string, noColor: boolean): string {
  const side = dim(boxSide(noColor), noColor);
  return `${side}${styled(content, BOLD, noColor)}${side}`;
}

function plainBoxRow(content: string, noColor: boolean): string {
  const side = dim(boxSide(noColor), noColor);
  return `${side}${content}${side}`;
}

function splitRouteLine(line: string): BoxAnswer {
  if (line === NO_ROUTE) return { model: NO_ROUTE, account: NO_SUBSCRIPTION, dimmed: true };
  const at = line.lastIndexOf(' ');
  return { model: line.slice(0, at), account: line.slice(at + 1), dimmed: false };
}

function probingAnswer(spinner: number): BoxAnswer {
  return { model: `${SPINNER_FRAMES[spinner % SPINNER_FRAMES.length]} ${PROBING}`, account: '', dimmed: true };
}

function boxAnswers(view: LiveView, now: string): [BoxAnswer, BoxAnswer] {
  if (view.settled === undefined) return [probingAnswer(view.spinner), probingAnswer(view.spinner)];
  const midnight = nextLocalMidnight(view.zone, now);
  return [
    splitRouteLine(routeLine(view.settled, now, midnight, view.ineligible)),
    splitRouteLine(highRouteLine(view.settled, view.ineligible))
  ];
}

function renderBox(title: string, answer: BoxAnswer, noColor: boolean): string[] {
  const top = dim(boxTop(title, noColor), noColor);
  const bottom = dim(boxBottom(noColor), noColor);
  if (answer.dimmed) return [top, dimBoxRow(boxText(answer.model), noColor), dimBoxRow(boxText(answer.account), noColor), bottom];
  return [top, modelBoxRow(boxText(answer.model), noColor), plainBoxRow(boxText(answer.account), noColor), bottom];
}

function routeBoxes(view: LiveView, noColor: boolean, now: string): string[] {
  const [headroom, high] = boxAnswers(view, now);
  const left = renderBox(ROUTE_TITLE, headroom, noColor);
  const right = renderBox(HIGH_TITLE, high, noColor);
  return left.map((line, row) => `${line}${BOX_GAP}${right[row]}`);
}

export function renderLiveFrame(view: LiveView, noColor: boolean, now: string): string {
  const usages = settledUsages(view.slots);
  const panels = view.slots.map((slot, index) => livePanel(slot, view.spinner, noColor, now, slotMarks(view, slot, index)));
  const footer = view.footer ? [dim(HELP_FOOTER, noColor)] : [];
  return [liveBanner(view, usages, noColor, now), dim(summaryLine(usages, now), noColor), ...routeBoxes(view, noColor, now), ...panels, ...footer].join('\n');
}
