import type { ProviderProbe } from '../probes/index.ts';
import { isRoutable, renderLiveFrame, type Eligibility, type Flash, type Hidden, type LiveSlot, type LiveView, type Routes } from '../render/index.ts';

export interface Screen {
  write(text: string): unknown;
  rows?: number;
  on?(event: 'resize', listener: () => void): unknown;
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
  routes: Routes;
  zone: string;
  clock?: () => string;
};

type Timer = ReturnType<typeof setTimeout>;

type SettledRound = NonNullable<LiveSlot['usage']>[];

type Session = LiveOptions & {
  clock: () => string;
  results: LiveSlot['usage'][];
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

function refreshSecondsOf(raw: string): number {
  const seconds = DIGITS_ONLY.test(raw) ? Number(raw) : 0;
  return seconds > 0 ? seconds : DEFAULT_REFRESH_SECONDS;
}

function refreshMsOf(env: Record<string, string | undefined>): number {
  return refreshSecondsOf(String(env['DANDELION_REFRESH_SECONDS'])) * 1000;
}

function viewOf(session: Session): LiveView {
  return {
    slots: session.probes.map(({ id }, index) => ({ id, usage: session.results[index] })),
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
    rows: session.screen.rows
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
  return session.results.includes(undefined);
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

function settle(session: Session, index: number, usage: LiveSlot['usage']): void {
  session.results[index] = usage;
  draw(session);
}

function endRound(session: Session): void {
  session.running = false;
  session.settled = session.results.filter((usage) => usage !== undefined);
  if (session.quitting) return;
  session.refreshTimer = setTimeout(() => refresh(session), session.refreshMs);
  draw(session);
}

function startRound(session: Session): void {
  session.running = true;
  session.rounds += 1;
  const now = session.clock();
  const settling = session.probes.map(({ probe }, index) => probe(now).then((usage) => settle(session, index, usage)));
  void Promise.allSettled(settling).then(() => endRound(session));
}

function refresh(session: Session): void {
  if (session.running || session.quitting) return;
  clearTimeout(session.refreshTimer);
  startRound(session);
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
  ['t', toggleResetTimes],
  ['?', toggleFooter],
  ['q', quit],
  ['\x03', quit],
  ['j', moveDown],
  ['\x1b[B', moveDown],
  ['k', moveUp],
  ['\x1b[A', moveUp],
  [' ', toggleSelected],
  ['h', toggleHidden],
  ['H', toggleShowHidden]
]);

function press(session: Session, chunk: string): void {
  const whole = KEYS.get(chunk);
  if (whole) {
    whole(session);
    return;
  }
  for (const key of chunk) KEYS.get(key)?.(session);
}

export function startLive(options: LiveOptions): Promise<void> {
  return new Promise((done) => {
    const session: Session = {
      ...options,
      clock: options.clock ?? wallClock,
      results: options.probes.map(() => undefined),
      settled: undefined,
      noColor: options.env['NO_COLOR'] !== undefined,
      refreshMs: refreshMsOf(options.env),
      spinner: 0,
      footer: false,
      showHidden: false,
      absoluteResets: false,
      rounds: 0,
      selected: -1,
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
