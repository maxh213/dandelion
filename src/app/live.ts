import type { ProviderProbe } from '../probes/index.ts';
import { NO_ROUTE, ROUTE_FLASH, currentRouteLines, dueReprobes, passedResets, resetKey, isRoutable, nextLocalMidnight, nextSortOrder, notificationEvents, orderPanels, renderLiveFrame, type SortOrder, type ClaudeStatus, type Eligibility, type Fix, type Flash, type Hidden, type History, type LiveSlot, type LiveView, type Notification, type Routes, type Snapshot, type View } from '../render/index.ts';

export interface Screen {
  write(text: string): unknown;
  rows?: number;
  columns?: number;
  on?(event: 'resize', listener: () => void): unknown;
}

export interface Notifier {
  notify(text: string): unknown;
}

type Launch = { command: string; args: string[]; env: Record<string, string> };

type SignalName = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

export interface FixRunner {
  spawn(launch: Launch): Promise<number | 'missing'>;
  terminate(signal: SignalName): Promise<void>;
}

export interface Clipboard {
  copy(text: string): Promise<boolean>;
}

interface Signals {
  on(event: SignalName, listener: () => void): unknown;
  off(event: SignalName, listener: () => void): unknown;
}

export interface Keyboard {
  setRawMode(raw: boolean): unknown;
  setEncoding(encoding: 'utf8'): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  pause(): unknown;
  resume(): unknown;
}

type LiveOptions = {
  probes: ProviderProbe[];
  env: Record<string, string | undefined>;
  launchOf(routeLine: string): Launch;
  screen: Screen;
  keyboard: Keyboard;
  signals: Signals;
  stopChildren(): Promise<void>;
  eligibility: Eligibility;
  hidden: Hidden;
  view: View;
  history: History;
  snapshot: Snapshot<NonNullable<LiveSlot['usage']>>;
  routes: Routes;
  zone: string;
  notifier: Notifier;
  clipboard: Clipboard;
  spawner: FixRunner;
  statusProbe?: () => Promise<ClaudeStatus | undefined>;
  clock?: () => string;
};

type Timer = ReturnType<typeof setTimeout>;

type SettledRound = NonNullable<LiveSlot['usage']>[];

type Session = LiveOptions & {
  clock: () => string;
  results: LiveSlot['usage'][];
  lastGood: LiveSlot['lastGood'][];
  inFlight: Set<number>;
  generations: number[];
  settled: SettledRound | undefined;
  noColor: boolean;
  refreshMs: number;
  spinner: number;
  footer: boolean;
  showHidden: boolean;
  absoluteResets: boolean;
  sort: SortOrder;
  order: number[];
  compact: boolean;
  running?: boolean;
  rounds: number;
  endedAt: number;
  quitting: boolean;
  suspended: boolean;
  selected: number;
  graphing: boolean;
  notified: Set<string>;
  reprobed: Set<string>;
  status?: ClaudeStatus;
  flash?: Flash;
  frameTimer?: Timer;
  refreshTimer?: Timer;
  flashTimer?: Timer;
  done(code: number): void;
  terminators: [SignalName, () => void][];
};

function wallClock(): string {
  return new Date().toISOString();
}

const ENTER_ALTERNATE = '\x1b[?1049h\x1b[?25l';
const CLEAR = '\x1b[H\x1b[2J\x1b[0m';
const LEAVE_ALTERNATE = '\x1b[?25h\x1b[?1049l';
const PENDING_TICK_MS = 100;
const SETTLED_TICK_MS = 1000;
const FLASH_MS = 2000;
const DEFAULT_REFRESH_SECONDS = 300;
const MAX_REFRESH_SECONDS = 2147483;
const DIGITS_ONLY = /^\d+$/;
const NOT_ROUTABLE = 'not routable (no usage windows)';
const NOT_SAVED = 'routing state not saved';
const HIDDEN_NOT_SAVED = 'hidden state not saved';
const VIEW_NOT_SAVED = 'view state not saved';
const NOTHING_TO_COPY = 'nothing to copy';
const COPY_FAILED = 'copy failed';
const NOTHING_TO_LAUNCH = 'nothing to launch';
const NO_FIX = 'no fix for this panel';

