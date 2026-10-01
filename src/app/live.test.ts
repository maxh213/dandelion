import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProbe } from '../probes/index.ts';
import { openEligibility, openHidden, openHistory, openUsageSnapshot, openView, renderRoute, type ClaudeStatus, type Routes } from '../render/index.ts';
import { launchOf } from './launch.ts';
import { startLive, type CopyResult } from './live.ts';

const LINES = {
  route: {
    claude: { standard: 'model-a high', max: 'model-a max' },
    'claude-work': { standard: 'model-a high', max: 'model-a max' },
    'claude-deepseek': { standard: 'vendor/model-o max', max: 'vendor/model-o max' },
    agy: { standard: 'model-c high', max: 'model-c max' },
    kimi: { standard: 'model-d max', max: 'model-d max' },
    grok: { standard: 'model-e xhigh', max: 'model-e xhigh' },
    cursor: { standard: 'model-f', max: 'model-f' },
    junie: { standard: 'model-g high', max: 'model-g high' },
    hermes: { standard: 'vendor/model-h xhigh', max: 'vendor/model-h xhigh' }
  },
  high: { fable: 'model-h1 max', cursor: 'model-f', opus: 'model-a max', grok: 'model-e xhigh', agy: 'model-c high' }
};

type Usage = Awaited<ReturnType<ProviderProbe['probe']>>;
type PendingCall = { now: string; resolve(usage: Usage): void; reject(error: Error): void };

const START = '2026-09-13T10:00:00.000Z';
const CLEAR = '\x1b[H\x1b[2J\x1b[0m';
const ENTER_ALTERNATE = '\x1b[?1049h\x1b[?25l';
const LEAVE_ALTERNATE = '\x1b[?25h\x1b[?1049l';
const SPINNING = /^\S+ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/;
const IDS = ['claude', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];

function usageOf(id: string, fetchedAt: string): Usage {
  return { id, displayName: id, planLabel: 'plan', windows: [{ label: 'weekly', kind: 'weekly', usedPct: 10 }], fetchedAt, status: 'ok' };
}

function deferredProbe(id: string, writes: string[]) {
  const calls: (PendingCall & { framesBefore: number })[] = [];
  const probe: ProviderProbe = {
    id,
    probe: (now) => new Promise((resolve, reject) => calls.push({ now, resolve, reject, framesBefore: writes.length }))
  };
  return { probe, calls };
}

type SessionOverrides = {
  env?: Record<string, string | undefined>;
  stopChildren?: () => Promise<void>;
  state?: Record<string, unknown>;
  zone?: string;
  rows?: number;
  columns?: number;
  hiddenText?: string;
  hiddenSaves?: boolean[];
  viewText?: string;
  viewSaves?: boolean[];
  historyText?: string;
  historyWrites?: boolean;
  snapshotWrites?: boolean;
  snapshotText?: string;
  notifier?: { notify(text: string): unknown };
  copy?: (text: string) => Promise<CopyResult>;
  ids?: string[];
  spawn?: () => Promise<number | 'missing'>;
  routes?: Routes;
  statusProbe?: () => Promise<ClaudeStatus | undefined>;
};

function startSession(overrides: SessionOverrides = {}) {
  const { ids, env, stopChildren, state, zone, rows, columns, hiddenText, hiddenSaves, viewText, viewSaves, historyText, historyWrites, snapshotWrites, snapshotText, notifier, copy, spawn, routes, statusProbe } = { ids: IDS, spawn: async () => 0, notifier: { notify: vi.fn() }, routes: { lines: LINES }, copy: async (): Promise<CopyResult> => 'command', historyText: '[]', historyWrites: true, snapshotWrites: true, env: { NO_COLOR: '1' }, stopChildren: vi.fn(async () => undefined), state: {}, zone: 'UTC', rows: 60, ...overrides };
  const clipboard = { copy: vi.fn(copy) };
  const spawner = { spawn: vi.fn(spawn), terminate: vi.fn<(signal: string) => Promise<void>>(async () => undefined) };
  const writes: string[] = [];
  const probes = ids.map((id) => deferredProbe(id, writes));
  const keyboard = Object.assign(new EventEmitter(), { setRawMode: vi.fn(), setEncoding: vi.fn(), pause: vi.fn(), resume: vi.fn() });
  const screen = Object.assign(new EventEmitter(), { rows, columns, write: (text: string) => writes.push(text) });
  const disk = { text: JSON.stringify(state) };
  const replace = vi.fn<(path: string, text: string) => boolean>((_path, text) => {
    disk.text = text;
    return true;
  });
  const stateReads = vi.fn<() => string>(() => disk.text);
  const eligibility = openEligibility({}, '/home/u', { read: stateReads, replace });
  const historyReplace = vi.fn<(path: string, text: string) => boolean>(() => historyWrites);
  const history = openHistory({}, '/home/u', { read: () => historyText, replace: historyReplace });
  const snapshotReplace = vi.fn<(path: string, text: string) => boolean>(() => snapshotWrites);
  const snapshot = openUsageSnapshot({ DANDELION_STATE_FILE: '/s/eligibility.json' }, '/home/u', { read: () => snapshotText ?? '[]', replace: snapshotReplace });
  const snapshotSaved = () => snapshotReplace.mock.calls.map(([path, text]) => ({ path, entries: JSON.parse(text) }));
  const saved = () => replace.mock.calls.map(([, text]) => JSON.parse(text));
  const hiddenReplace = vi.fn<(path: string, text: string) => boolean>(() => hiddenSaves?.shift() ?? true);
  const hidden = openHidden({ DANDELION_STATE_FILE: '/s/eligibility.json' }, '/home/u', {
    read: () => {
      if (hiddenText === undefined) throw new Error('ENOENT');
      return hiddenText;
    },
    replace: hiddenReplace
  });
  const hiddenSaved = () => hiddenReplace.mock.calls.map(([, text]) => JSON.parse(text));
  const registered: [string, () => void][] = [];
  const handlersFor = (name: string) => registered.filter(([event]) => event === name).map(([, listener]) => listener);
  const handlers = { get length() { return handlersFor('SIGINT').length; } };
  const signals = { on: vi.fn((event: string, listener: () => void) => registered.push([event, listener])), off: vi.fn((event: string, listener: () => void) => registered.splice(registered.findIndex(([name, handler]) => name === event && handler === listener), 1)) };
  const interrupt = () => handlersFor('SIGINT').forEach((handler) => handler());
  const deliver = (name: string) => handlersFor(name).forEach((handler) => handler());
  const viewReplace = vi.fn<(path: string, text: string) => boolean>(() => viewSaves?.shift() ?? true);
  const view = openView({ DANDELION_STATE_FILE: '/s/eligibility.json' }, '/home/u', {
    read: () => {
      if (viewText === undefined) throw new Error('ENOENT');
      return viewText;
    },
    replace: viewReplace
  });
  const viewSaved = () => viewReplace.mock.calls.map(([, text]) => JSON.parse(text));
  const finished = startLive({ probes: probes.map(({ probe }) => probe), env, launchOf: (line) => launchOf(line, [], env, '/home/u'), keyboard, signals, screen, stopChildren, eligibility, hidden, view, history, snapshot, routes, zone, notifier, clipboard, spawner, statusProbe });
  const frames = () => writes.filter((text) => text.startsWith(CLEAR)).map((text) => text.slice(CLEAR.length));
  const settleRound = async (round: number, overrides: Record<string, Usage> = {}) => {
    probes.forEach(({ probe, calls }) => calls[round].resolve(overrides[probe.id] ?? usageOf(probe.id, calls[round].now)));
    await vi.advanceTimersByTimeAsync(0);
  };
  return { disk, stateReads, notifier, clipboard, spawner, handlers, handlersFor, deliver, signals, interrupt, writes, probes, keyboard, screen, finished, frames, stopChildren, replace, saved, hiddenReplace, hiddenSaved, viewReplace, viewSaved, historyReplace, snapshotReplace, snapshotSaved, settleRound, lastFrame: () => frames().at(-1) ?? '', press: (key: string) => keyboard.emit('data', key) };
}

const TAG = (lead: string) => `${lead}${' '.repeat(72 - [...lead].length - 11)}routing off`;
const NO_WINDOWS: Usage = { id: 'kilo', displayName: 'kilo', planLabel: 'plan', windows: [], fetchedAt: START, status: 'ok' };

function lineAfter(frame: string, header: string, offset: number): string | undefined {
  const lines = frame.split('\n');
  return lines[lines.indexOf(header) + offset];
}

function markedHeaders(frame: string): string[] {
  return frame.split('\n').filter((line) => line.startsWith('▸ '));
}

