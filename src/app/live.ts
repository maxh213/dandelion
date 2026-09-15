import type { ProviderProbe } from '../probes/index.ts';
import { isRoutable, renderLiveFrame, type Eligibility, type Flash, type LiveSlot, type LiveView } from '../render/index.ts';

export type Screen = { write(text: string): unknown };

export type Keyboard = {
  setRawMode(raw: boolean): unknown;
  setEncoding(encoding: 'utf8'): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  pause(): unknown;
};

type LiveOptions = {
  probes: ProviderProbe[];
  env: Record<string, string | undefined>;
  screen: Screen;
  keyboard: Keyboard;
  stopChildren(): Promise<void>;
  eligibility: Eligibility;
  zone: string;
};

type Timer = ReturnType<typeof setTimeout>;

type SettledRound = NonNullable<LiveSlot['usage']>[];

type Session = LiveOptions & {
  results: LiveSlot['usage'][];
  settled: SettledRound | undefined;
  noColor: boolean;
  refreshMs: number;
  spinner: number;
  footer: boolean;
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

const ENTER_ALTERNATE = '\x1b[?1049h\x1b[?25l';
const CLEAR = '\x1b[H\x1b[2J';
const LEAVE_ALTERNATE = '\x1b[?25h\x1b[?1049l';
const PENDING_TICK_MS = 100;
const SETTLED_TICK_MS = 1000;
const FLASH_MS = 2000;
const DEFAULT_REFRESH_SECONDS = 300;
const DIGITS_ONLY = /^\d+$/;
const NOT_ROUTABLE = 'not routable (no usage windows)';
const NOT_SAVED = 'routing state not saved';

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
    ineligible: session.eligibility.ineligible(),
    zone: session.zone,
    settled: session.settled,
    selected: session.selected,
    flash: session.flash
  };
}

function draw(session: Session): void {
  if (session.quitting) return;
  session.screen.write(`${CLEAR}${renderLiveFrame(viewOf(session), session.noColor, new Date().toISOString())}`);
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
  const now = new Date().toISOString();
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

function moveDown(session: Session): void {
  session.selected = Math.min(session.probes.length - 1, session.selected + 1);
  draw(session);
}

function moveUp(session: Session): void {
  session.selected = session.selected < 0 ? session.probes.length - 1 : Math.max(0, session.selected - 1);
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
  ['?', toggleFooter],
  ['q', quit],
  ['\x03', quit],
  ['j', moveDown],
  ['\x1b[B', moveDown],
  ['k', moveUp],
  ['\x1b[A', moveUp],
  [' ', toggleSelected]
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
      results: options.probes.map(() => undefined),
      settled: undefined,
      noColor: options.env['NO_COLOR'] !== undefined,
      refreshMs: refreshMsOf(options.env),
      spinner: 0,
      footer: false,
      rounds: 0,
      selected: -1,
      quitting: false,
      done
    };
    options.screen.write(ENTER_ALTERNATE);
    options.keyboard.setRawMode(true);
    options.keyboard.setEncoding('utf8');
    options.keyboard.on('data', (chunk) => press(session, chunk));
    draw(session);
    startRound(session);
    scheduleTick(session);
  });
}