function refreshSecondsOf(raw: string): number {
  const seconds = DIGITS_ONLY.test(raw) ? Number(raw) : 0;
  return seconds > 0 && seconds <= MAX_REFRESH_SECONDS ? seconds : DEFAULT_REFRESH_SECONDS;
}

function refreshMsOf(env: Record<string, string | undefined>): number {
  return refreshSecondsOf(String(env['DANDELION_REFRESH_SECONDS'])) * 1000;
}

function graphOf(session: Session): NonNullable<LiveView['graph']> {
  const { id } = session.probes[session.selected];
  return { id, samples: session.history.samples(id), usage: session.results[session.selected] };
}

function viewOf(session: Session): LiveView {
  return {
    slots: session.probes.map(({ id }, index) => ({ id, usage: session.results[index], probing: session.inFlight.has(index), lastGood: session.lastGood[index] })),
    spinner: session.spinner,
    refreshing: session.running === true && session.rounds > 1,
    footer: session.footer,
    absoluteResets: session.absoluteResets,
    order: session.order,
    sort: session.sort,
    compact: session.compact,
    ineligible: session.eligibility.ineligible(),
    hidden: session.hidden.ids(),
    showHidden: session.showHidden,
    zone: session.zone,
    routes: session.routes,
    settled: session.settled,
    selected: session.selected,
    status: session.status,
    flash: session.flash,
    rows: session.screen.rows,
    columns: session.screen.columns,
    graph: session.graphing ? graphOf(session) : undefined
  };
}

function draw(session: Session): void {
  if (session.quitting || session.suspended) return;
  session.screen.write(`${CLEAR}${renderLiveFrame(viewOf(session), session.noColor, session.clock())}`);
}

function redrawOnResize(session: Session): void {
  session.screen.on?.('resize', () => draw(session));
}

function anyPending(session: Session): boolean {
  return session.results.includes(undefined) || session.inFlight.size > 0;
}

function scheduleTick(session: Session): void {
  const delay = anyPending(session) ? PENDING_TICK_MS : SETTLED_TICK_MS;
  session.frameTimer = setTimeout(() => tick(session), delay);
}

function stale(session: Session): boolean {
  return !session.running && Date.parse(session.clock()) - session.endedAt > session.refreshMs;
}

function tick(session: Session): void {
  if (stale(session)) refresh(session);
  session.spinner += 1;
  reprobeAfterReset(session);
  draw(session);
  scheduleTick(session);
}

function notifying(session: Session): boolean {
  return !session.suspended && (session.env['DANDELION_NOTIFY'] ?? '') !== '';
}

function fresh(session: Session, key: string): boolean {
  const isNew = !session.notified.has(key);
  session.notified.add(key);
  return isNew;
}

function eventsOf(session: Session, previous: LiveSlot['usage'], current: LiveSlot['usage']): Notification[] {
  if (!notifying(session) || previous === undefined || current === undefined) return [];
  const now = session.clock();
  return notificationEvents(previous, current, now, nextLocalMidnight(session.zone, now));
}

function announce(session: Session, previous: LiveSlot['usage'], current: LiveSlot['usage']): void {
  for (const { key, text } of eventsOf(session, previous, current)) if (fresh(session, key)) session.notifier.notify(text);
}

function reorder(session: Session): void {
  session.order = orderPanels(session.results, session.sort, session.clock());
}

function settle(session: Session, index: number, usage: LiveSlot['usage']): void {
  announce(session, session.lastGood[index], usage);
  session.results[index] = usage;
  if (usage?.status === 'ok') session.lastGood[index] = usage;
  session.inFlight.delete(index);
  reorder(session);
  draw(session);
}