describe('live session', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(START));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enters the alternate screen in raw mode and draws seven pending panels before any probe starts', async () => {
    const session = startSession();
    expect(session.writes[0]).toBe(ENTER_ALTERNATE);
    expect(session.keyboard.setRawMode).toHaveBeenCalledWith(true);
    expect(session.keyboard.setEncoding).toHaveBeenCalledWith('utf8');
    expect(session.probes.map(({ calls }) => calls.map((call) => [call.now, call.framesBefore]))).toEqual(IDS.map(() => [[START, 2]]));
    const lines = session.lastFrame().split('\n');
    expect(lines.slice(0, 2)).toEqual(['DANDELION'.padEnd(64) + '10:00:00', 'all windows below 80% · next reset: none']);
    expect(lines.slice(6)).toEqual(IDS.flatMap((id) => ['='.repeat(72), id, '⠋ probing…']));
    session.press('q');
    await session.finished;
  });

  it('resets the style after clearing the screen before the banner of every frame', async () => {
    const session = startSession();
    await vi.advanceTimersByTimeAsync(100);
    const drawn = session.writes.filter((text) => text.startsWith('\x1b[H\x1b[2J'));
    expect(drawn.length).toBeGreaterThan(1);
    expect(drawn.every((text) => text.indexOf('\x1b[0m') < text.indexOf('DANDELION'))).toBe(true);
    expect(drawn.every((text) => text.startsWith('\x1b[H\x1b[2J\x1b[0m'))).toBe(true);
    session.press('q');
    await session.finished;
  });

  it('draws a frame every 100ms while a panel is pending and advances the spinner each time', async () => {
    const session = startSession();
    await vi.advanceTimersByTimeAsync(99);
    expect(session.frames()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.frames()).toHaveLength(2);
    expect(session.lastFrame()).toContain('\n⠙ probing…');
    await vi.advanceTimersByTimeAsync(900);
    expect(session.frames()).toHaveLength(11);
    expect(session.lastFrame()).toContain('\n⠋ probing…');
    session.press('q');
    await session.finished;
  });

  it('fills each panel at once as it settles while the others stay pending', async () => {
    const session = startSession();
    session.probes[1].calls[0].resolve(usageOf('agy', START));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.frames()).toHaveLength(2);
    const lines = session.lastFrame().split('\n');
    expect(lines.slice(10, 14)).toEqual(['agy', `${'weekly'.padEnd(35)} ##------------------  10%`, 'plan · agy · 0h0m ago', '='.repeat(72)]);
    expect(lines.filter((line) => line === '⠋ probing…')).toHaveLength(6);
    expect(lines[0]).toBe('DANDELION'.padEnd(48) + 'data 0h0m old · 10:00:00');
    session.press('q');
    await session.finished;
  });

  it('draws every 1000ms once nothing is pending so the clock keeps moving', async () => {
    const session = startSession();
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(100);
    const count = session.frames().length;
    await vi.advanceTimersByTimeAsync(999);
    expect(session.frames()).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.frames()).toHaveLength(count + 1);
    expect(session.lastFrame().split('\n')[0]).toBe('DANDELION'.padEnd(48) + 'data 0h0m old · 10:00:01');
    expect(session.lastFrame()).not.toContain('probing…');
    session.press('q');
    await session.finished;
  });

  it('starts the next round after the interval, keeps the data and marks the banner until it settles', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' } });
    await session.settleRound(0);
    expect(session.lastFrame().split('\n')[0]).not.toContain('refreshing…');
    await vi.advanceTimersByTimeAsync(999);
    expect(session.probes[0].calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
    expect(session.probes[0].calls[1].now).toBe('2026-09-13T10:00:01.000Z');
    expect(session.lastFrame().split('\n')[0]).toBe('DANDELION'.padEnd(34) + 'refreshing… · data 0h0m old · 10:00:01');
    expect(session.lastFrame()).not.toContain('probing…');
    await session.settleRound(1);
    expect(session.lastFrame().split('\n')[0]).toBe('DANDELION'.padEnd(48) + 'data 0h0m old · 10:00:01');
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.probes[0].calls).toHaveLength(3);
    session.press('q');
    await session.finished;
  });

  it('keeps each panel on its previous windows with a spinner after its name until its own probe settles', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' } });
    await session.settleRound(0);
    expect(session.lastFrame().split('\n')).not.toContainEqual(expect.stringMatching(SPINNING));
    await vi.advanceTimersByTimeAsync(1000);
    const during = session.lastFrame().split('\n');
    expect(during.filter((line) => SPINNING.test(line))).toHaveLength(IDS.length);
    expect(during.filter((line) => line.startsWith('weekly'))).toHaveLength(IDS.length);
    expect(session.lastFrame()).not.toContain('probing…');
    const [claude] = session.probes;
    claude.calls[1].resolve(usageOf('claude', claude.calls[1].now));
    await vi.advanceTimersByTimeAsync(0);
    const partly = session.lastFrame().split('\n');
    expect(partly).toContain('claude');
    expect(partly.filter((line) => SPINNING.test(line))).toHaveLength(IDS.length - 1);
    await session.settleRound(1, {});
    expect(session.lastFrame().split('\n').filter((line) => SPINNING.test(line))).toEqual([]);
    session.press('q');
    await session.finished;
  });

  it('ends the spinner of a slot whose probe rejects when its round ends', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' } });
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(1000);
    session.probes.slice(1).forEach(({ probe, calls }) => calls[1].resolve(usageOf(probe.id, calls[1].now)));
    session.probes[0].calls[1].reject(new Error('boom'));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.lastFrame().split('\n').filter((line) => SPINNING.test(line))).toEqual([]);
    session.press('q');
    await session.finished;
  });

  it('ends each panel caption with its data age counted from its own fetch time', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '3600' } });
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(181000);
    const captions = session.lastFrame().split('\n').filter((line) => line.startsWith('plan · '));
    expect(captions).toEqual(IDS.map((id) => `plan · ${id} · 0h3m ago`));
    session.press('q');
    await session.finished;
  });

  it('keeps counting the data age from the oldest result while a refresh is partly settled', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '60' } });
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(60000);
    session.probes.slice(1).forEach(({ probe, calls }) => calls[1].resolve(usageOf(probe.id, calls[1].now)));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.lastFrame().split('\n')[0]).toBe('DANDELION'.padEnd(34) + 'refreshing… · data 0h1m old · 10:01:00');
    session.press('q');
    await session.finished;
  });

  it('schedules the next round 2147483000 ms out for the largest accepted value', async () => {
    const delays: unknown[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, delay?: number, ...rest: unknown[]) => {
      delays.push(delay);
      return real(handler, delay, ...rest);
    }) as typeof setTimeout);
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '2147483' } });
    await session.settleRound(0);
    expect(delays).toContain(2147483000);
    session.press('q');
    await session.finished;
    vi.restoreAllMocks();
  });

  it.each<[string | undefined, number]>([
    [undefined, 300],
    ['', 300],
    ['0', 300],
    ['-5', 300],
    ['2.5', 300],
    ['abc', 300],
    ['7', 7],
    ['99999999', 300],
    ['2147484', 300]
  ])('starts the next automatic round %j seconds after the first settles -> %i', async (value, seconds) => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: value } });
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
    expect(session.probes[4].calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.probes[4].calls).toHaveLength(2);
    session.press('q');
    await session.finished;
  });

  it('starts a round at the next frame tick when the clock jumped past the refresh interval since the last round ended', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '60' } });
    await session.settleRound(0);
    vi.setSystemTime(new Date(Date.parse(START) + 7200000));
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
    expect(session.probes[0].calls[1].now).toBe('2026-09-13T12:00:00.100Z');
    session.press('q');
    await session.finished;
  });

  it('leaves exactly one refresh timer after the catch-up round and counts the next interval from its end', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '60' } });
    await session.settleRound(0);
    vi.setSystemTime(new Date(Date.parse(START) + 7200000));
    await vi.advanceTimersByTimeAsync(1000);
    await session.settleRound(1);
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(59999);
    expect(session.probes[0].calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.probes[0].calls).toHaveLength(3);
    session.press('q');
    await session.finished;
  });

  it('starts no extra round when the clock advanced less than the refresh interval since the last round ended', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '3600' } });
    await session.settleRound(0);
    vi.setSystemTime(new Date(Date.parse(START) + 3598000));
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 1));
    session.press('q');
    await session.finished;
  });

  it('starts no second round while a round is still running even when the clock jumped', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '60' } });
    await session.settleRound(0);
    session.press('r');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
    vi.setSystemTime(new Date(Date.parse(START) + 7200000));
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
    session.press('q');
    await session.finished;
  });

  describe.each([
    ['the r key', async (session: ReturnType<typeof startSession>) => session.press('r')],
    ['the refresh timer', async () => vi.advanceTimersByTimeAsync(60000)]
  ])('a full round started by %s during an R re-probe', (_name, begin) => {
    it('reuses the in-flight probe, shows its result and ends once', async () => {
      const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '60' } });
      await session.settleRound(0);
      session.press('j');
      session.press('R');
      expect(session.probes[0].calls).toHaveLength(2);
      await begin(session);
      expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
      session.probes.slice(1).forEach(({ probe, calls }) => calls[1].resolve(usageOf(probe.id, calls[1].now)));
      await vi.advanceTimersByTimeAsync(0);
      const recorded = session.historyReplace.mock.calls.length;
      session.probes[0].calls[1].resolve({ ...usageOf('claude', START), windows: [{ label: 'weekly', kind: 'weekly', usedPct: 77 }] });
      await vi.advanceTimersByTimeAsync(0);
      expect(session.lastFrame()).toContain('77%');
      expect(session.historyReplace).toHaveBeenCalledTimes(recorded + 1);
      await vi.advanceTimersByTimeAsync(59000);
      expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
      await vi.advanceTimersByTimeAsync(1000);
      expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 3));
      session.press('q');
      await session.finished;
    });
  });

  it('ends a round even when a probe rejects', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' } });
    session.probes[0].calls[0].reject(new Error('boom'));
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.probes[1].calls).toHaveLength(2);
    session.press('q');
    await session.finished;
  });

  it('records one sample per window into the history after each settled round', async () => {
    const session = startSession();
    expect(session.historyReplace).not.toHaveBeenCalled();
    await session.settleRound(0);
    expect(session.historyReplace).toHaveBeenCalledTimes(1);
    const samples = JSON.parse(session.historyReplace.mock.calls[0][1]);
    expect(samples).toHaveLength(IDS.length);
    expect(samples[0]).toEqual({ id: 'claude', slot: 0, label: 'weekly', usedPct: 10, at: START });
    session.press('q');
    await session.finished;
  });

  it('writes the settled results to snapshot.json next to the state file after each round and each single-panel re-probe', async () => {
    const session = startSession();
    expect(session.snapshotReplace).not.toHaveBeenCalled();
    await session.settleRound(0);
    expect(session.snapshotSaved()).toHaveLength(1);
    const [{ path, entries }] = session.snapshotSaved();
    expect(path).toBe('/s/snapshot.json');
    expect(entries).toEqual(IDS.map((id) => usageOf(id, START)));
    session.press('j');
    session.press('R');
    session.probes[0].calls[1].resolve({ ...usageOf('claude', START), windows: [{ label: 'weekly', kind: 'weekly', usedPct: 55 }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshotSaved()).toHaveLength(2);
    expect(session.snapshotSaved()[1].entries).toHaveLength(IDS.length);
    expect(session.snapshotSaved()[1].entries[0].windows[0].usedPct).toBe(55);
    session.press('q');
    await session.finished;
  });

  describe('seeded start', () => {
    const MINUTE = 60_000;
    const ago = (ms: number) => new Date(Date.parse(START) - ms).toISOString();
    const seedOf = (id: string, ms: number, pct = 42): Usage => ({ ...usageOf(id, ago(ms)), windows: [{ label: 'weekly', kind: 'weekly', usedPct: pct }] });
    const snapshotOf = (...entries: Usage[]) => JSON.stringify(entries);

    it('draws a recent ok entry at once with its rows, a spinner and its data age while other panels probe', () => {
      const session = startSession({ snapshotText: snapshotOf(seedOf('claude', 7 * MINUTE)) });
      const frame = session.frames()[0];
      expect(frame).toMatch(/^claude [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/mu);
      expect(frame).toMatch(/^plan · claude · 0h7m ago$/mu);
      expect(frame).toContain('42%');
      expect(frame).toContain('probing…');
      expect(frame.match(/probing…/gu)?.length).toBeGreaterThan(IDS.length - 1);
    });

    it('shows probing for an entry older than 24 hours, a non-ok entry and a missing provider', () => {
      const old = seedOf('claude', 24 * 60 * MINUTE + 1);
      const failed: Usage = { id: 'agy', displayName: 'agy', windows: [], fetchedAt: ago(MINUTE), status: 'error', reason: 'boom' };
      const session = startSession({ snapshotText: snapshotOf(old, failed) });
      const frame = session.frames()[0];
      expect(frame).not.toContain('42%');
      expect(frame).not.toContain('boom');
      expect(frame).not.toContain(' ago');
      expect(frame.match(/probing…/gu)).toHaveLength(IDS.length + 2);
    });

    it.each([['missing', undefined], ['corrupt', '{nope'], ['wrong shape', '{}']])('starts exactly as without a snapshot when it is %s', (_name, text) => {
      expect(startSession({ snapshotText: text }).frames()[0]).toBe(startSession().frames()[0]);
    });

    it('keeps the route boxes probing and flashes nothing to copy and nothing to launch', async () => {
      const seeded = startSession({ snapshotText: snapshotOf(...IDS.map((id) => seedOf(id, 7 * MINUTE))) });
      const plain = startSession();
      const boxesOf = (frame: string) => frame.split('\n').slice(2, 6);
      expect(boxesOf(seeded.frames()[0])).toEqual(boxesOf(plain.frames()[0]));
      seeded.press('c');
      expect(seeded.lastFrame()).toContain('nothing to copy');
      seeded.press('C');
      expect(seeded.lastFrame()).toContain('nothing to copy');
      seeded.press('l');
      expect(seeded.lastFrame()).toContain('nothing to launch');
      seeded.press('L');
      expect(seeded.lastFrame()).toContain('nothing to launch');
      expect(seeded.clipboard.copy).not.toHaveBeenCalled();
      expect(seeded.spawner.spawn).not.toHaveBeenCalled();
    });

    it('switches a panel to the new rows and resets its data age when its probe settles', async () => {
      const session = startSession({ snapshotText: snapshotOf(seedOf('claude', 7 * MINUTE)) });
      session.probes[0].calls[0].resolve({ ...usageOf('claude', START), windows: [{ label: 'weekly', kind: 'weekly', usedPct: 77 }] });
      await vi.advanceTimersByTimeAsync(0);
      expect(session.lastFrame()).toMatch(/^plan · claude · .*0m ago$/mu);
      expect(session.lastFrame()).not.toContain('7m ago');
      expect(session.lastFrame()).toContain('77%');
      expect(session.lastFrame()).not.toContain('42%');
      expect(session.lastFrame()).toMatch(/^claude$/mu);
    });

    it('does not use seeded values as the notification baseline', async () => {
      const weekly = (pct: number): Usage => ({ ...usageOf('claude', START), windows: [{ label: 'weekly', kind: 'weekly', usedPct: pct }] });
      const session = startSession({ env: { NO_COLOR: '1', DANDELION_NOTIFY: '1' }, snapshotText: snapshotOf(seedOf('claude', 7 * MINUTE, 70)) });
      await session.settleRound(0, { claude: weekly(85) });
      expect(session.notifier.notify).not.toHaveBeenCalled();
    });

    it('writes no history sample and no snapshot before the first round settles', async () => {
      const session = startSession({ snapshotText: snapshotOf(...IDS.map((id) => seedOf(id, MINUTE))) });
      session.probes[0].calls[0].resolve(usageOf('claude', START));
      await vi.advanceTimersByTimeAsync(0);
      expect(session.historyReplace).not.toHaveBeenCalled();
      expect(session.snapshotReplace).not.toHaveBeenCalled();
    });

    it('never draws a provider that is not probed even when the snapshot has it', () => {
      const session = startSession({ ids: ['agy'], snapshotText: snapshotOf(seedOf('claude', MINUTE), seedOf('agy', MINUTE)) });
      expect(session.frames()[0]).not.toContain('claude');
      expect(session.frames()[0]).toContain('agy');
    });

    it('treats a seeded panel as pending for x, space and R', async () => {
      const session = startSession({ snapshotText: snapshotOf(seedOf('claude', MINUTE)) });
      session.press('j');
      session.press('x');
      expect(session.lastFrame()).toContain('no fix for this panel');
      session.press(' ');
      session.press('R');
      expect(session.saved()).toEqual([]);
      expect(session.probes[0].calls).toHaveLength(1);
    });

    it('sorts a seeded panel as still probing and keeps the compact view drawing it', () => {
      const session = startSession({ snapshotText: snapshotOf(seedOf('claude', MINUTE)) });
      session.press('s');
      const names = session.lastFrame().split('\n').filter((line) => /^(▸ )?(claude|agy)\b/u.test(line));
      expect(names[0]).toMatch(/^claude/u);
      session.press('v');
      expect(session.lastFrame()).toMatch(/claude.*42%/u);
    });
  });

  it('stores the unrounded percent in snapshot.json', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.press('j');
    session.press('R');
    session.probes[0].calls[1].resolve({ ...usageOf('claude', START), windows: [{ label: 'weekly', kind: 'weekly', usedPct: 89.5 }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshotSaved()[1].entries[0].windows[0].usedPct).toBe(89.5);
    session.press('q');
    await session.finished;
  });

  it('keeps the dashboard running when the snapshot cannot be written', async () => {
    const session = startSession({ snapshotWrites: false });
    await session.settleRound(0);
    expect(session.snapshotReplace).toHaveBeenCalledTimes(1);
    expect(session.lastFrame()).toContain('weekly');
    session.press('q');
    await session.finished;
  });

  it('keeps the dashboard running when the history cannot be written or read', async () => {
    const session = startSession({ historyWrites: false, historyText: '{corrupt' });
    await session.settleRound(0);
    expect(session.lastFrame()).toContain('weekly');
    session.press('g');
    expect(session.lastFrame()).toContain('no history yet');
    session.press('q');
    session.press('q');
    await session.finished;
  });

  it('opens a full-screen usage graph of the selected panel with g and leaves it with esc, g or q', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.press('j');
    session.press('j');
    session.press('g');
    const graph = session.lastFrame().split('\n');
    expect(graph[0]).toBe('agy · usage over time · last 0h0m');
    expect(graph).toContain('weekly  10%');
    expect(graph.at(-1)).toBe('v usage dropped (reset) · esc/q/g back');
    expect(session.lastFrame()).not.toContain('DANDELION');
    session.press('\x1b');
    expect(session.lastFrame()).toContain('DANDELION');
    session.press('g');
    session.press('g');
    expect(session.lastFrame()).toContain('DANDELION');
    session.press('g');
    session.press('q');
    expect(session.lastFrame()).toContain('DANDELION');
    expect(session.stopChildren).not.toHaveBeenCalled();
    session.press('q');
    await session.finished;
    expect(session.stopChildren).toHaveBeenCalled();
  });

  it('graphs the first panel on screen when nothing is selected and the sort puts another provider on top', async () => {
    const session = startSession();
    const withWindow = (id: string, usedPct: number): Usage => ({ ...usageOf(id, START), windows: [{ label: 'weekly', kind: 'weekly', usedPct, resetsAt: START }] });
    await session.settleRound(0, { claude: withWindow('claude', 90), agy: withWindow('agy', 20), kimi: withWindow('kimi', 50), kilo: NO_WINDOWS });
    session.press('s');
    session.press('g');
    expect(session.lastFrame().split('\n')[0]).toMatch(/^grok · usage over time/);
    session.press('\x1b');
    expect(markedHeaders(session.lastFrame())).toEqual(['▸ grok']);
    session.press('q');
    await session.finished;
  });

  it('graphs the first visible panel when claude is hidden and routes that panel after esc', async () => {
    const session = startSession({ hiddenText: '["claude"]' });
    await session.settleRound(0);
    session.press('g');
    expect(session.lastFrame().split('\n')[0]).toMatch(/^agy · usage over time/);
    session.press('\x1b');
    expect(markedHeaders(session.lastFrame())).toEqual(['▸ agy']);
    session.press(' ');
    expect(session.saved()).toEqual([{ agy: false }]);
    session.press('q');
    await session.finished;
  });

  it('still opens the graph when every panel is hidden', async () => {
    const session = startSession({ hiddenText: JSON.stringify(IDS) });
    await session.settleRound(0);
    session.press('g');
    expect(session.lastFrame().split('\n')[0]).toMatch(/^claude · usage over time/);
    session.press('q');
    session.press('q');
    await session.finished;
  });

  it('redraws the open graph with the new samples when another round settles', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' } });
    await session.settleRound(0);
    session.press('g');
    expect(session.lastFrame()).toContain('claude · usage over time · last 0h0m');
    await vi.advanceTimersByTimeAsync(1000);
    await session.settleRound(1);
    const graph = session.lastFrame();
    expect(graph.startsWith('claude · usage over time · last 0h')).toBe(true);
    expect(graph).not.toContain('DANDELION');
    expect(session.historyReplace).toHaveBeenCalledTimes(2);
    session.press('q');
    session.press('q');
    await session.finished;
  });

  it('explains why a provider without windows has nothing to graph', async () => {
    const session = startSession();
    await session.settleRound(0, { kilo: NO_WINDOWS });
    IDS.forEach(() => session.press('j'));
    session.press('g');
    expect(session.lastFrame().split('\n')[1]).toBe('no usage windows to chart');
    session.press('q');
    session.press('q');
    await session.finished;
  });

  it('opens the graph of the first panel when nothing is selected and ignores other escape sequences', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.press('g');
    expect(session.lastFrame().split('\n')[0]).toBe('claude · usage over time · last 0h0m');
    const count = session.writes.length;
    session.press('\x1b[C');
    expect(session.writes).toHaveLength(count);
    session.press('\x1b');
    session.press('q');
    await session.finished;
  });

  it('charts the recorded history of the provider, reset drop included', async () => {
    const at = (hour: number) => `2026-09-13T0${hour}:00:00.000Z`;
    const stored = [80, 95, 3].map((usedPct, index) => ({ id: 'claude', slot: 0, label: 'weekly', usedPct, at: at(index + 6) }));
    const session = startSession({ historyText: JSON.stringify(stored) });
    await session.settleRound(0);
    session.press('g');
    const graph = session.lastFrame().split('\n');
    expect(graph.filter((line) => /^ +v +$/.test(line))).toHaveLength(1);
    expect(graph.at(-2)).toMatch(/^ {5}09-13 06:00 +09-13 10:00$/);
    session.press('q');
    session.press('q');
    await session.finished;
  });

  it('toggles the help footer with ? and ignores other keys', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.press('?');
    expect(session.lastFrame().split('\n').at(-1)).toBe('↑↓/jk select · space route · r refresh · t times · c/C copy · q quit · ?');
    session.press('?');
    expect(session.lastFrame()).not.toContain('c/C copy');
    const count = session.writes.length;
    session.press('x');
    session.press('R');
    session.press('\r');
    expect(session.writes).toHaveLength(count);
    expect(session.probes[0].calls).toHaveLength(1);
    session.press('q');
    await session.finished;
  });

  it('toggles absolute reset times with t and back to countdowns', async () => {
    const session = startSession();
    const resetting: Usage = { ...usageOf('claude', START), windows: [{ label: 'weekly', kind: 'weekly', usedPct: 10, resetsAt: new Date(Date.parse(START) + 2 * 86400000 + 3600000).toISOString() }] };
    await session.settleRound(0, { claude: resetting });
    const relative = session.lastFrame();
    const resetLines = (frame: string) => frame.split('\n').filter((line) => line.includes('↻'));
    const count = session.writes.length;
    expect(resetLines(relative).length).toBeGreaterThan(0);
    expect(resetLines(relative).every((line) => /↻ \d+[dh]\d+[hm]$/.test(line))).toBe(true);
    session.press('t');
    expect(session.writes.length).toBeGreaterThan(count);
    const absolute = session.lastFrame();
    expect(resetLines(absolute)).toHaveLength(resetLines(relative).length);
    expect(resetLines(absolute).every((line) => /↻ (\w{3} \d{2}:\d{2}|\w{3} \d{1,2} \d{2}:\d{2})$/.test(line))).toBe(true);
    expect(absolute.split('\n').some((line) => /next reset: .* at \w{3} \d{2}:\d{2}$/.test(line))).toBe(true);
    session.press('t');
    expect(session.lastFrame()).toBe(relative);
    session.press('q');
    await session.finished;
  });

  it('cycles the panel order with s and keeps the selection on the same provider', async () => {
    const session = startSession();
    const at = (hours: number) => new Date(Date.parse(START) + hours * 3600000).toISOString();
    const withWindow = (id: string, usedPct: number, resetsAt: string): Usage => ({ ...usageOf(id, START), windows: [{ label: 'weekly', kind: 'weekly', usedPct, resetsAt }] });
    await session.settleRound(0, { claude: withWindow('claude', 90, at(5)), agy: withWindow('agy', 20, at(9)), kimi: withWindow('kimi', 50, at(2)), kilo: NO_WINDOWS });
    const headers = () => session.lastFrame().split('\n').filter((line) => IDS.includes(line.replace('▸ ', '').replace(/ .*/, '')) && !line.startsWith(' ')).map((line) => line.replace('▸ ', ''));
    ['j', 'j', 'j', 'j'].forEach((key) => session.press(key));
    expect(markedHeaders(session.lastFrame())).toEqual(['▸ grok']);
    expect(headers().slice(0, 3)).toEqual(['claude', 'agy', 'kimi']);
    expect(session.lastFrame().split('\n')[1]).not.toContain('sort:');
    session.press('s');
    expect(headers().slice(0, 3)).toEqual(['grok', 'codex', 'cursor']);
    expect(session.lastFrame().split('\n')[1]).toMatch(/ · sort: headroom$/);
    expect(markedHeaders(session.lastFrame())).toEqual(['▸ grok']);
    session.press('s');
    expect(headers().slice(0, 3)).toEqual(['kimi', 'claude', 'agy']);
    expect(session.lastFrame().split('\n')[1]).toMatch(/ · sort: reset$/);
    expect(markedHeaders(session.lastFrame())).toEqual(['▸ grok']);
    session.press(' ');
    expect(session.saved()).toEqual([{ grok: false }]);
    session.press('s');
    expect(headers().map((id) => id.replace(/ +routing off/, ''))).toEqual(IDS);
    expect(session.lastFrame().split('\n')[1]).not.toContain('sort:');
    session.press('q');
    await session.finished;
  });

  describe('view.json', () => {
    const at = (hours: number) => new Date(Date.parse(START) + hours * 3600000).toISOString();
    const withWindow = (id: string, usedPct: number): Usage => ({ ...usageOf(id, START), windows: [{ label: 'weekly', kind: 'weekly', usedPct, resetsAt: at(50) }] });
    const headers = (session: ReturnType<typeof startSession>) => session.lastFrame().split('\n').filter((line) => IDS.includes(line.replace('▸ ', '').replace(/ .*/, '')) && !line.startsWith(' ')).map((line) => line.replace('▸ ', ''));

    it('starts in the saved order with absolute reset times without a key press', async () => {
      const session = startSession({ columns: 120, viewText: '{"sort":"headroom","absoluteResets":true}' });
      await session.settleRound(0, { claude: withWindow('claude', 90), agy: withWindow('agy', 20) });
      expect(headers(session).indexOf('agy')).toBeLessThan(headers(session).indexOf('claude'));
      expect(session.lastFrame().split('\n')[1]).toMatch(/ · sort: headroom$/);
      const resets = session.lastFrame().split('\n').filter((line) => line.includes('↻'));
      expect(resets.length).toBeGreaterThan(0);
      expect(resets.every((line) => /↻ \w{3} \d{2}:\d{2}$|↻ \w{3} \d{1,2} \d{2}:\d{2}$/.test(line))).toBe(true);
      expect(session.viewReplace).not.toHaveBeenCalled();
      session.press('q');
      await session.finished;
    });

    it.each([
      ['missing', undefined],
      ['corrupt', '{nope'],
      ['unknown sort', '{"sort":"random","absoluteResets":false}'],
      ['non-boolean times', '{"sort":"reset","absoluteResets":"yes"}'],
      ['not an object', '[]']
    ])('starts with dashboard order and countdowns when the file is %s', async (_name, viewText) => {
      const session = startSession({ viewText });
      await session.settleRound(0, { claude: withWindow('claude', 90), agy: withWindow('agy', 20) });
      expect(headers(session).slice(0, 2)).toEqual(['claude', 'agy']);
      expect(session.lastFrame().split('\n')[1]).not.toContain('sort:');
      const resets = session.lastFrame().split('\n').filter((line) => line.includes('↻'));
      expect(resets.length).toBeGreaterThan(0);
      expect(resets.every((line) => /↻ \d+[dh]\d+[hm]$/.test(line))).toBe(true);
      session.press('q');
      await session.finished;
    });

    it('writes both values to view.json next to the state file when s or t changes the mode', async () => {
      const session = startSession();
      session.press('s');
      session.press('t');
      session.press('s');
      session.press('t');
      session.press('s');
      expect(session.viewReplace.mock.calls.every(([path]) => path === '/s/view.json')).toBe(true);
      expect(session.viewSaved()).toEqual([
        { sort: 'headroom', absoluteResets: false },
        { sort: 'headroom', absoluteResets: true },
        { sort: 'reset', absoluteResets: true },
        { sort: 'reset', absoluteResets: false },
        { sort: 'dashboard', absoluteResets: false }
      ]);
      session.press('q');
      await session.finished;
    });

    it('flashes view state not saved and still applies the mode when the write fails', async () => {
      const session = startSession({ columns: 120, viewSaves: [false, false] });
      await session.settleRound(0, { claude: withWindow('claude', 90), agy: withWindow('agy', 20) });
      session.press('s');
      expect(session.lastFrame().split('\n')[1]).toBe('view state not saved');
      session.press('t');
      expect(session.lastFrame().split('\n')[1]).toBe('view state not saved');
      await vi.advanceTimersByTimeAsync(2000);
      expect(session.lastFrame().split('\n')[1]).toMatch(/ · sort: headroom$/);
      const resets = session.lastFrame().split('\n').filter((line) => line.includes('↻'));
      expect(resets.length).toBeGreaterThan(0);
      expect(resets.every((line) => /↻ \w{3} \d{2}:\d{2}$|↻ \w{3} \d{1,2} \d{2}:\d{2}$/.test(line))).toBe(true);
      session.press('q');
      await session.finished;
    });
  });

  it('keeps pending panels last and walks the sorted order with the arrow keys', async () => {
    const session = startSession();
    session.press('s');
    session.probes[3].calls[0].resolve({ ...usageOf('grok', START), windows: [{ label: 'weekly', kind: 'weekly', usedPct: 10 }] });
    await vi.advanceTimersByTimeAsync(0);
    const headers = () => session.lastFrame().split('\n').filter((line) => IDS.includes(line.replace('▸ ', ''))).map((line) => line.replace('▸ ', ''));
    expect(headers()).toEqual(['grok', 'claude', 'agy', 'kimi', 'codex', 'cursor', 'kilo']);
    session.press('j');
    session.press('j');
    expect(markedHeaders(session.lastFrame())).toEqual(['▸ claude']);
    session.press('k');
    expect(markedHeaders(session.lastFrame())).toEqual(['▸ grok']);
    session.press('h');
    session.press('s');
    expect(markedHeaders(session.lastFrame())).toEqual(['▸ claude']);
    session.press('q');
    await session.finished;
  });

  it('toggles the compact view with v and keeps the other keys working in it', async () => {
    const session = startSession();
    await vi.advanceTimersByTimeAsync(0);
    await session.settleRound(0);
    const full = session.lastFrame();
    session.press('v');
    const compact = session.lastFrame();
    expect(compact.split('\n').length).toBeLessThan(full.split('\n').length);
    expect(compact.split('\n').slice(6, 13).map((line) => line.slice(2, 8).trim())).toEqual(['claude', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo']);
    session.press('j');
    session.press(' ');
    expect(session.lastFrame()).toMatch(/▸ claude +#*-*.*routing off/);
    expect(session.lastFrame()).toContain('routing off');
    session.press('?');
    expect(session.lastFrame()).toContain('v compact');
    session.press('v');
    expect(session.lastFrame()).toContain('weekly');
    session.press('q');
    await session.finished;
  });

  it('fits every frame to the screen’s rows and redraws the same view when they change', async () => {
    const session = startSession({ rows: 12 });
    expect(session.lastFrame().split('\n')).toHaveLength(12);
    await session.settleRound(0);
    expect(session.frames().every((frame) => frame.split('\n').length <= 12 && !frame.endsWith('\n'))).toBe(true);
    const settled = session.lastFrame();
    expect(settled.split('\n')).toHaveLength(12);
    expect(settled.split('\n')[7]).toBe('claude');
    expect(settled).not.toContain('kilo');
    session.press('?');
    expect(session.lastFrame().split('\n')).toHaveLength(12);
    expect(session.lastFrame().split('\n').at(-1)).toBe('↑↓/jk select · space route · r refresh · t times · c/C copy · q quit · ?');
    session.press('?');
    expect(session.lastFrame()).not.toContain('c/C copy');
    expect(session.lastFrame().split('\n')).toHaveLength(12);
    session.screen.rows = 30;
    session.screen.emit('resize');
    const grown = session.lastFrame();
    expect(grown.split('\n')).toHaveLength(30);
    expect(grown.split('\n').slice(0, 12)).toEqual(settled.split('\n'));
    session.screen.rows = 12;
    session.screen.emit('resize');
    expect(session.lastFrame()).toBe(settled);
    session.press('q');
    await session.finished;
  });

  it('redraws at the new terminal width on resize', async () => {
    const session = startSession({ rows: 30 });
    await session.settleRound(0);
    const wide = (): number => Math.max(...session.lastFrame().split('\n').map((line) => [...line].length));
    expect(wide()).toBe(72);
    Object.assign(session.screen, { columns: 120 });
    session.screen.emit('resize');
    expect(session.lastFrame().split('\n')[0]).toHaveLength(120);
    expect(wide()).toBe(120);
    Object.assign(session.screen, { columns: 40 });
    session.screen.emit('resize');
    expect(wide()).toBeLessThanOrEqual(40);
    Object.assign(session.screen, { columns: undefined });
    session.screen.emit('resize');
    expect(wide()).toBe(72);
    session.press('q');
    await session.finished;
  });

  it('scrolls a short session to the last panel and walks back to the first with the boxes in the chrome', async () => {
    const session = startSession({ rows: 12 });
    await session.settleRound(0);
    IDS.forEach(() => session.press('j'));
    const kilo = session.lastFrame().split('\n');
    expect(kilo.length).toBeLessThanOrEqual(12);
    expect(kilo[2]?.startsWith('+- route')).toBe(true);
    expect(kilo[kilo.indexOf('▸ kilo') - 1]).toBe(kilo[6 + kilo.slice(6).findIndex((line) => line.startsWith('='))]);
    expect(kilo.at(-3)).toBe('▸ kilo');
    expect(kilo).not.toContain('claude');
    IDS.slice(1).forEach(() => session.press('k'));
    const claude = session.lastFrame().split('\n');
    expect(claude.length).toBeLessThanOrEqual(12);
    expect(claude[2]?.startsWith('+- route')).toBe(true);
    expect(claude[6]?.startsWith('=')).toBe(true);
    expect(claude[7]).toBe('▸ claude');
    expect(claude.slice(2, 6).join('\n')).not.toContain('▸');
    session.press('?');
    expect(session.lastFrame().split('\n')).toEqual([...claude.slice(0, 6), ...claude.slice(7, 10), 'h hide · H show hidden · R refresh panel · s sort · x fix · l/L launch', 'g usage graph of the selected panel · esc/q/g back · v compact · w why', '↑↓/jk select · space route · r refresh · t times · c/C copy · q quit · ?']);
    session.press('q');
    await session.finished;
  });

  it('clips a 4-row session to the banner, the summary and the first two box lines', async () => {
    const session = startSession({ rows: 4 });
    const pending = session.lastFrame().split('\n');
    expect(pending).toHaveLength(4);
    expect(pending[0]?.startsWith('DANDELION')).toBe(true);
    expect(pending[2]?.startsWith('+- route')).toBe(true);
    await session.settleRound(0);
    const settled = session.lastFrame().split('\n');
    expect(settled).toHaveLength(4);
    expect(settled[2]?.startsWith('+- route')).toBe(true);
    session.press('?');
    expect(session.lastFrame().split('\n')).toEqual(settled);
    session.press('q');
    await session.finished;
  });

  it('refreshes at once on r, ignores r while a round runs and restarts the interval after', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '10' } });
    session.press('r');
    expect(session.probes[0].calls).toHaveLength(1);
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(5000);
    session.press('r');
    expect(session.probes[0].calls).toHaveLength(2);
    expect(session.lastFrame().split('\n')[0]).toContain('refreshing… · data 0h0m old · 10:00:05');
    session.press('r');
    expect(session.probes[0].calls).toHaveLength(2);
    await session.settleRound(1);
    await vi.advanceTimersByTimeAsync(9999);
    expect(session.probes[0].calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.probes[0].calls).toHaveLength(3);
    session.press('q');
    await session.finished;
  });

  it.each([['R'], ['\r']])('re-probes only the selected panel on %j with a fresh instant and recomputes the routes', async (key) => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '10' } });
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(3000);
    session.press('j');
    session.press('j');
    session.press('j');
    const before = session.lastFrame();
    session.press(key);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual([1, 1, 2, 1, 1, 1, 1]);
    expect(session.probes[2].calls[1].now).toBe('2026-09-13T10:00:03.000Z');
    expect(session.lastFrame()).toMatch(/▸ kimi [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    const lines = (frame: string) => frame.split('\n');
    const spinning = lines(session.lastFrame()).findIndex((line) => line.startsWith('▸ kimi'));
    expect(lines(session.lastFrame()).filter((_, index) => index !== spinning)).toEqual(lines(before).filter((_, index) => index !== spinning));
    session.probes[2].calls[1].resolve({ ...usageOf('kimi', '2026-09-13T10:00:03.000Z'), windows: [{ label: 'weekly', kind: 'weekly', usedPct: 77 }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.lastFrame()).toContain('77%');
    expect(session.lastFrame()).not.toContain('probing');
    session.press('q');
    await session.finished;
  });

  it('does not reset the refresh timer when a single panel settles', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '10' } });
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(5000);
    session.press('j');
    session.press('R');
    session.probes[0].calls[1].resolve(usageOf('claude', START));
    await vi.advanceTimersByTimeAsync(4999);
    expect(session.probes[1].calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.probes[1].calls).toHaveLength(2);
    session.press('q');
    await session.finished;
  });

  it('ignores R without a selection, while a round runs and while that panel is probing', async () => {
    const session = startSession();
    session.press('R');
    session.press('j');
    session.press('R');
    session.press('\r');
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 1));
    await session.settleRound(0);
    session.press('R');
    session.press('R');
    expect(session.probes.map(({ calls }) => calls.length)).toEqual([2, ...IDS.slice(1).map(() => 1)]);
    session.press('q');
    session.press('R');
    await session.finished;
    expect(session.probes[0].calls).toHaveLength(2);
  });

  it.each([['q'], ['\x03']])('quits on %j: restores the terminal, stops children and draws nothing more', async (key) => {
    const session = startSession();
    session.probes[0].calls[0].resolve(usageOf('claude', START));
    await vi.advanceTimersByTimeAsync(0);
    session.press(key);
    expect(session.writes.at(-1)).toBe(LEAVE_ALTERNATE);
    await session.finished;
    expect(session.keyboard.setRawMode).toHaveBeenLastCalledWith(false);
    expect(session.keyboard.pause).toHaveBeenCalled();
    expect(session.stopChildren).toHaveBeenCalledTimes(1);
    const count = session.writes.length;
    await session.settleRound(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600000);
    session.press('q');
    session.press('r');
    expect(session.writes).toHaveLength(count);
    expect(session.stopChildren).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 1));
  });

  it.each([['SIGTERM', 143], ['SIGHUP', 129]])('restores the terminal, stops children and finishes with %s code %i', async (name, code) => {
    const session = startSession();
    await session.settleRound(0);
    session.deliver(name);
    expect(session.writes.at(-1)).toBe(LEAVE_ALTERNATE);
    expect(await session.finished).toBe(code);
    expect(session.keyboard.setRawMode).toHaveBeenLastCalledWith(false);
    expect(session.stopChildren).toHaveBeenCalledTimes(1);
    expect(session.handlersFor('SIGTERM')).toHaveLength(0);
    expect(session.handlersFor('SIGHUP')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('listens for SIGTERM and SIGHUP while running and removes both handlers after q', async () => {
    const session = startSession();
    expect(session.handlersFor('SIGTERM')).toHaveLength(1);
    expect(session.handlersFor('SIGHUP')).toHaveLength(1);
    session.press('q');
    expect(await session.finished).toBe(0);
    expect(session.handlersFor('SIGTERM')).toHaveLength(0);
    expect(session.handlersFor('SIGHUP')).toHaveLength(0);
  });

  it('tears down once when a signal arrives after q and keeps the first exit code', async () => {
    const session = startSession();
    session.press('q');
    session.deliver('SIGTERM');
    expect(await session.finished).toBe(0);
    expect(session.stopChildren).toHaveBeenCalledTimes(1);
  });

  it('cancels the scheduled refresh when quitting after a round has settled', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.press('q');
    await session.finished;
    expect(vi.getTimerCount()).toBe(0);
    const count = session.writes.length;
    await vi.advanceTimersByTimeAsync(600000);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 1));
    expect(session.writes).toHaveLength(count);
  });

  it.each<[string, string[], string]>([
    ['j twice', ['j', 'j'], 'agy'],
    ['Down, Down, Up', ['\x1b[B', '\x1b[B', '\x1b[A'], 'claude'],
    ['k from nothing', ['k'], 'kilo'],
    ['j then k', ['j', 'k'], 'claude'],
    ['j nine times', Array(9).fill('j'), 'kilo'],
    ['k, Up, k', ['k', '\x1b[A', 'k'], 'codex'],
    ['Up past the top', ['j', '\x1b[A', 'k'], 'claude']
  ])('moves the selection one panel per key and stops at the ends: %s', async (_case, keys, id) => {
    const session = startSession();
    await session.settleRound(0);
    expect(markedHeaders(session.lastFrame())).toEqual([]);
    const count = session.frames().length;
    keys.forEach(session.press);
    expect(session.frames()).toHaveLength(count + keys.length);
    expect(markedHeaders(session.lastFrame())).toEqual([`▸ ${id}`]);
    expect(session.replace).not.toHaveBeenCalled();
    session.press('q');
    await session.finished;
  });

  it.each<[string, string, string]>([
    ['two Downs in one chunk', '\x1b[B\x1b[B', 'agy'],
    ['three Ups in one chunk after four Downs', 'jjjj\x1b[A\x1b[A\x1b[A', 'claude'],
    ['a mixed chunk', 'j\x1b[Bk', 'claude'],
    ['an unknown escape sequence before a key', '\x1b[Cj', 'claude']
  ])('dispatches every key of a batched chunk: %s', async (_case, chunk, id) => {
    const session = startSession();
    await session.settleRound(0);
    session.press(chunk);
    expect(markedHeaders(session.lastFrame())).toEqual([`▸ ${id}`]);
    session.press('q');
    await session.finished;
  });

  it('flips the selected routable provider on space, saves the whole state and tags its header at once', async () => {
    const session = startSession({ state: { nope: 1, agy: false } });
    await session.settleRound(0);
    expect(session.lastFrame().split('\n')).toContain(TAG('agy'));
    session.press('j');
    const rows = lineAfter(session.lastFrame(), '▸ claude', 1);
    const count = session.frames().length;
    session.press(' ');
    expect(session.saved().at(-1)).toEqual({ nope: 1, agy: false, claude: false });
    expect(session.frames()).toHaveLength(count + 1);
    expect(lineAfter(session.lastFrame(), TAG('▸ claude'), 1)).toBe(rows);
    session.press(' ');
    expect(session.saved().at(-1)).toEqual({ nope: 1, agy: false, claude: true });
    expect(markedHeaders(session.lastFrame())).toEqual(['▸ claude']);
    session.press('q');
    await session.finished;
  });

  it('flashes a settled non-routable panel for 2 s without saving, and forgets the flash on quit', async () => {
    const unavailable: Usage = { ...NO_WINDOWS, id: 'claude', displayName: 'claude', status: 'unavailable', reason: 'claude CLI not found in PATH' };
    const session = startSession();
    await session.settleRound(0, { kilo: NO_WINDOWS, claude: unavailable });
    session.press('k');
    const count = session.frames().length;
    session.press(' ');
    expect(session.frames()).toHaveLength(count + 1);
    expect(lineAfter(session.lastFrame(), '▸ kilo', 2)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(1999);
    expect(lineAfter(session.lastFrame(), '▸ kilo', 2)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(1);
    expect(lineAfter(session.lastFrame(), '▸ kilo', 2)).toBe('plan · kilo · 0h0m ago');
    ['k', 'k', 'k', 'k', 'k', 'k', ' '].forEach(session.press);
    expect(lineAfter(session.lastFrame(), '▸ claude', 2)).toBe('not routable (no usage windows)');
    expect(session.replace).not.toHaveBeenCalled();
    session.press('q');
    await session.finished;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a flash on the pressed panel and restarts the 2 s on a new flash', async () => {
    const session = startSession();
    await session.settleRound(0, { kilo: NO_WINDOWS, codex: { ...NO_WINDOWS, id: 'codex', displayName: 'codex' } });
    session.press('k');
    session.press(' ');
    await vi.advanceTimersByTimeAsync(500);
    session.press('k');
    session.press('k');
    expect(lineAfter(session.lastFrame(), 'kilo', 2)).toBe('not routable (no usage windows)');
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('plan · codex · 0h0m ago');
    await vi.advanceTimersByTimeAsync(1000);
    session.press(' ');
    expect(lineAfter(session.lastFrame(), 'kilo', 2)).toBe('plan · kilo · 0h0m ago');
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(500);
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(1499);
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(1);
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('plan · codex · 0h0m ago');
    session.press('q');
    await session.finished;
  });

  it('leaves a running flash alone when a toggle succeeds', async () => {
    const session = startSession();
    await session.settleRound(0, { kilo: NO_WINDOWS });
    session.press('k');
    session.press(' ');
    await vi.advanceTimersByTimeAsync(1000);
    ['k', 'k', 'k', 'k', 'k', 'k', ' '].forEach(session.press);
    expect(session.saved().at(-1)).toEqual({ claude: false });
    expect(lineAfter(session.lastFrame(), 'kilo', 2)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(1000);
    expect(lineAfter(session.lastFrame(), 'kilo', 2)).toBe('plan · kilo · 0h0m ago');
    session.press('q');
    await session.finished;
  });

  it('does nothing on space with nothing selected or on a pending panel', async () => {
    const session = startSession();
    const count = session.writes.length;
    session.press(' ');
    expect(session.writes).toHaveLength(count);
    session.press('j');
    session.press(' ');
    expect(session.writes).toHaveLength(count + 1);
    expect(session.lastFrame()).toContain('\n▸ claude\n⠋ probing…\n');
    expect(session.replace).not.toHaveBeenCalled();
    session.press('q');
    await session.finished;
  });

  it('flashes routing state not saved and keeps the old state when saving fails', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.replace.mockReturnValueOnce(false);
    session.press('j');
    session.press(' ');
    expect(lineAfter(session.lastFrame(), '▸ claude', 2)).toBe('routing state not saved');
    expect(session.lastFrame()).not.toContain('routing off');
    session.press(' ');
    expect(session.saved()).toEqual([{ claude: false }, { claude: false }]);
    expect(session.lastFrame().split('\n')).toContain(TAG('▸ claude'));
    session.press('q');
    await session.finished;
  });

  it('finishes only after every child has been stopped', async () => {
    let release: () => void = () => undefined;
    const stopChildren = vi.fn(() => new Promise<undefined>((resolve) => (release = () => resolve(undefined))));
    const session = startSession({ stopChildren });
    let finished = false;
    void session.finished.then(() => (finished = true));
    session.press('q');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.writes.at(-1)).toBe(LEAVE_ALTERNATE);
    expect(finished).toBe(false);
    release();
    await session.finished;
    expect(finished).toBe(true);
  });
});

