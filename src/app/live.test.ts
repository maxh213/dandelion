import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProbe } from '../probes/index.ts';
import { openEligibility, openHidden } from '../render/index.ts';
import { startLive } from './live.ts';

const LINES = {
  route: {
    claude: { standard: 'model-a high', max: 'model-a max' },
    'claude-work': { standard: 'model-a high', max: 'model-a max' },
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
  hiddenText?: string;
  hiddenSaves?: boolean[];
};

function startSession(overrides: SessionOverrides = {}) {
  const { env, stopChildren, state, zone, rows, hiddenText, hiddenSaves } = { env: { NO_COLOR: '1' }, stopChildren: vi.fn(async () => undefined), state: {}, zone: 'UTC', rows: 60, ...overrides };
  const writes: string[] = [];
  const probes = IDS.map((id) => deferredProbe(id, writes));
  const keyboard = Object.assign(new EventEmitter(), { setRawMode: vi.fn(), setEncoding: vi.fn(), pause: vi.fn() });
  const screen = Object.assign(new EventEmitter(), { rows, write: (text: string) => writes.push(text) });
  const replace = vi.fn<(path: string, text: string) => boolean>(() => true);
  const eligibility = openEligibility({}, '/home/u', { read: () => JSON.stringify(state), replace });
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
  const finished = startLive({ probes: probes.map(({ probe }) => probe), env, keyboard, screen, stopChildren, eligibility, hidden, routes: { lines: LINES }, zone });
  const frames = () => writes.filter((text) => text.startsWith(CLEAR)).map((text) => text.slice(CLEAR.length));
  const settleRound = async (round: number, overrides: Record<string, Usage> = {}) => {
    probes.forEach(({ probe, calls }) => calls[round].resolve(overrides[probe.id] ?? usageOf(probe.id, calls[round].now)));
    await vi.advanceTimersByTimeAsync(0);
  };
  return { writes, probes, keyboard, screen, finished, frames, stopChildren, replace, saved, hiddenReplace, hiddenSaved, settleRound, lastFrame: () => frames().at(-1) ?? '', press: (key: string) => keyboard.emit('data', key) };
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
    expect(lines.slice(10, 14)).toEqual(['agy', `${'weekly'.padEnd(35)} ##------------------  10%`, 'plan · agy', '='.repeat(72)]);
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

  it.each<[string | undefined, number]>([
    [undefined, 300],
    ['', 300],
    ['0', 300],
    ['-5', 300],
    ['2.5', 300],
    ['abc', 300],
    ['7', 7]
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

  it('ends a round even when a probe rejects', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' } });
    session.probes[0].calls[0].reject(new Error('boom'));
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.probes[1].calls).toHaveLength(2);
    session.press('q');
    await session.finished;
  });

  it('toggles the help footer with ? and ignores other keys', async () => {
    const session = startSession();
    await session.settleRound(0);
    session.press('?');
    expect(session.lastFrame().split('\n').at(-1)).toBe('keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help');
    session.press('?');
    expect(session.lastFrame()).not.toContain('keys:');
    const count = session.writes.length;
    session.press('x');
    session.press('R');
    session.press('\r');
    expect(session.writes).toHaveLength(count);
    expect(session.probes[0].calls).toHaveLength(1);
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
    expect(session.lastFrame().split('\n').at(-1)).toBe('keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help');
    session.press('?');
    expect(session.lastFrame()).not.toContain('keys:');
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

  it('scrolls a short session to the last panel and walks back to the first with the boxes in the chrome', async () => {
    const session = startSession({ rows: 12 });
    await session.settleRound(0);
    IDS.forEach(() => session.press('j'));
    const kilo = session.lastFrame().split('\n');
    expect(kilo.length).toBeLessThanOrEqual(12);
    expect(kilo[2]?.startsWith('+- route')).toBe(true);
    expect(kilo[6]).toBe('▸ kilo');
    expect(kilo).not.toContain('claude');
    IDS.slice(1).forEach(() => session.press('k'));
    const claude = session.lastFrame().split('\n');
    expect(claude.length).toBeLessThanOrEqual(12);
    expect(claude[2]?.startsWith('+- route')).toBe(true);
    expect(claude[6]).toBe('▸ claude');
    expect(claude.slice(2, 6).join('\n')).not.toContain('▸');
    session.press('?');
    expect(session.lastFrame().split('\n')).toEqual([...claude.slice(0, 10), 'h hide · H show hidden', 'keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help']);
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
    expect(lineAfter(session.lastFrame(), '▸ kilo', 2)).toBe('plan · kilo');
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
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('plan · codex');
    await vi.advanceTimersByTimeAsync(1000);
    session.press(' ');
    expect(lineAfter(session.lastFrame(), 'kilo', 2)).toBe('plan · kilo');
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(500);
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(1499);
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(1);
    expect(lineAfter(session.lastFrame(), '▸ codex', 2)).toBe('plan · codex');
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
    expect(lineAfter(session.lastFrame(), 'kilo', 2)).toBe('plan · kilo');
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

    async function settled(overrides: SessionOverrides = {}) {
      const session = startSession(overrides);
      await session.settleRound(0);
      return session;
    }

    async function end(session: { press(key: string): void; finished: Promise<void> }) {
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
      expect(headers(session.lastFrame())).toEqual(['▸ kimi', 'grok', 'codex', 'cursor', 'kilo']);
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
      expect(headers(session.lastFrame())[0]).toBe(HIDDEN_TAG('▸ agy'));
      session.press('h');
      expect(session.hiddenSaved().at(-1)).toEqual(['kilo']);
      expect(headers(session.lastFrame())[0]).toBe('▸ agy');
      session.press('H');
      expect(headers(session.lastFrame())).toEqual(['▸ agy', 'kimi', 'grok', 'codex', 'cursor']);
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
      expect(headers(session.lastFrame())[0]).toBe(HIDDEN_TAG('▸ kimi'));
      session.press('H');
      expect(headers(session.lastFrame())).toEqual(['▸ grok', 'codex', 'cursor', 'kilo']);
      await end(session);
    });

    it('j, k and the arrows step over hidden panels', async () => {
      const session = await settled({ hiddenText: '["agy","kimi"]' });
      session.press('j');
      session.press('\x1b[B');
      expect(headers(session.lastFrame())[0]).toBe('▸ grok');
      session.press('\x1b[A');
      expect(headers(session.lastFrame())).toEqual(['▸ claude', 'grok', 'codex', 'cursor', 'kilo']);
      session.press('k');
      expect(headers(session.lastFrame())[0]).toBe('▸ claude');
      session.press('j');
      session.press('j');
      session.press('j');
      session.press('j');
      session.press('j');
      expect(headers(session.lastFrame())).toEqual(['▸ kilo']);
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
});