function endRound(session: Session): void {
  session.running = false;
  session.endedAt = Date.parse(session.clock());
  session.inFlight.clear();
  session.settled = session.results.filter((usage) => usage !== undefined);
  session.history.record(session.settled, session.clock());
  session.snapshot.record(session.settled);
  if (session.quitting) return;
  session.refreshTimer = setTimeout(() => refresh(session), session.refreshMs);
  draw(session);
}

function fetchStatus(session: Session): void {
  void session.statusProbe?.().then((status) => {
    session.status = status;
    draw(session);
  });
}

function startRound(session: Session): void {
  fetchStatus(session);
  session.running = true;
  session.rounds += 1;
  const now = session.clock();
  session.probes.forEach((_, index) => session.inFlight.add(index));
  session.generations = session.generations.map((generation) => generation + 1);
  const settling = session.probes.map(({ probe }, index) => probe(now).then((usage) => settle(session, index, usage)));
  void Promise.allSettled(settling).then(() => endRound(session));
}

function refresh(session: Session): void {
  if (session.running || session.quitting || session.suspended) return;
  clearTimeout(session.refreshTimer);
  startRound(session);
  draw(session);
}

function settlePanel(session: Session, index: number, generation: number, usage: LiveSlot['usage']): void {
  if (session.generations[index] !== generation) return;
  settle(session, index, usage);
  session.settled = session.results.filter((result) => result !== undefined);
  session.snapshot.record(session.settled);
  draw(session);
}

function panelBusy(session: Session, index: number): boolean {
  return session.running === true || session.quitting || session.suspended || session.inFlight.has(index);
}

function refreshAt(session: Session, index: number): void {
  if (index < 0 || panelBusy(session, index)) return;
  session.generations[index] += 1;
  const generation = session.generations[index];
  session.inFlight.add(index);
  void session.probes[index].probe(session.clock()).then((usage) => settlePanel(session, index, generation, usage));
  draw(session);
}

function refreshPanel(session: Session): void {
  refreshAt(session, session.selected);
}

function reprobeAfterReset(session: Session): void {
  const now = session.clock();
  for (const index of dueReprobes(session.results, now, session.reprobed)) {
    if (panelBusy(session, index)) continue;
    for (const resetsAt of passedResets(session.results[index], now)) session.reprobed.add(resetKey(index, resetsAt));
    refreshAt(session, index);
  }
}

function toggleFooter(session: Session): void {
  session.footer = !session.footer;
  draw(session);
}

function isShown(session: Session, index: number): boolean {
  return session.showHidden || !session.hidden.ids().includes(session.probes[index].id);
}

function shownIndexes(session: Session): number[] {
  return session.order.filter((index) => isShown(session, index));
}

function saveView(session: Session): void {
  if (session.view.save({ sort: session.sort, absoluteResets: session.absoluteResets })) return;
  showFlash(session, ROUTE_FLASH, VIEW_NOT_SAVED);
}

function toggleResetTimes(session: Session): void {
  session.absoluteResets = !session.absoluteResets;
  saveView(session);
  draw(session);
}

function cycleSort(session: Session): void {
  session.sort = nextSortOrder(session.sort);
  reorder(session);
  saveView(session);
  draw(session);
}

function toggleCompact(session: Session): void {
  session.compact = !session.compact;
  draw(session);
}

function moveDown(session: Session): void {
  const shown = shownIndexes(session);
  session.selected = shown[shown.indexOf(session.selected) + 1] ?? session.selected;
  draw(session);
}

function moveUp(session: Session): void {
  const shown = shownIndexes(session);
  session.selected = session.selected < 0 ? (shown.at(-1) ?? -1) : (shown[shown.indexOf(session.selected) - 1] ?? session.selected);
  draw(session);
}

function endFlash(session: Session): void {
  session.flash = undefined;
  draw(session);
}

function showFlash(session: Session, index: number, message: string): void {
  clearTimeout(session.flashTimer);
  session.flash = { index, message };
  session.flashTimer = setTimeout(() => endFlash(session), FLASH_MS);
  draw(session);
}