const BOX_TOP = '+- route -------------------------+  +- route --high ------------------+';
const BOX_BOTTOM = '+---------------------------------+  +---------------------------------+';

function boxRowsOf(frame: string): string[] {
  return frame.split('\n').slice(2, 6);
}

function boxBlock(model: string, account: string, highModel: string, highAccount: string): string[] {
  return [
    BOX_TOP,
    `| ${model.padEnd(31)} |  | ${highModel.padEnd(31)} |`,
    `| ${account.padEnd(31)} |  | ${highAccount.padEnd(31)} |`,
    BOX_BOTTOM
  ];
}

function evaporatingUsage(id: string, fetchedAt: string, resetsAt: string): Usage {
  return { id, displayName: id, planLabel: 'plan', windows: [{ label: 'weekly', kind: 'weekly', usedPct: 86, resetsAt }], fetchedAt, status: 'ok' };
}

describe('route boxes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(START));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows animated probing boxes until every probe of the first round settles', async () => {
    const session = startSession();
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('⠋ probing…', '', '⠋ probing…', ''));
    session.probes.slice(0, 6).forEach(({ probe, calls }) => calls[0].resolve(usageOf(probe.id, calls[0].now)));
    await vi.advanceTimersByTimeAsync(0);
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('⠋ probing…', '', '⠋ probing…', ''));
    await vi.advanceTimersByTimeAsync(100);
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('⠙ probing…', '', '⠙ probing…', ''));
    session.probes[6].calls[0].resolve(usageOf('kilo', session.probes[6].calls[0].now));
    await vi.advanceTimersByTimeAsync(0);
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('model-a high', 'claude', 'model-h1 max', 'claude'));
    session.press('q');
    await session.finished;
  });

  it('keeps the previous round’s boxes while a refresh runs and recomputes them when it settles', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '100000' } });
    await session.settleRound(0);
    const settled = boxBlock('model-a high', 'claude', 'model-h1 max', 'claude');
    expect(boxRowsOf(session.lastFrame())).toEqual(settled);
    session.press('r');
    expect(session.lastFrame().split('\n')[0]).toContain('refreshing…');
    expect(boxRowsOf(session.lastFrame())).toEqual(settled);
    const down: Usage = { id: 'claude', displayName: 'claude', windows: [], fetchedAt: START, status: 'unavailable', reason: 'gone' };
    session.probes.slice(0, 6).forEach(({ probe, calls }) => calls[1].resolve(probe.id === 'claude' ? down : usageOf(probe.id, calls[1].now)));
    await vi.advanceTimersByTimeAsync(0);
    expect(boxRowsOf(session.lastFrame())).toEqual(settled);
    session.probes[6].calls[1].resolve(usageOf('kilo', session.probes[6].calls[1].now));
    await vi.advanceTimersByTimeAsync(0);
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('model-c high', 'agy', 'model-f', 'cursor'));
    session.press('q');
    await session.finished;
  });

  it('recomputes both boxes when a single panel settles', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '100000' } });
    await session.settleRound(0);
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('model-a high', 'claude', 'model-h1 max', 'claude'));
    session.press('j');
    session.press('R');
    const down: Usage = { id: 'claude', displayName: 'claude', windows: [], fetchedAt: START, status: 'unavailable', reason: 'gone' };
    session.probes[0].calls[1].resolve(down);
    await vi.advanceTimersByTimeAsync(0);
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('model-c high', 'agy', 'model-f', 'cursor'));
    session.press('q');
    await session.finished;
  });

  it('recomputes both boxes on the same frame when space toggles the selected provider', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.press('j');
    session.press(' ');
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('model-c high', 'agy', 'model-f', 'cursor'));
    expect(session.saved().at(-1)).toEqual({ claude: false });
    session.press(' ');
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('model-a high', 'claude', 'model-h1 max', 'claude'));
    expect(session.saved().at(-1)).toEqual({ claude: true });
    session.press('q');
    await session.finished;
  });

  it('toggles the route --why lines under the boxes with w and keeps them out of view.json', async () => {
    const session = startSession();
    session.press('w');
    expect(session.lastFrame().split('\n')[6]).not.toContain('headroom');
    session.press('w');
    await session.settleRound(0);
    const plain = session.lastFrame().split('\n');
    session.press('w');
    const shown = session.lastFrame().split('\n');
    expect(shown.slice(0, 6)).toEqual(plain.slice(0, 6));
    expect(shown.slice(6, 8)).toEqual([expect.stringMatching(/^headroom: /), expect.stringContaining('unavailable: ')]);
    expect(shown.length).toBe(plain.length + 3);
    session.press('w');
    expect(session.lastFrame().split('\n')).toEqual(plain);
    expect(session.viewSaved()).toEqual([]);
    session.press('q');
    await session.finished;
  });

  it('shows exactly the lines route --why and route --high --why print, and none with a bad routes file', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.press('w');
    const request = { now: START, zone: 'UTC', why: true };
    const usages = IDS.map((id) => usageOf(id, START));
    const [route, high] = (['headroom', 'high'] as const).map((mode) => renderRoute(LINES, usages, [], { ...request, mode }).out.split('\n').slice(1, -1));
    const expected = [...route, ...high].map((line) => ([...line].length > 72 ? `${[...line].slice(0, 71).join('').trimEnd()}…` : line));
    expect(session.lastFrame().split('\n').slice(6, 6 + expected.length)).toEqual(expected);
    session.press('q');
    await session.finished;
    const broken = startSession({ routes: { fault: { path: '/r.json', problem: 'bad' } } });
    await broken.settleRound(0);
    const before = broken.lastFrame();
    broken.press('w');
    expect(broken.lastFrame()).toBe(before);
    broken.press('q');
    await broken.finished;
  });

  it('recomputes the why lines when space toggles routing and when a single panel settles', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.press('w');
    const before = session.lastFrame().split('\n')[6];
    session.press('j');
    session.press(' ');
    const after = session.lastFrame().split('\n');
    expect(after[6]).not.toBe(before);
    expect(after.slice(6, 9).join('\n')).toContain('ineligible: claude');
    session.press('R');
    session.probes[0].calls[1].resolve(usageOf('claude', START));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.lastFrame().split('\n')[6]).toBe(after[6]);
    session.press('q');
    await session.finished;
  });

  it('keeps the frame within the terminal rows with the why lines shown', async () => {
    const session = startSession({ rows: 14 });
    await session.settleRound(0);
    session.press('w');
    expect(session.lastFrame().split('\n').length).toBeLessThanOrEqual(14);
    session.press('q');
    await session.finished;
  });

  it('routes by the session zone, so boxes in two zones can differ on the same results', async () => {
    const resetsAt = '2026-09-13T22:30:00.000Z';
    const overrides = () => Object.fromEntries(IDS.map((id) => [id, evaporatingUsage(id, START, resetsAt)]));
    const utc = startSession();
    await utc.settleRound(0, overrides());
    expect(boxRowsOf(utc.lastFrame())[1]).toBe(`| ${'model-a max'.padEnd(31)} |  | ${'model-h1 max'.padEnd(31)} |`);
    utc.press('q');
    await utc.finished;
    const plusTwo = startSession({ zone: 'Etc/GMT-2' });
    await plusTwo.settleRound(0, overrides());
    expect(boxRowsOf(plusTwo.lastFrame())[1]).toBe(`| ${'model-a high'.padEnd(31)} |  | ${'model-h1 max'.padEnd(31)} |`);
    plusTwo.press('q');
    await plusTwo.finished;
  });

  it('recomputes the boxes from the frame time, flipping when a reset passes between rounds', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '100000' } });
    await session.settleRound(0, Object.fromEntries(IDS.map((id) => [id, evaporatingUsage(id, START, '2026-09-13T10:30:00.000Z')])));
    expect(boxRowsOf(session.lastFrame())[1]).toBe(`| ${'model-a max'.padEnd(31)} |  | ${'model-h1 max'.padEnd(31)} |`);
    vi.setSystemTime(new Date('2026-09-13T10:31:00.000Z'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(boxRowsOf(session.lastFrame())[1]).toBe(`| ${'model-a high'.padEnd(31)} |  | ${'model-h1 max'.padEnd(31)} |`);
    session.press('q');
    await session.finished;
  });

  describe('hiding panels', () => {
    const NOTE = (count: number) => `${count} hidden · H to show`;
    const HIDDEN_TAG = (lead: string) => `${lead}${' '.repeat(72 - [...lead].length - 6)}hidden`;
    const headers = (frame: string) => frame.split('\n').filter((line) => IDS.includes(line.replace(/^▸ /, '').split(' ')[0]) && !line.startsWith('='));

    const selectedHeader = (frame: string) => headers(frame).find((line) => line.startsWith('▸ '));

    async function settled(overrides: SessionOverrides = {}) {
      const session = startSession(overrides);
      await session.settleRound(0);
      return session;
    }

    async function end(session: { press(key: string): void; finished: Promise<unknown> }) {
      session.press('q');
      await session.finished;
    }

    it('h hides the selected panel, saves its id next to the state file and selects the next visible panel', async () => {
      const session = await settled();
      session.press('j');
      session.press('j');
      session.press('h');
      expect(session.hiddenReplace.mock.calls[0][0]).toBe('/s/hidden.json');
      expect(session.hiddenSaved()).toEqual([['agy']]);
      expect(headers(session.lastFrame())).toEqual(['claude', '▸ kimi', 'grok', 'codex', 'cursor', 'kilo']);
      expect(session.lastFrame().split('\n').at(-1)).toBe(NOTE(1));
      session.press('k');
      expect(headers(session.lastFrame())).toEqual(['▸ claude', 'kimi', 'grok', 'codex', 'cursor', 'kilo']);
      await end(session);
    });

    it('selects the previous visible panel when the last one is hidden', async () => {
      const session = await settled();
      session.press('k');
      session.press('h');
      expect(headers(session.lastFrame()).at(-1)).toBe('▸ cursor');
      await end(session);
    });

    it('does nothing with h when no panel is selected', async () => {
      const session = await settled();
      session.press('h');
      expect(session.hiddenReplace).not.toHaveBeenCalled();
      await end(session);
    });

    it('selects nothing once the only panel left is hidden', async () => {
      const session = await settled({ hiddenText: JSON.stringify(IDS.slice(1)) });
      session.press('j');
      session.press('h');
      expect(headers(session.lastFrame())).toEqual([]);
      expect(session.lastFrame().split('\n').at(-1)).toBe(NOTE(7));
      session.press('j');
      session.press('k');
      expect(headers(session.lastFrame())).toEqual([]);
      await end(session);
    });

    it('keeps a panel hidden after a restart that reads the saved hidden.json', async () => {
      const first = await settled();
      first.press('j');
      first.press('h');
      const saved = JSON.stringify(first.hiddenSaved().at(-1));
      await end(first);
      const second = await settled({ hiddenText: saved });
      expect(headers(second.lastFrame())).toEqual(['agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo']);
      expect(second.lastFrame().split('\n').at(-1)).toBe(NOTE(1));
      await end(second);
    });

    it.each([
      ['a missing file', undefined],
      ['corrupt bytes', '[not json'],
      ['a JSON object', '{"claude": true}'],
      ['a JSON string', '"claude"'],
      ['an empty array', '[]']
    ])('hides nothing for %s and still starts', async (_case, hiddenText) => {
      const session = await settled({ hiddenText });
      expect(headers(session.lastFrame())).toEqual(IDS);
      expect(session.lastFrame()).not.toContain('hidden');
      await end(session);
    });

    it('ignores non-string entries in hidden.json', async () => {
      const session = await settled({ hiddenText: '[1, null, "kilo"]' });
      expect(headers(session.lastFrame())).toEqual(IDS.slice(0, 6));
      await end(session);
    });

    it('H shows hidden panels tagged hidden, h unhides one, and H hides them again', async () => {
      const session = await settled({ hiddenText: '["agy","kilo"]' });
      expect(session.lastFrame().split('\n').at(-1)).toBe(NOTE(2));
      session.press('H');
      expect(session.lastFrame().split('\n')).toContain(HIDDEN_TAG('agy'));
      expect(session.lastFrame().split('\n')).toContain(HIDDEN_TAG('kilo'));
      expect(session.lastFrame()).not.toContain('H to show');
      session.press('j');
      session.press('j');
      expect(selectedHeader(session.lastFrame())).toBe(HIDDEN_TAG('▸ agy'));
      session.press('h');
      expect(session.hiddenSaved().at(-1)).toEqual(['kilo']);
      expect(selectedHeader(session.lastFrame())).toBe('▸ agy');
      session.press('H');
      expect(headers(session.lastFrame())).toEqual(['claude', '▸ agy', 'kimi', 'grok', 'codex', 'cursor']);
      expect(session.lastFrame().split('\n').at(-1)).toBe(NOTE(1));
      await end(session);
    });

    it('combines the hidden and routing off tags in one header', async () => {
      const session = await settled({ hiddenText: '["claude"]', state: { claude: false } });
      session.press('H');
      expect(session.lastFrame().split('\n')).toContain(`claude${' '.repeat(72 - 6 - 20)}hidden · routing off`);
      await end(session);
    });

    it('moves the selection off a hidden panel when H hides them again', async () => {
      const session = await settled({ hiddenText: '["kimi"]' });
      session.press('H');
      session.press('j');
      session.press('j');
      session.press('j');
      expect(selectedHeader(session.lastFrame())).toBe(HIDDEN_TAG('▸ kimi'));
      session.press('H');
      expect(headers(session.lastFrame())).toEqual(['claude', 'agy', '▸ grok', 'codex', 'cursor', 'kilo']);
      await end(session);
    });

    it('j, k and the arrows step over hidden panels', async () => {
      const session = await settled({ hiddenText: '["agy","kimi"]' });
      session.press('j');
      session.press('\x1b[B');
      expect(selectedHeader(session.lastFrame())).toBe('▸ grok');
      session.press('\x1b[A');
      expect(headers(session.lastFrame())).toEqual(['▸ claude', 'grok', 'codex', 'cursor', 'kilo']);
      session.press('k');
      expect(selectedHeader(session.lastFrame())).toBe('▸ claude');
      session.press('j');
      session.press('j');
      session.press('j');
      session.press('j');
      session.press('j');
      expect(selectedHeader(session.lastFrame())).toBe('▸ kilo');
      await end(session);
    });

    it('k from no selection lands on the last visible panel', async () => {
      const session = await settled({ hiddenText: '["kilo"]' });
      session.press('k');
      expect(headers(session.lastFrame()).at(-1)).toBe('▸ cursor');
      await end(session);
    });

    it('flashes hidden state not saved and leaves the panel visible when the write fails', async () => {
      const session = await settled({ hiddenSaves: [false] });
      session.press('j');
      session.press('h');
      expect(session.lastFrame().split('\n')).toContain('hidden state not saved');
      expect(headers(session.lastFrame())).toEqual(['▸ claude', ...IDS.slice(1)]);
      expect(session.lastFrame()).not.toContain('H to show');
      session.press('h');
      expect(session.hiddenSaved()).toEqual([['claude'], ['claude']]);
      expect(headers(session.lastFrame())).toEqual(['▸ agy', ...IDS.slice(2)]);
      await end(session);
    });

    it('still probes hidden providers and routes exactly as with nothing hidden', async () => {
      const visible = await settled();
      const hidden = await settled({ hiddenText: JSON.stringify(IDS) });
      expect(hidden.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 1));
      expect(boxRowsOf(hidden.lastFrame())).toEqual(boxRowsOf(visible.lastFrame()));
      expect(hidden.lastFrame().split('\n').at(-1)).toBe(NOTE(7));
      await end(visible);
      await end(hidden);
    });
  });

  describe('copy keys', () => {
    const summary = (session: ReturnType<typeof startSession>) => session.lastFrame().split('\n')[1];

    it('copies the route line with c and the route --high line with C, flashing copied: for 2 s', async () => {
      const session = startSession();
      await session.settleRound(0);
      const boxes = session.lastFrame().split('\n').slice(2, 6).join('\n');
      expect(boxes).toContain('model-a high');
      expect(boxes).toContain('model-h1 max');
      session.press('c');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.clipboard.copy).toHaveBeenLastCalledWith('model-a high claude');
      expect(summary(session)).toBe('copied: model-a high claude');
      await vi.advanceTimersByTimeAsync(1999);
      expect(summary(session)).toBe('copied: model-a high claude');
      await vi.advanceTimersByTimeAsync(1);
      expect(summary(session)).toContain('next reset');
      session.press('C');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.clipboard.copy).toHaveBeenLastCalledWith('model-h1 max claude');
      expect(summary(session)).toBe('copied: model-h1 max claude');
      session.press('q');
      await session.finished;
    });

    it('flashes sent to terminal: when only the OSC 52 fallback was used', async () => {
      const session = startSession({ copy: async () => 'terminal' });
      await session.settleRound(0);
      session.press('c');
      await vi.advanceTimersByTimeAsync(0);
      expect(summary(session)).toBe('sent to terminal: model-a high claude');
      session.press('q');
      await session.finished;
    });

    it('copies nothing and flashes nothing to copy while the first round is unsettled', async () => {
      const session = startSession();
      session.press('c');
      session.press('C');
      expect(session.clipboard.copy).not.toHaveBeenCalled();
      expect(summary(session)).toBe('nothing to copy');
      session.press('q');
      await session.finished;
    });

    it('copies nothing and flashes nothing to copy when routes.json is bad', async () => {
      const session = startSession({ routes: { fault: { path: '/x/routes.json', problem: 'bad routes.json' } } });
      await session.settleRound(0);
      session.press('c');
      session.press('C');
      expect(session.clipboard.copy).not.toHaveBeenCalled();
      expect(summary(session)).toBe('nothing to copy');
      session.press('q');
      await session.finished;
    });

    it('copies nothing when the answer is none', async () => {
      const session = startSession({ state: Object.fromEntries(IDS.map((id) => [id, false])) });
      await session.settleRound(0);
      session.press('c');
      expect(session.clipboard.copy).not.toHaveBeenCalled();
      expect(summary(session)).toBe('nothing to copy');
      session.press('q');
      await session.finished;
    });

    it('flashes copy failed and keeps running when the clipboard fails', async () => {
      const session = startSession({ copy: async () => 'failed' });
      await session.settleRound(0);
      session.press('c');
      await vi.advanceTimersByTimeAsync(0);
      expect(summary(session)).toBe('copy failed');
      await vi.advanceTimersByTimeAsync(2000);
      expect(summary(session)).toContain('next reset');
      session.press('q');
      await session.finished;
    });

    it('does not flash when the copy settles after quit', async () => {
      let finish: (result: CopyResult) => void = () => undefined;
      const session = startSession({ copy: () => new Promise((resolve) => (finish = resolve)) });
      await session.settleRound(0);
      session.press('c');
      session.press('q');
      await session.finished;
      finish('command');
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

function windowUsage(id: string, window: Usage['windows'][number]): Usage {
  return { id, displayName: id, planLabel: 'plan', windows: [window], fetchedAt: START, status: 'ok' };
}

function weekly(usedPct: number, resetsAt = '2026-09-18T10:00:00.000Z'): Usage['windows'][number] {
  return { label: 'weekly', kind: 'weekly', usedPct, resetsAt };
}

async function roundsOf(env: Record<string, string | undefined>, windows: Usage['windows'][number][]) {
  return usageRoundsOf(env, windows.map((window) => windowUsage('claude', window)));
}

async function usageRoundsOf(env: Record<string, string | undefined>, usages: Usage[]) {
  const notify = vi.fn();
  const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1', ...env }, notifier: { notify } });
  for (const [round, usage] of usages.entries()) {
    await session.settleRound(round, { claude: usage });
    await vi.advanceTimersByTimeAsync(1000);
  }
  session.press('q');
  await session.finished;
  return notify.mock.calls.map(([text]) => text);
}

describe('notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(START));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([[undefined], ['']])('never calls the notifier when DANDELION_NOTIFY is %j', async (value) => {
    expect(await roundsOf({ DANDELION_NOTIFY: value }, [weekly(79), weekly(96)])).toEqual([]);
  });

  const failed = (status: 'error' | 'unavailable'): Usage => ({ id: 'claude', displayName: 'claude', windows: [], fetchedAt: START, status, reason: 'down' });
  const ok = (usedPct: number): Usage => windowUsage('claude', weekly(usedPct));

  it.each(['error', 'unavailable'] as const)('notifies once for 80%% when a %s round sits between 70%% and 85%%', async (status) => {
    expect(await usageRoundsOf({ DANDELION_NOTIFY: '1' }, [ok(70), failed(status), ok(85), ok(86)])).toEqual(['claude weekly at 85%']);
  });

  it('notifies at 80% and at 95% once each when failed rounds separate 70%, 85% and 96%', async () => {
    expect(await usageRoundsOf({ DANDELION_NOTIFY: '1' }, [ok(70), failed('error'), ok(85), failed('unavailable'), ok(96), ok(97)])).toEqual(['claude weekly at 85%', 'claude weekly at 96%']);
  });

  it('treats the first ok result after a failed first round as a baseline only', async () => {
    expect(await usageRoundsOf({ DANDELION_NOTIFY: '1' }, [failed('error'), ok(85), ok(86)])).toEqual([]);
  });

  it('notifies once at 80% and once more at 95%', async () => {
    expect(await roundsOf({ DANDELION_NOTIFY: '1' }, [weekly(79), weekly(80), weekly(94), weekly(95)])).toEqual(['claude weekly at 80%', 'claude weekly at 95%']);
  });

  it('uses DANDELION_NOTIFY_THRESHOLDS and notifies each threshold once per reset period', async () => {
    const env = { DANDELION_NOTIFY: '1', DANDELION_NOTIFY_THRESHOLDS: ' 50 , 90 ' };
    expect(await roundsOf(env, [weekly(40), weekly(55), weekly(85), weekly(60), weekly(56), weekly(92), weekly(30), weekly(95)])).toEqual(['claude weekly at 55%', 'claude weekly at 92%']);
  });

  it('treats the first round as a baseline and stays quiet while a window stays hot', async () => {
    expect(await roundsOf({ DANDELION_NOTIFY: '1' }, [weekly(85), weekly(85), weekly(88)])).toEqual([]);
  });

  it('notifies about a threshold again in a new reset period but not twice in the same one', async () => {
    const next = '2026-09-25T10:00:00.000Z';
    const texts = await roundsOf({ DANDELION_NOTIFY: '1' }, [weekly(70), weekly(81), weekly(70), weekly(82), weekly(10, next), weekly(83, next)]);
    expect(texts).toEqual(['claude weekly at 81%', 'claude weekly at 83%']);
  });

  it('notifies once when a rolling window recovers from a trip', async () => {
    const rolling = (usedPct: number) => ({ label: '5h', kind: 'rolling' as const, usedPct, resetsAt: '2026-09-13T15:00:00.000Z' });
    expect(await roundsOf({ DANDELION_NOTIFY: '1' }, [rolling(91), rolling(40), rolling(30)])).toEqual(['claude 5h recovered at 40%']);
  });

  it('notifies once when a weekly window starts to evaporate', async () => {
    const tonight = '2026-09-13T20:00:00.000Z';
    expect(await roundsOf({ DANDELION_NOTIFY: '1' }, [weekly(2, tonight), weekly(50, tonight), weekly(51, tonight)])).toEqual(['claude weekly is evaporating, resets in 9h59m']);
  });

  it('notifies a weekly reset once even when later rounds repeat the values', async () => {
    const past = '2026-09-13T09:59:30.000Z';
    const next = '2026-09-25T10:00:00.000Z';
    expect(await roundsOf({ DANDELION_NOTIFY: '1' }, [weekly(70, past), weekly(3, next), weekly(3, next), weekly(4, next)])).toEqual(['claude weekly reset: 3% used']);
  });
});

