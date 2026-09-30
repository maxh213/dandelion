import type { ProviderProbe } from '../probes/index.ts';
import { NO_ROUTE, ROUTE_FLASH, currentRouteLines, isRoutable, nextLocalMidnight, notificationEvents, renderLiveFrame, type Eligibility, type Flash, type Hidden, type History, type LiveSlot, type LiveView, type Notification, type Routes } from '../render/index.ts';

export interface Screen {
  write(text: string): unknown;
  rows?: number;
  on?(event: 'resize', listener: () => void): unknown;
}

export interface Notifier {
  notify(text: string): unknown;
}

export interface Clipboard {
  copy(text: string): Promise<boolean>;
}

export interface Keyboard {
  setRawMode(raw: boolean): unknown;
  setEncoding(encoding: 'utf8'): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  pause(): unknown;
}

type LiveOptions = {
  probes: ProviderProbe[];
  env: Record<string, string | undefined>;
  screen: Screen;
  keyboard: Keyboard;
  stopChildren(): Promise<void>;
  eligibility: Eligibility;
  hidden: Hidden;
  history: History;
  routes: Routes;
  zone: string;
  notifier: Notifier;
  clipboard: Clipboard;
  clock?: () => string;
};

type Timer = ReturnType<typeof setTimeout>;

type SettledRound = NonNullable<LiveSlot['usage']>[];

type Session = LiveOptions & {
  clock: () => string;
  results: LiveSlot['usage'][];
  inFlight: Set<number>;
  generations: number[];
  settled: SettledRound | undefined;
  noColor: boolean;
  refreshMs: number;
  spinner: number;
  footer: boolean;
  showHidden: boolean;
  absoluteResets: boolean;
  running?: boolean;
  rounds: number;
  quitting: boolean;
  selected: number;
  graphing: boolean;
  notified: Set<string>;
  flash?: Flash;
  frameTimer?: Timer;
  refreshTimer?: Timer;
  flashTimer?: Timer;
  done(): void;
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
const DIGITS_ONLY = /^\d+$/;
const NOT_ROUTABLE = 'not routable (no usage windows)';
const NOT_SAVED = 'routing state not saved';
const HIDDEN_NOT_SAVED = 'hidden state not saved';
const NOTHING_TO_COPY = 'nothing to copy';
const COPY_FAILED = 'copy failed';

function refreshSecondsOf(raw: string): number {
  const seconds = DIGITS_ONLY.test(raw) ? Number(raw) : 0;
  return seconds > 0 ? seconds : DEFAULT_REFRESH_SECONDS;
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
    slots: session.probes.map(({ id }, index) => ({ id, usage: session.results[index], probing: session.inFlight.has(index) })),
    spinner: session.spinner,
    refreshing: session.running === true && session.rounds > 1,
    footer: session.footer,
    absoluteResets: session.absoluteResets,
    ineligible: session.eligibility.ineligible(),
    hidden: session.hidden.ids(),
    showHidden: session.showHidden,
    zone: session.zone,
    routes: session.routes,
    settled: session.settled,
    selected: session.selected,
    flash: session.flash,
    rows: session.screen.rows,
    graph: session.graphing ? graphOf(session) : undefined
  };
}