function saveToggle(session: Session, index: number): void {
  if (session.eligibility.toggle(session.probes[index].id)) draw(session);
  else showFlash(session, index, NOT_SAVED);
}

function toggleSettled(session: Session, index: number, usage: LiveSlot['usage']): void {
  if (isRoutable(usage)) saveToggle(session, index);
  else showFlash(session, index, NOT_ROUTABLE);
}

function toggleSelected(session: Session): void {
  const usage = session.results[session.selected];
  if (usage !== undefined) toggleSettled(session, session.selected, usage);
}

function neighbour(session: Session, shown: number[], from: number): number {
  const at = session.order.indexOf(from);
  return shown.find((index) => session.order.indexOf(index) >= at) ?? shown.at(-1) ?? -1;
}

function reselect(session: Session): void {
  const shown = shownIndexes(session);
  if (session.selected < 0 || shown.includes(session.selected)) return;
  session.selected = neighbour(session, shown, session.selected);
}

function toggleHidden(session: Session): void {
  if (session.selected < 0) return;
  const index = session.selected;
  if (!session.hidden.toggle(session.probes[index].id)) {
    showFlash(session, index, HIDDEN_NOT_SAVED);
    return;
  }
  reselect(session);
  draw(session);
}

function toggleShowHidden(session: Session): void {
  session.showHidden = !session.showHidden;
  reselect(session);
  draw(session);
}

function openGraph(session: Session): void {
  if (session.selected < 0) session.selected = shownIndexes(session)[0] ?? 0;
  session.graphing = true;
  draw(session);
}

function closeGraph(session: Session): void {
  session.graphing = false;
  draw(session);
}

function toggleGraph(session: Session): void {
  if (session.graphing) closeGraph(session);
  else openGraph(session);
}

function leave(session: Session): void {
  if (session.graphing) closeGraph(session);
  else quitCleanly(session);
}

function copyOutcome(session: Session, line: string, copied: boolean): void {
  if (!session.quitting) showFlash(session, ROUTE_FLASH, copied ? `copied: ${line}` : COPY_FAILED);
}

function copyLine(session: Session, which: 0 | 1): void {
  const line = currentRouteLines(viewOf(session), session.clock())?.[which];
  if (line === undefined || line === NO_ROUTE) showFlash(session, ROUTE_FLASH, NOTHING_TO_COPY);
  else void session.clipboard.copy(line).then((copied) => copyOutcome(session, line, copied));
}

function copyRoute(session: Session): void {
  copyLine(session, 0);
}

function copyHigh(session: Session): void {
  copyLine(session, 1);
}

function restoreAfterFix(session: Session): void {
  session.suspended = false;
  if (session.quitting) return;
  session.screen.write(ENTER_ALTERNATE);
  session.keyboard.setRawMode(true);
  session.keyboard.resume();
  draw(session);
  refresh(session);
}

function ignoreInterrupt(): void {
  return undefined;
}

async function runForeground(session: Session, launch: Launch): Promise<number | 'missing'> {
  session.suspended = true;
  session.signals.on('SIGINT', ignoreInterrupt);
  session.screen.write(LEAVE_ALTERNATE);
  session.keyboard.setRawMode(false);
  session.keyboard.pause();
  const status = await session.spawner.spawn(launch);
  session.signals.off('SIGINT', ignoreInterrupt);
  restoreAfterFix(session);
  return status;
}

async function runFix(session: Session, fix: Fix): Promise<void> {
  await runForeground(session, { command: fix.command, args: fix.args, env: fix.env ?? {} });
}

async function runLaunch(session: Session, launch: Launch): Promise<void> {
  const status = await runForeground(session, launch);
  if (status === 'missing' && !session.quitting) showFlash(session, ROUTE_FLASH, `${launch.command}: command not found`);
}

function launchLine(session: Session, which: 0 | 1): void {
  const line = currentRouteLines(viewOf(session), session.clock())?.[which];
  if (line === undefined || line === NO_ROUTE) showFlash(session, ROUTE_FLASH, NOTHING_TO_LAUNCH);
  else void runLaunch(session, session.launchOf(line));
}