describe('fix key', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(START));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const FIX = { command: 'grok', args: ['--once'], env: { CLAUDE_CONFIG_DIR: '/work' } };
  const withFix = (id: string): Usage => ({ ...usageOf(id, START), fix: FIX });
  const grokOnly = { grok: withFix('grok') };

  async function selectGrok(session: ReturnType<typeof startSession>) {
    await session.settleRound(0, grokOnly);
    ['j', 'j', 'j', 'j'].forEach((key) => session.press(key));
  }

  it('leaves the alternate screen, runs the fix once, then restores the screen and starts a round', async () => {
    let finish: (status: number) => void = () => undefined;
    const session = startSession({ spawn: () => new Promise((resolve) => (finish = resolve)) });
    await selectGrok(session);
    const framesBefore = session.frames().length;
    const writesBefore = session.writes.length;
    session.press('x');
    expect(session.writes.slice(writesBefore)).toEqual([LEAVE_ALTERNATE]);
    expect(session.keyboard.setRawMode).toHaveBeenLastCalledWith(false);
    expect(session.keyboard.pause).toHaveBeenCalledTimes(1);
    expect(session.spawner.spawn).toHaveBeenCalledTimes(1);
    expect(session.spawner.spawn).toHaveBeenCalledWith({ command: 'grok', args: ['--once'], env: { CLAUDE_CONFIG_DIR: '/work' } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(session.writes.length).toBe(writesBefore + 1);
    expect(session.probes[0].calls).toHaveLength(1);
    finish(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.writes[writesBefore + 1]).toBe(ENTER_ALTERNATE);
    expect(session.keyboard.setRawMode).toHaveBeenLastCalledWith(true);
    expect(session.keyboard.resume).toHaveBeenCalledTimes(1);
    expect(session.frames().length).toBeGreaterThan(framesBefore);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
    session.press('q');
    await session.finished;
  });

  it('ignores SIGINT while the fix runs, then removes the handler and restores the dashboard', async () => {
    let finish: (status: number) => void = () => undefined;
    const session = startSession({ spawn: () => new Promise((resolve) => (finish = resolve)) });
    await selectGrok(session);
    expect(session.handlers).toHaveLength(0);
    session.press('x');
    expect(session.handlers).toHaveLength(1);
    session.interrupt();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.stopChildren).not.toHaveBeenCalled();
    expect(session.keyboard.setRawMode).toHaveBeenLastCalledWith(false);
    finish(130);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.handlers).toHaveLength(0);
    expect(session.signals.off).toHaveBeenCalledTimes(1);
    expect(session.writes.at(-3)).toBe(ENTER_ALTERNATE);
    expect(session.keyboard.setRawMode).toHaveBeenLastCalledWith(true);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
    expect(session.stopChildren).not.toHaveBeenCalled();
    session.press('\x03');
    await session.finished;
    expect(session.stopChildren).toHaveBeenCalledTimes(1);
  });

  it('starts no probe and sends no notification while the fix runs, and runs the first round after it exits', async () => {
    let finish: (status: number) => void = () => undefined;
    const reset = '2026-09-13T10:02:00.000Z';
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_NOTIFY: '1', DANDELION_REFRESH_SECONDS: '60' }, spawn: () => new Promise((resolve) => (finish = resolve)) });
    await session.settleRound(0, { grok: withFix('grok'), claude: windowUsage('claude', weekly(10, reset)) });
    ['j', 'j', 'j', 'j'].forEach((key) => session.press(key));
    session.press('r');
    await vi.advanceTimersByTimeAsync(0);
    session.press('x');
    session.probes.forEach(({ probe, calls }) => calls[1].resolve(probe.id === 'claude' ? windowUsage('claude', weekly(96, reset)) : usageOf(probe.id, calls[1].now)));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
    expect(session.notifier.notify).not.toHaveBeenCalled();
    finish(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 3));
    session.press('q');
    await session.finished;
  });

  const heldBack = async (before: Usage, during: Usage, key: string) => {
    let finish: (status: number) => void = () => undefined;
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_NOTIFY: '1', DANDELION_REFRESH_SECONDS: '60' }, spawn: () => new Promise((resolve) => (finish = resolve)) });
    await session.settleRound(0, { claude: before });
    session.press('r');
    await vi.advanceTimersByTimeAsync(0);
    session.press(key);
    session.probes.forEach(({ probe, calls }) => calls[1].resolve(probe.id === 'claude' ? during : usageOf(probe.id, calls[1].now)));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.notifier.notify).not.toHaveBeenCalled();
    finish(0);
    await vi.advanceTimersByTimeAsync(0);
    return session;
  };

  const settleNextRound = async (session: Awaited<ReturnType<typeof heldBack>>, claude: Usage) => {
    await session.settleRound(2, { claude });
    session.press('q');
    await session.finished;
    return session.notifier.notify;
  };

  it('sends a threshold crossing that settled during an l command once after it exits', async () => {
    const session = await heldBack(windowUsage('claude', weekly(10)), windowUsage('claude', weekly(96)), 'l');
    expect(session.notifier.notify).toHaveBeenCalledTimes(1);
    expect(session.notifier.notify).toHaveBeenCalledWith('claude weekly at 96%');
    const notify = await settleNextRound(session, windowUsage('claude', weekly(96)));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('sends the 80% crossing held back during an L command once after it exits', async () => {
    const session = await heldBack(windowUsage('claude', weekly(10)), windowUsage('claude', weekly(85)), 'L');
    expect(vi.mocked(session.notifier.notify).mock.calls).toEqual([['claude weekly at 85%']]);
    const notify = await settleNextRound(session, windowUsage('claude', weekly(86)));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('sends a recovered account held back during the command after it exits', async () => {
    const rolling = (usedPct: number) => windowUsage('claude', { label: '5h', kind: 'rolling', usedPct, resetsAt: '2026-09-13T15:00:00.000Z' });
    const session = await heldBack(rolling(91), rolling(40), 'l');
    expect(vi.mocked(session.notifier.notify).mock.calls).toEqual([['claude 5h recovered at 40%']]);
    const notify = await settleNextRound(session, rolling(30));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('sends a weekly reset held back during the command after it exits', async () => {
    const session = await heldBack(windowUsage('claude', weekly(70, '2026-09-13T09:59:30.000Z')), windowUsage('claude', weekly(3, '2026-09-25T10:00:00.000Z')), 'l');
    expect(vi.mocked(session.notifier.notify).mock.calls).toEqual([['claude weekly reset: 3% used']]);
    const notify = await settleNextRound(session, windowUsage('claude', weekly(3, '2026-09-25T10:00:00.000Z')));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('runs with an empty env when the fix has none and still restores when the command is missing', async () => {
    const session = startSession({ spawn: async () => 'missing' });
    await session.settleRound(0, { grok: { ...usageOf('grok', START), fix: { command: 'junie', args: [] } } });
    ['j', 'j', 'j', 'j'].forEach((key) => session.press(key));
    session.press('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.spawner.spawn).toHaveBeenCalledWith({ command: 'junie', args: [], env: {} });
    expect(session.writes.at(-3)).toBe(ENTER_ALTERNATE);
    expect(session.keyboard.setRawMode).toHaveBeenLastCalledWith(true);
    session.press('q');
    await session.finished;
  });

  it('does not start a second round while one is already running', async () => {
    const session = startSession();
    await vi.advanceTimersByTimeAsync(0);
    session.press('j');
    session.probes[0].calls[0].resolve(withFix('claude'));
    await vi.advanceTimersByTimeAsync(0);
    session.press('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.spawner.spawn).toHaveBeenCalledTimes(1);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 1));
    session.press('q');
    await session.finished;
  });

  it('does not redraw into the child while it runs and does not restore after quitting', async () => {
    let finish: (status: number) => void = () => undefined;
    const session = startSession({ spawn: () => new Promise((resolve) => (finish = resolve)) });
    await selectGrok(session);
    session.press('x');
    session.deliver('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    const writes = session.writes.length;
    finish(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.writes.length).toBe(writes);
    expect(session.keyboard.resume).not.toHaveBeenCalled();
    await session.finished;
  });

  it('offers the kimi expired-token fix on its caption and runs it with x', async () => {
    const session = startSession({ spawn: async () => 0 });
    const expired: Usage = { id: 'kimi', displayName: 'kimi', planLabel: 'kimi code', windows: [], fetchedAt: START, status: 'unavailable', reason: 'kimi token expired — run kimi once', fix: { command: 'kimi', args: [] } };
    await session.settleRound(0, { kimi: expired });
    expect(session.lastFrame().split('\n').filter((line) => line.endsWith(' · x fix'))).toHaveLength(1);
    ['j', 'j', 'j'].forEach((key) => session.press(key));
    session.press('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.spawner.spawn).toHaveBeenCalledWith({ command: 'kimi', args: [], env: {} });
    session.press('q');
    await session.finished;
  });

  it('does nothing without a selection', async () => {
    const session = startSession();
    await session.settleRound(0, grokOnly);
    const writes = session.writes.length;
    session.press('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.spawner.spawn).not.toHaveBeenCalled();
    expect(session.writes.length).toBe(writes);
    expect(session.lastFrame()).not.toContain('no fix for this panel');
    session.press('q');
    await session.finished;
  });

  it.each([['a settled panel without a fix', 1], ['a panel still probing', 2]])('flashes no fix for this panel on %s', async (_, steps) => {
    const session = startSession();
    await session.settleRound(0, { agy: usageOf('agy', START) });
    if (steps === 2) session.probes[2].calls[0].resolve = () => undefined;
    for (let step = 0; step < steps; step += 1) session.press('j');
    session.press('x');
    expect(session.spawner.spawn).not.toHaveBeenCalled();
    expect(session.lastFrame()).toContain('no fix for this panel');
    await vi.advanceTimersByTimeAsync(2000);
    expect(session.lastFrame()).not.toContain('no fix for this panel');
    session.press('q');
    await session.finished;
  });

  it('shows · x fix on the caption of a panel with a fix only', async () => {
    const session = startSession();
    await session.settleRound(0, grokOnly);
    const lines = session.lastFrame().split('\n');
    expect(lines.filter((line) => line.endsWith(' · x fix'))).toEqual([expect.stringContaining('grok')]);
    session.press('q');
    await session.finished;
  });

  it('lists x in the ? help', async () => {
    const session = startSession();
    session.press('?');
    expect(session.lastFrame()).toContain('R refresh panel · s sort · x fix · l/L launch');
    session.press('q');
    await session.finished;
  });

  describe('a failed re-probe', () => {
    const failure = (id: string, now: string): Usage => ({ id, displayName: id, windows: [], fetchedAt: now, status: 'error', reason: 'claude timed out after 90s' });
    const fail = async (session: ReturnType<typeof startSession>, round: number, overrides: Record<string, Usage> = {}) => {
      await session.settleRound(round, { claude: failure('claude', session.probes[0].calls[round].now), ...overrides });
    };

    it('keeps the previous rows dimmed with the reason and the age of the good data, then recovers', async () => {
      const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '420' } });
      await session.settleRound(0);
      await vi.advanceTimersByTimeAsync(420000);
      await fail(session, 1);
      const lines = session.lastFrame().split('\n');
      const at = lines.indexOf('claude');
      expect(lines.slice(at, at + 4)).toEqual(['claude', `${'weekly'.padEnd(35)} ##------------------  10%`, 'last probe failed: claude timed out after 90s', 'plan · claude · 0h7m ago']);
      await vi.advanceTimersByTimeAsync(420000);
      await session.settleRound(2);
      expect(session.lastFrame()).not.toContain('last probe failed');
      expect(session.lastFrame()).toContain('plan · claude · 0h0m ago');
      session.press('q');
      await session.finished;
    });

    it('draws a first-time failure as the plain reason panel', async () => {
      const session = startSession();
      await fail(session, 0);
      const lines = session.lastFrame().split('\n');
      const at = lines.indexOf('claude');
      expect(lines.slice(at, at + 3)).toEqual(['claude', 'claude timed out after 90s', 'claude · 0h0m ago']);
      expect(session.lastFrame()).not.toContain('last probe failed');
      session.press('q');
      await session.finished;
    });

    it('draws no ANSI escape in the remembered panel under NO_COLOR', async () => {
      const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' } });
      await session.settleRound(0);
      await vi.advanceTimersByTimeAsync(1000);
      await fail(session, 1);
      expect(session.lastFrame()).toContain('last probe failed');
      expect(session.lastFrame()).not.toContain('\x1b');
      session.press('q');
      await session.finished;
    });

    it('still routes, copies and records history as if the provider were unavailable', async () => {
      const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' } });
      await session.settleRound(0);
      session.press('c');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.clipboard.copy).toHaveBeenLastCalledWith(expect.stringContaining('model-a'));
      await vi.advanceTimersByTimeAsync(1000);
      await fail(session, 1);
      session.press('c');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.clipboard.copy).toHaveBeenLastCalledWith(expect.not.stringContaining('model-a'));
      const samples = JSON.parse(session.historyReplace.mock.calls.at(-1)?.[1] ?? '[]');
      expect(samples.filter((sample: { id: string }) => sample.id === 'claude')).toHaveLength(1);
      expect(samples.filter((sample: { id: string; at: string }) => sample.id === 'claude' && sample.at !== START)).toEqual([]);
      session.press('q');
      await session.finished;
    });
  });

  describe('claude status line', () => {
    const MAJOR: ClaudeStatus = { severity: 'hot', description: 'Partial System Outage' };

    it('fetches once per full round and not on a single-panel refresh', async () => {
      const statusProbe = vi.fn(async () => MAJOR);
      const session = startSession({ statusProbe });
      expect(statusProbe).toHaveBeenCalledTimes(1);
      await session.settleRound(0);
      session.press('j');
      session.press('R');
      session.press('\r');
      await vi.advanceTimersByTimeAsync(0);
      expect(statusProbe).toHaveBeenCalledTimes(1);
      session.press('r');
      expect(statusProbe).toHaveBeenCalledTimes(2);
      session.press('q');
      await session.finished;
    });

    it('shows the line under claude only and drops it when the next round finds none', async () => {
      let status: ClaudeStatus | undefined = MAJOR;
      const session = startSession({ statusProbe: async () => status });
      await session.settleRound(0);
      const lines = session.lastFrame().split('\n');
      expect(lines[lines.indexOf('claude') + 1]).toBe('status: Partial System Outage');
      expect(lines.filter((line) => line.startsWith('status:'))).toHaveLength(1);
      status = undefined;
      session.press('r');
      await session.settleRound(1);
      expect(session.lastFrame()).not.toContain('status:');
      session.press('q');
      await session.finished;
    });
  });
});

describe('external eligibility changes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(START));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const PAIR = ['claude', 'claude-work'];
  const WORK_ENV = { NO_COLOR: '1', DANDELION_CLAUDE_WORK_CONFIG_DIR: '/work' };
  const routeBox = (session: ReturnType<typeof startSession>) => session.lastFrame().split('\n').slice(2, 4).join('\n');
  const claudeSession = async () => {
    const session = startSession({ ids: PAIR, env: WORK_ENV });
    await session.settleRound(0);
    return session;
  };

  it('shows the new routing at the next full round', async () => {
    const session = await claudeSession();
    expect(routeBox(session)).toContain('model-a high');
    expect(session.lastFrame()).not.toContain('routing off');
    session.disk.text = '{"claude": false}';
    session.press('r');
    await session.settleRound(1);
    expect(session.lastFrame()).toMatch(/^claude +.*routing off/m);
    expect(session.lastFrame()).not.toMatch(/claude-work.*routing off/);
    expect(routeBox(session)).toContain('model-a high');
    session.disk.text = '{"claude": false, "claude-work": false}';
    session.press('r');
    await session.settleRound(2);
    expect(routeBox(session)).not.toContain('model-a high');
    expect(session.lastFrame()).toMatch(/^claude-work +.*routing off/m);
    session.press('q');
    await session.finished;
  });

  it('reloads after a single-panel re-probe settles', async () => {
    const session = await claudeSession();
    session.press('j');
    session.disk.text = '{"claude": false}';
    session.press('R');
    session.probes[0].calls[1].resolve(usageOf('claude', START));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.lastFrame()).toMatch(/claude +#*-*.*routing off/);
    session.press('q');
    await session.finished;
  });

  it('copies and launches the route that skips the provider turned off meanwhile', async () => {
    const session = await claudeSession();
    session.disk.text = '{"claude": false}';
    session.press('c');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.clipboard.copy).toHaveBeenLastCalledWith(expect.stringContaining('claude-work'));
    session.disk.text = '{"claude-work": false}';
    session.press('L');
    await vi.advanceTimersByTimeAsync(0);
    session.disk.text = '{"claude": false}';
    session.press('C');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.clipboard.copy).toHaveBeenLastCalledWith(expect.stringContaining('claude-work'));
    session.disk.text = '{"claude-work": false}';
    session.press('L');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.spawner.spawn).toHaveBeenLastCalledWith({ command: 'claude', args: ['--model', 'model-h1', '--effort', 'max'], env: {} });
    session.disk.text = '{"claude": false}';
    session.press('l');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.spawner.spawn).toHaveBeenLastCalledWith({ command: 'claude', args: ['--model', 'model-a', '--effort', 'high'], env: { CLAUDE_CONFIG_DIR: '/work' } });
    session.press('q');
    await session.finished;
  });

  it('treats a corrupt state file read during a round as every provider eligible', async () => {
    const session = await claudeSession();
    session.disk.text = '{"claude": false}';
    session.press('r');
    await session.settleRound(1);
    session.disk.text = '{not json';
    session.press('r');
    await session.settleRound(2);
    expect(session.lastFrame()).not.toContain('routing off');
    session.press('q');
    await session.finished;
  });

  it('does not read the state file on plain frame redraws', async () => {
    const session = await claudeSession();
    session.press('r');
    const reads = session.stateReads.mock.calls.length;
    const framesBefore = session.frames().length;
    await vi.advanceTimersByTimeAsync(1000);
    session.press('?');
    session.press('?');
    session.press('j');
    expect(session.frames().length).toBeGreaterThan(framesBefore + 5);
    expect(session.stateReads.mock.calls.length).toBe(reads);
    session.press('q');
    await session.finished;
  });
});

describe('re-probe after a reset', () => {
  const RESET = '2026-09-13T10:05:00.000Z';
  const tripped = (id: string, fetchedAt: string, usedPct = 95): Usage => ({ ...usageOf(id, fetchedAt), windows: [{ label: '5h', kind: 'rolling', usedPct, resetsAt: RESET }] });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(START));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const counts = (session: ReturnType<typeof startSession>) => session.probes.map(({ calls }) => calls.length);

  it('re-probes only that provider 60s after its reset, keeping rows and a spinner, then recomputes', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '3600' } });
    await session.settleRound(0, { claude: tripped('claude', START) });
    const avoiding = boxRowsOf(session.lastFrame());
    expect(avoiding.join('\n')).not.toContain('claude');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 59 * 1000);
    expect(counts(session)).toEqual(IDS.map(() => 1));
    await vi.advanceTimersByTimeAsync(1100);
    expect(counts(session)).toEqual([2, ...IDS.slice(1).map(() => 1)]);
    expect(session.lastFrame()).toMatch(/claude [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    expect(session.lastFrame()).toContain('95%');
    expect(boxRowsOf(session.lastFrame())).toEqual(avoiding);
    session.probes[0].calls[1].resolve(tripped('claude', session.probes[0].calls[1].now, 3));
    await vi.advanceTimersByTimeAsync(0);
    expect(boxRowsOf(session.lastFrame())).toEqual(boxBlock('model-a high', 'claude', 'model-h1 max', 'claude'));
    expect(session.lastFrame()).toContain('3%');
    expect(session.lastFrame()).not.toContain('95%');
    session.press('q');
    await session.finished;
  });

  it('re-probes at most once per passed reset value', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '3600' } });
    await session.settleRound(0, { claude: tripped('claude', START) });
    await vi.advanceTimersByTimeAsync(7 * 60 * 1000);
    session.probes[0].calls[1].resolve(tripped('claude', session.probes[0].calls[1].now));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(session.probes[0].calls).toHaveLength(2);
    session.press('q');
    await session.finished;
  });

  it('waits for a running round and does not re-probe a panel already probing', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '3600' } });
    await session.settleRound(0, { claude: tripped('claude', START) });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    session.press('r');
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(counts(session)).toEqual(IDS.map(() => 2));
    session.probes.forEach(({ probe, calls }) => calls[1].resolve(probe.id === 'claude' ? tripped('claude', calls[1].now) : usageOf(probe.id, calls[1].now)));
    await vi.advanceTimersByTimeAsync(2000);
    expect(counts(session)).toEqual([3, ...IDS.slice(1).map(() => 2)]);
    session.press('q');
    await session.finished;
  });

  it('does not re-probe while the panel is probing on its own', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '3600' } });
    await session.settleRound(0, { claude: tripped('claude', START) });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1000);
    session.press('j');
    session.press('R');
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    expect(session.probes[0].calls).toHaveLength(2);
    session.probes[0].calls[1].resolve({ ...tripped('claude', session.probes[0].calls[1].now, 5), windows: [{ label: '5h', kind: 'rolling', usedPct: 5, resetsAt: '2026-09-13T15:00:00.000Z' }] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(session.probes[0].calls).toHaveLength(2);
    session.press('q');
    await session.finished;
  });

  describe('launch keys', () => {
    const summary = (session: ReturnType<typeof startSession>) => session.lastFrame().split('\n')[1];
    const WORK_ENV = { NO_COLOR: '1', DANDELION_CLAUDE_WORK_CONFIG_DIR: '/work' };

    it('launches the route line with l and the route --high line with L, as dandelion run does', async () => {
      const session = startSession({ ids: ['claude-work'], env: WORK_ENV });
      await session.settleRound(0);
      session.press('l');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.spawner.spawn).toHaveBeenLastCalledWith({ command: 'claude', args: ['--model', 'model-a', '--effort', 'high'], env: { CLAUDE_CONFIG_DIR: '/work' } });
      session.press('L');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.spawner.spawn).toHaveBeenCalledTimes(2);
      expect(session.spawner.spawn).toHaveBeenLastCalledWith({ command: 'claude', args: ['--model', 'model-h1', '--effort', 'max'], env: { CLAUDE_CONFIG_DIR: '/work' } });
      session.press('q');
      await session.finished;
    });

    it('runs in the foreground, starts no round meanwhile, then restores and starts one full round', async () => {
      let finish: (status: number) => void = () => undefined;
      const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' }, spawn: () => new Promise((resolve) => (finish = resolve)) });
      await session.settleRound(0);
      const writes = session.writes.length;
      session.press('l');
      expect(session.writes.slice(writes)).toEqual([LEAVE_ALTERNATE]);
      expect(session.keyboard.setRawMode).toHaveBeenLastCalledWith(false);
      expect(session.keyboard.pause).toHaveBeenCalledTimes(1);
      expect(session.handlers.length).toBe(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(session.writes.length).toBe(writes + 1);
      expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 1));
      finish(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(session.handlers.length).toBe(0);
      expect(session.writes[writes + 1]).toBe(ENTER_ALTERNATE);
      expect(session.keyboard.setRawMode).toHaveBeenLastCalledWith(true);
      expect(session.keyboard.resume).toHaveBeenCalledTimes(1);
      expect(session.frames().length).toBeGreaterThan(0);
      expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
      session.press('q');
      await session.finished;
    });

    it('flashes nothing to launch and spawns nothing while probing, on a none route and on a bad routes file', async () => {
      const probing = startSession();
      probing.press('l');
      expect(summary(probing)).toBe('nothing to launch');
      probing.press('q');
      await probing.finished;
      const none = startSession({ state: Object.fromEntries(IDS.map((id) => [id, false])) });
      await none.settleRound(0);
      none.press('L');
      expect(summary(none)).toBe('nothing to launch');
      none.press('q');
      await none.finished;
      const bad = startSession({ routes: { fault: { path: '/x/routes.json', problem: 'bad routes.json' } } });
      await bad.settleRound(0);
      bad.press('l');
      expect(summary(bad)).toBe('nothing to launch');
      for (const session of [probing, none, bad]) expect(session.spawner.spawn).not.toHaveBeenCalled();
      bad.press('q');
    });

    it('flashes command not found once the dashboard is restored when the command is missing', async () => {
      const session = startSession({ spawn: async () => 'missing' });
      await session.settleRound(0);
      session.press('l');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.writes).toContain(ENTER_ALTERNATE);
      expect(summary(session)).toBe('claude: command not found');
      await vi.advanceTimersByTimeAsync(2000);
      expect(summary(session)).not.toContain('command not found');
      session.press('q');
      await session.finished;
    });

    it.each([['ql'], ['qL'], ['qx'], ['\x03l'], ['q ']])('ignores the keys after quit in the chunk %j', async (chunk) => {
      const session = startSession({ ids: ['claude-work'], env: WORK_ENV });
      await session.settleRound(0);
      const before = session.lastFrame();
      session.press(chunk);
      await expect(session.finished).resolves.toBe(0);
      expect(session.spawner.spawn).not.toHaveBeenCalled();
      expect(session.saved()).toEqual([]);
      expect(session.lastFrame()).toBe(before);
    });

    it('starts no fix for a panel with a fix when x follows q in the chunk', async () => {
      const session = startSession();
      await session.settleRound(0, { grok: { ...usageOf('grok', START), fix: { command: 'grok', args: [], env: {} } } });
      ['j', 'j', 'j', 'j'].forEach((key) => session.press(key));
      session.press('qx');
      await expect(session.finished).resolves.toBe(0);
      expect(session.spawner.spawn).not.toHaveBeenCalled();
    });

    it('still starts only one command for ll', async () => {
      const session = startSession({ ids: ['claude-work'], env: WORK_ENV, spawn: () => new Promise(() => undefined) });
      await session.settleRound(0);
      session.press('ll');
      expect(session.spawner.spawn).toHaveBeenCalledTimes(1);
    });

    it('does not flash a missing command after quitting', async () => {
      let finish: (status: 'missing') => void = () => undefined;
      const session = startSession({ spawn: () => new Promise((resolve) => (finish = resolve)) });
      await session.settleRound(0);
      session.press('l');
      session.deliver('SIGTERM');
      finish('missing');
      await session.finished;
      expect(session.lastFrame()).not.toContain('command not found');
    });
  });
});