function draw(session: Session): void {
  if (session.quitting) return;
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

function tick(session: Session): void {
  session.spinner += 1;
  draw(session);
  scheduleTick(session);
}

function notifying(session: Session): boolean {
  return (session.env['DANDELION_NOTIFY'] ?? '') !== '';
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

function settle(session: Session, index: number, usage: LiveSlot['usage']): void {
  announce(session, session.results[index], usage);
  session.results[index] = usage;
  session.inFlight.delete(index);
  draw(session);
}

function endRound(session: Session): void {
  session.running = false;
  session.inFlight.clear();
  session.settled = session.results.filter((usage) => usage !== undefined);
  session.history.record(session.settled, session.clock());
  if (session.quitting) return;
  session.refreshTimer = setTimeout(() => refresh(session), session.refreshMs);
  draw(session);
}

function startRound(session: Session): void {
  session.running = true;
  session.rounds += 1;
  const now = session.clock();
  session.probes.forEach((_, index) => session.inFlight.add(index));
  session.generations = session.generations.map((generation) => generation + 1);
  const settling = session.probes.map(({ probe }, index) => probe(now).then((usage) => settle(session, index, usage)));
  void Promise.allSettled(settling).then(() => endRound(session));
}

function refresh(session: Session): void {
  if (session.running || session.quitting) return;
  clearTimeout(session.refreshTimer);
  startRound(session);
  draw(session);
}

function settlePanel(session: Session, index: number, generation: number, usage: LiveSlot['usage']): void {
  if (session.generations[index] !== generation) return;
  settle(session, index, usage);
  session.settled = session.results.filter((result) => result !== undefined);
  draw(session);
}

function panelBusy(session: Session, index: number): boolean {
  return session.running === true || session.quitting || session.inFlight.has(index);
}

function refreshPanel(session: Session): void {
  const index = session.selected;
  if (index < 0 || panelBusy(session, index)) return;
  session.generations[index] += 1;
  const generation = session.generations[index];
  session.inFlight.add(index);
  void session.probes[index].probe(session.clock()).then((usage) => settlePanel(session, index, generation, usage));
  draw(session);
}

function toggleFooter(session: Session): void {
  session.footer = !session.footer;
  draw(session);
}

function isShown(session: Session, index: number): boolean {
  return session.showHidden || !session.hidden.ids().includes(session.probes[index].id);
}

function shownIndexes(session: Session): number[] {
  return session.probes.map((_, index) => index).filter((index) => isShown(session, index));
}

function toggleResetTimes(session: Session): void {
  session.absoluteResets = !session.absoluteResets;
  draw(session);
}

function moveDown(session: Session): void {
  session.selected = shownIndexes(session).find((index) => index > session.selected) ?? session.selected;
  draw(session);
}

function moveUp(session: Session): void {
  const before = shownIndexes(session).filter((index) => index < session.selected);
  session.selected = session.selected < 0 ? (shownIndexes(session).at(-1) ?? -1) : (before.at(-1) ?? session.selected);
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

function neighbour(shown: number[], from: number): number {
  return shown.find((index) => index > from) ?? shown.at(-1) ?? -1;
}

function reselect(session: Session): void {
  const shown = shownIndexes(session);
  if (session.selected < 0 || shown.includes(session.selected)) return;
  session.selected = neighbour(shown, session.selected);
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
  session.selected = Math.max(0, session.selected);
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
  else void quit(session);
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

async function quit(session: Session): Promise<void> {
  if (session.quitting) return;
  session.quitting = true;
  clearTimeout(session.frameTimer);
  clearTimeout(session.refreshTimer);
  clearTimeout(session.flashTimer);
  session.screen.write(LEAVE_ALTERNATE);
  session.keyboard.setRawMode(false);
  session.keyboard.pause();
  await session.stopChildren();
  session.done();
}

const KEYS = new Map<string, (session: Session) => unknown>([
  ['r', refresh],
  ['R', refreshPanel],
  ['\r', refreshPanel],
  ['t', toggleResetTimes],
  ['c', copyRoute],
  ['C', copyHigh],
  ['?', toggleFooter],
  ['q', leave],
  ['\x1b', closeGraph],
  ['g', toggleGraph],
  ['\x03', quit],
  ['j', moveDown],
  ['\x1b[B', moveDown],
  ['k', moveUp],
  ['\x1b[A', moveUp],
  [' ', toggleSelected],
  ['h', toggleHidden],
  ['H', toggleShowHidden]
]);

function keysOf(chunk: string): string[] {
  return chunk.startsWith('\x1b') ? [] : [...chunk];
}

function press(session: Session, chunk: string): void {
  const whole = KEYS.get(chunk);
  if (whole) {
    whole(session);
    return;
  }
  for (const key of keysOf(chunk)) KEYS.get(key)?.(session);
}

export function startLive(options: LiveOptions): Promise<void> {
  return new Promise((done) => {
    const session: Session = {
      ...options,
      clock: options.clock ?? wallClock,
      results: options.probes.map(() => undefined),
      inFlight: new Set(),
      generations: options.probes.map(() => 0),
      settled: undefined,
      noColor: options.env['NO_COLOR'] !== undefined,
      refreshMs: refreshMsOf(options.env),
      spinner: 0,
      footer: false,
      showHidden: false,
      absoluteResets: false,
      rounds: 0,
      selected: -1,
      graphing: false,
      notified: new Set(),
      quitting: false,
      done
    };
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
