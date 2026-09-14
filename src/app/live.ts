import type { ProviderProbe } from '../probes/index.ts';
import { renderLiveFrame, type LiveSlot, type LiveView } from '../render/index.ts';

export type Screen = { write(text: string): unknown };

export type Keyboard = {
  setRawMode(raw: boolean): unknown;
  setEncoding(encoding: 'utf8'): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  pause(): unknown;
};

export type LiveOptions = {
  probes: ProviderProbe[];
  env: Record<string, string | undefined>;
  screen: Screen;
  keyboard: Keyboard;
  stopChildren(): Promise<void>;
};

type Timer = ReturnType<typeof setTimeout>;

type Session = LiveOptions & {
  results: LiveSlot['usage'][];
  noColor: boolean;
  refreshMs: number;
  spinner: number;
  footer: boolean;
  running: boolean;
  rounds: number;
  quitting: boolean;
  frameTimer?: Timer;
  refreshTimer?: Timer;
  done(): void;
};

const ENTER_ALTERNATE = '\x1b[?1049h\x1b[?25l';
const CLEAR = '\x1b[H\x1b[2J';
const LEAVE_ALTERNATE = '\x1b[?25h\x1b[?1049l';
const PENDING_TICK_MS = 100;
const SETTLED_TICK_MS = 1000;
const DEFAULT_REFRESH_SECONDS = 300;
const DIGITS_ONLY = /^\d+$/;

function refreshSecondsOf(raw: string): number {
  const seconds = DIGITS_ONLY.test(raw) ? Number(raw) : 0;
  return seconds > 0 ? seconds : DEFAULT_REFRESH_SECONDS;
}

function refreshMsOf(env: Record<string, string | undefined>): number {
  return refreshSecondsOf(String(env['ALLOWANCE_REFRESH_SECONDS'])) * 1000;
}

function viewOf(session: Session): LiveView {
  return {
    slots: session.probes.map(({ id }, index) => ({ id, usage: session.results[index] })),
    spinner: session.spinner,
    refreshing: session.running && session.rounds > 1,
    footer: session.footer
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
  if (session.running) return;
  clearTimeout(session.refreshTimer);
  startRound(session);
  draw(session);
}

function toggleFooter(session: Session): void {
  session.footer = !session.footer;
  draw(session);
}

async function quit(session: Session): Promise<void> {
  if (session.quitting) return;
  session.quitting = true;
  clearTimeout(session.frameTimer);
  clearTimeout(session.refreshTimer);
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
  ['\x03', quit]
]);

function press(session: Session, chunk: string): void {
  for (const key of chunk) KEYS.get(key)?.(session);
}

export function startLive(options: LiveOptions): Promise<void> {
  return new Promise((done) => {
    const session: Session = {
      ...options,
      results: options.probes.map(() => undefined),
      noColor: options.env['NO_COLOR'] !== undefined,
      refreshMs: refreshMsOf(options.env),
      spinner: 0,
      footer: false,
      running: false,
      rounds: 0,
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