describe('foreground command', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(START));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const withFix = (id: string): Usage => ({ ...usageOf(id, START), fix: { command: 'grok', args: [], env: {} } });

  function holding() {
    const exits: ((status: number) => void)[] = [];
    const session = startSession({ spawn: () => new Promise((resolve) => exits.push(resolve)) });
    return { session, exits };
  }

  it.each(['ll', 'lL', 'Ll'])('spawns one command and restores the screen once for the chunk %s', async (chunk) => {
    const { session, exits } = holding();
    await session.settleRound(0);
    const enters = () => session.writes.filter((text) => text === ENTER_ALTERNATE).length;
    const enteredBefore = enters();
    session.press(chunk);
    expect(session.spawner.spawn).toHaveBeenCalledTimes(1);
    exits[0](0);
    await vi.advanceTimersByTimeAsync(0);
    expect(enters()).toBe(enteredBefore + 1);
    expect(session.keyboard.resume).toHaveBeenCalledTimes(1);
  });

  it('spawns one fix and restores the screen once for the chunk xx', async () => {
    const { session, exits } = holding();
    await session.settleRound(0, { grok: withFix('grok') });
    ['j', 'j', 'j', 'j'].forEach((key) => session.press(key));
    const enters = () => session.writes.filter((text) => text === ENTER_ALTERNATE).length;
    const enteredBefore = enters();
    session.press('xx');
    expect(session.spawner.spawn).toHaveBeenCalledTimes(1);
    exits[0](0);
    await vi.advanceTimersByTimeAsync(0);
    expect(enters()).toBe(enteredBefore + 1);
  });

  it('starts no round for keys that follow the launch in the same chunk, then one round after it exits', async () => {
    const { session, exits } = holding();
    await session.settleRound(0);
    session.press('lrR');
    expect(session.probes.every(({ calls }) => calls.length === 1)).toBe(true);
    exits[0](0);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.probes.every(({ calls }) => calls.length === 2)).toBe(true);
  });

  it('ignores every key while the command runs, including quit', async () => {
    const { session, exits } = holding();
    await session.settleRound(0);
    session.press('l');
    session.press('q');
    session.press('\x03');
    session.press('l');
    expect(session.stopChildren).not.toHaveBeenCalled();
    expect(session.spawner.spawn).toHaveBeenCalledTimes(1);
    exits[0](0);
    await vi.advanceTimersByTimeAsync(0);
    session.press('q');
    await session.finished;
  });

  it.each([['SIGTERM', 143], ['SIGHUP', 129]])('forwards %s to the running command and finishes with %i only once it has exited', async (name, code) => {
    let exited: () => void = () => undefined;
    const session = startSession();
    session.spawner.terminate.mockImplementation(() => new Promise<void>((resolve) => (exited = resolve)));
    await session.settleRound(0);
    session.press('l');
    let result: number | undefined;
    void session.finished.then((value) => (result = value));
    session.deliver(name);
    await vi.advanceTimersByTimeAsync(10000);
    expect(session.spawner.terminate).toHaveBeenCalledTimes(1);
    expect(session.spawner.terminate).toHaveBeenCalledWith(name);
    expect(session.stopChildren).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    exited();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.stopChildren).toHaveBeenCalledTimes(1);
    expect(result).toBe(code);
  });

  it('does not terminate a command when none is running', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.deliver('SIGTERM');
    expect(await session.finished).toBe(143);
    expect(session.spawner.terminate).not.toHaveBeenCalled();
  });

  function pendingStop() {
    let release: () => void = () => undefined;
    const stopChildren = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const session = startSession({ stopChildren });
    let result: number | undefined;
    void session.finished.then((value) => (result = value));
    return { session, release: () => release(), result: () => result };
  }

  it('absorbs a SIGHUP after SIGTERM while the foreground command is still exiting', async () => {
    let exited: () => void = () => undefined;
    const session = startSession();
    session.spawner.terminate.mockImplementation(() => new Promise<void>((resolve) => (exited = resolve)));
    await session.settleRound(0);
    session.press('l');
    let result: number | undefined;
    void session.finished.then((value) => (result = value));
    session.deliver('SIGTERM');
    session.deliver('SIGHUP');
    await vi.advanceTimersByTimeAsync(10000);
    expect(session.spawner.terminate).toHaveBeenCalledTimes(1);
    expect(session.spawner.terminate).toHaveBeenCalledWith('SIGTERM');
    expect(session.stopChildren).not.toHaveBeenCalled();
    exited();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.stopChildren).toHaveBeenCalledTimes(1);
    expect(result).toBe(143);
  });

  it('absorbs a SIGTERM after SIGHUP while stopChildren is pending', async () => {
    const { session, release, result } = pendingStop();
    await session.settleRound(0);
    session.deliver('SIGHUP');
    session.deliver('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(result()).toBeUndefined();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.stopChildren).toHaveBeenCalledTimes(1);
    expect(result()).toBe(129);
  });

  it('absorbs a SIGTERM after q while stopChildren is pending', async () => {
    const { session, release, result } = pendingStop();
    await session.settleRound(0);
    session.press('q');
    session.deliver('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(result()).toBeUndefined();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.stopChildren).toHaveBeenCalledTimes(1);
    expect(result()).toBe(0);
  });

  it('keeps the handlers until done and removes both of them when it is called', async () => {
    const { session, release, result } = pendingStop();
    await session.settleRound(0);
    session.deliver('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.handlersFor('SIGTERM')).toHaveLength(1);
    expect(session.handlersFor('SIGHUP')).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(result()).toBe(143);
    expect(session.handlersFor('SIGTERM')).toHaveLength(0);
    expect(session.handlersFor('SIGHUP')).toHaveLength(0);
  });
});
