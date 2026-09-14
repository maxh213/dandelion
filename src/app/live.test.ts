import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProbe } from '../probes/index.ts';
import { openEligibility } from '../render/index.ts';
import { startLive } from './live.ts';

type Usage = Awaited<ReturnType<ProviderProbe['probe']>>;
type PendingCall = { now: string; resolve(usage: Usage): void; reject(error: Error): void };

const START = '2026-09-13T10:00:00.000Z';
const CLEAR = '\x1b[H\x1b[2J';
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

function startSession(env: Record<string, string | undefined> = { NO_COLOR: '1' }, stopChildren = vi.fn(async () => undefined), state: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const probes = IDS.map((id) => deferredProbe(id, writes));
  const keyboard = Object.assign(new EventEmitter(), { setRawMode: vi.fn(), setEncoding: vi.fn(), pause: vi.fn() });
  const replace = vi.fn<(path: string, text: string) => boolean>(() => true);
  const eligibility = openEligibility({}, '/home/u', { read: () => JSON.stringify(state), replace });
  const saved = () => replace.mock.calls.map(([, text]) => JSON.parse(text));
  const finished = startLive({ probes: probes.map(({ probe }) => probe), env, keyboard, screen: { write: (text: string) => writes.push(text) }, stopChildren, eligibility });
  const frames = () => writes.filter((text) => text.startsWith(CLEAR)).map((text) => text.slice(CLEAR.length));
  const settleRound = async (round: number, overrides: Record<string, Usage> = {}) => {
    probes.forEach(({ probe, calls }) => calls[round].resolve(overrides[probe.id] ?? usageOf(probe.id, calls[round].now)));
    await vi.advanceTimersByTimeAsync(0);
  };
  return { writes, probes, keyboard, finished, frames, stopChildren, replace, saved, settleRound, lastFrame: () => frames().at(-1) ?? '', press: (key: string) => keyboard.emit('data', key) };
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
    expect(lines.slice(0, 2)).toEqual(['DANDELION'.padEnd(63) + '10:00:00Z', 'all windows below 80% · next reset: none']);
    expect(lines.slice(2)).toEqual(IDS.flatMap((id) => ['='.repeat(72), id, '⠋ probing…']));
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
    expect(lines.slice(6, 10)).toEqual(['agy', `${'weekly'.padEnd(35)} ##------------------  10%`, 'plan · agy', '='.repeat(72)]);
    expect(lines.filter((line) => line === '⠋ probing…')).toHaveLength(6);
    expect(lines[0]).toBe('DANDELION'.padEnd(47) + 'data 0h0m old · 10:00:00Z');
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
    expect(session.lastFrame().split('\n')[0]).toBe('DANDELION'.padEnd(47) + 'data 0h0m old · 10:00:01Z');
    expect(session.lastFrame()).not.toContain('probing…');
    session.press('q');
    await session.finished;
  });

  it('starts the next round after the interval, keeps the data and marks the banner until it settles', async () => {
    const session = startSession({ NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' });
    await session.settleRound(0);
    expect(session.lastFrame().split('\n')[0]).not.toContain('refreshing…');
    await vi.advanceTimersByTimeAsync(999);
    expect(session.probes[0].calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.probes.map(({ calls }) => calls.length)).toEqual(IDS.map(() => 2));
    expect(session.probes[0].calls[1].now).toBe('2026-09-13T10:00:01.000Z');
    expect(session.lastFrame().split('\n')[0]).toBe('DANDELION'.padEnd(33) + 'refreshing… · data 0h0m old · 10:00:01Z');
    expect(session.lastFrame()).not.toContain('probing…');
    await session.settleRound(1);
    expect(session.lastFrame().split('\n')[0]).toBe('DANDELION'.padEnd(47) + 'data 0h0m old · 10:00:01Z');
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.probes[0].calls).toHaveLength(3);
    session.press('q');
    await session.finished;
  });

  it('keeps counting the data age from the oldest result while a refresh is partly settled', async () => {
    const session = startSession({ NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '60' });
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(60000);
    session.probes.slice(1).forEach(({ probe, calls }) => calls[1].resolve(usageOf(probe.id, calls[1].now)));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.lastFrame().split('\n')[0]).toBe('DANDELION'.padEnd(33) + 'refreshing… · data 0h1m old · 10:01:00Z');
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
    const session = startSession({ NO_COLOR: '1', DANDELION_REFRESH_SECONDS: value });
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
    expect(session.probes[4].calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.probes[4].calls).toHaveLength(2);
    session.press('q');
    await session.finished;
  });

  it('ends a round even when a probe rejects', async () => {
    const session = startSession({ NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1' });
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

  it('refreshes at once on r, ignores r while a round runs and restarts the interval after', async () => {
    const session = startSession({ NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '10' });
    session.press('r');
    expect(session.probes[0].calls).toHaveLength(1);
    await session.settleRound(0);
    await vi.advanceTimersByTimeAsync(5000);
    session.press('r');
    expect(session.probes[0].calls).toHaveLength(2);
    expect(session.lastFrame().split('\n')[0]).toContain('refreshing… · data 0h0m old · 10:00:05Z');
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
    const session = startSession({ NO_COLOR: '1' }, undefined, { nope: 1, agy: false });
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
    const session = startSession({ NO_COLOR: '1' }, stopChildren);
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