function launchRoute(session: Session): void {
  launchLine(session, 0);
}

function launchHigh(session: Session): void {
  launchLine(session, 1);
}

function fixSelected(session: Session): void {
  const index = session.selected;
  if (index < 0) return;
  const fix = session.results[index]?.fix;
  if (fix === undefined) showFlash(session, index, NO_FIX);
  else void runFix(session, fix);
}

function quitCleanly(session: Session): void {
  void quit(session, 0);
}

async function stopForeground(session: Session, signal: SignalName): Promise<void> {
  if (session.suspended) await session.spawner.terminate(signal);
}

async function quit(session: Session, code: number, signal: SignalName = 'SIGTERM'): Promise<void> {
  if (session.quitting) return;
  session.quitting = true;
  clearTimeout(session.frameTimer);
  clearTimeout(session.refreshTimer);
  clearTimeout(session.flashTimer);
  session.screen.write(LEAVE_ALTERNATE);
  session.keyboard.setRawMode(false);
  session.keyboard.pause();
  for (const [name, listener] of session.terminators) session.signals.off(name, listener);
  await stopForeground(session, signal);
  await session.stopChildren();
  session.done(code);
}

const TERMINATION_CODES: [SignalName, number][] = [['SIGTERM', 143], ['SIGHUP', 129]];

function listenForTermination(session: Session): void {
  session.terminators = TERMINATION_CODES.map(([name, code]) => [name, () => void quit(session, code, name)]);
  for (const [name, listener] of session.terminators) session.signals.on(name, listener);
}

const KEYS = new Map<string, (session: Session) => unknown>([
  ['r', refresh],
  ['R', refreshPanel],
  ['\r', refreshPanel],
  ['s', cycleSort],
  ['t', toggleResetTimes],
  ['v', toggleCompact],
  ['c', copyRoute],
  ['C', copyHigh],
  ['l', launchRoute],
  ['L', launchHigh],
  ['x', fixSelected],
  ['?', toggleFooter],
  ['q', leave],
  ['\x1b', closeGraph],
  ['g', toggleGraph],
  ['\x03', quitCleanly],
  ['j', moveDown],
  ['\x1b[B', moveDown],
  ['k', moveUp],
  ['\x1b[A', moveUp],
  [' ', toggleSelected],
  ['h', toggleHidden],
  ['H', toggleShowHidden]
]);

const TOKEN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]|[\\s\\S]`, 'gu');

function press(session: Session, chunk: string): void {
  for (const [key] of chunk.matchAll(TOKEN)) {
    if (session.suspended) return;
    KEYS.get(key)?.(session);
  }
}

export function startLive(options: LiveOptions): Promise<number> {
  return new Promise((done) => {
    const session: Session = {
      ...options,
      clock: options.clock ?? wallClock,
      results: options.probes.map(() => undefined),
      lastGood: options.probes.map(() => undefined),
      inFlight: new Set(),
      generations: options.probes.map(() => 0),
      settled: undefined,
      noColor: options.env['NO_COLOR'] !== undefined,
      refreshMs: refreshMsOf(options.env),
      spinner: 0,
      footer: false,
      showHidden: false,
      ...options.view.initial(),
      order: options.probes.map((_, index) => index),
      compact: false,
      rounds: 0,
      endedAt: Number.NaN,
      selected: -1,
      graphing: false,
      notified: new Set(),
      reprobed: new Set(),
      quitting: false,
      suspended: false,
      terminators: [],
      done
    };
    listenForTermination(session);
    options.screen.write(ENTER_ALTERNATE);
    options.keyboard.setRawMode(true);
    options.keyboard.setEncoding('utf8');
    options.keyboard.on('data', (chunk) => press(session, chunk));
    redrawOnResize(session);
    draw(session);
    startRound(session);
    scheduleTick(session);
  });
}
