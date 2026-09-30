import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProbe } from '../probes/index.ts';
import { openEligibility, openHidden, openHistory, type Routes } from '../render/index.ts';
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
  hiddenText?: string;
  hiddenSaves?: boolean[];
  historyText?: string;
  historyWrites?: boolean;
  notifier?: { notify(text: string): unknown };
  copy?: (text: string) => Promise<boolean>;
  routes?: Routes;
};

function startSession(overrides: SessionOverrides = {}) {
  const { env, stopChildren, state, zone, rows, hiddenText, hiddenSaves, historyText, historyWrites, notifier, copy, routes } = { notifier: { notify: vi.fn() }, routes: { lines: LINES }, copy: async () => true, historyText: '[]', historyWrites: true, env: { NO_COLOR: '1' }, stopChildren: vi.fn(async () => undefined), state: {}, zone: 'UTC', rows: 60, ...overrides };
  const clipboard = { copy: vi.fn(copy) };
  const writes: string[] = [];
  const probes = IDS.map((id) => deferredProbe(id, writes));
  const keyboard = Object.assign(new EventEmitter(), { setRawMode: vi.fn(), setEncoding: vi.fn(), pause: vi.fn() });
  const screen = Object.assign(new EventEmitter(), { rows, write: (text: string) => writes.push(text) });
  const replace = vi.fn<(path: string, text: string) => boolean>(() => true);
  const eligibility = openEligibility({}, '/home/u', { read: () => JSON.stringify(state), replace });
  const historyReplace = vi.fn<(path: string, text: string) => boolean>(() => historyWrites);
  const history = openHistory({}, '/home/u', { read: () => historyText, replace: historyReplace });
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
  const finished = startLive({ probes: probes.map(({ probe }) => probe), env, keyboard, screen, stopChildren, eligibility, hidden, history, routes, zone, notifier, clipboard });
  const frames = () => writes.filter((text) => text.startsWith(CLEAR)).map((text) => text.slice(CLEAR.length));
  const settleRound = async (round: number, overrides: Record<string, Usage> = {}) => {
    probes.forEach(({ probe, calls }) => calls[round].resolve(overrides[probe.id] ?? usageOf(probe.id, calls[round].now)));
    await vi.advanceTimersByTimeAsync(0);
  };
  return { notifier, clipboard, writes, probes, keyboard, screen, finished, frames, stopChildren, replace, saved, hiddenReplace, hiddenSaved, historyReplace, settleRound, lastFrame: () => frames().at(-1) ?? '', press: (key: string) => keyboard.emit('data', key) };
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
    expect(session.lastFrame().split('\n')).toEqual([...claude.slice(0, 9), 'h hide · H show hidden · R refresh panel', 'g usage graph of the selected panel · esc/q/g back', '↑↓/jk select · space route · r refresh · t times · c/C copy · q quit · ?']);
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

  it('starts a full round while a single panel probe runs and drops the stale single result', async () => {
    const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '10' } });
    await session.settleRound(0);
    session.press('j');
    session.press('R');
    session.press('r');
    expect(session.probes.map(({ calls }) => calls.length)).toEqual([3, ...IDS.slice(1).map(() => 2)]);
    session.probes.slice(1).forEach(({ probe, calls }) => calls[1].resolve(usageOf(probe.id, calls[1].now)));
    session.probes[0].calls[2].resolve({ ...usageOf('claude', START), windows: [{ label: 'weekly', kind: 'weekly', usedPct: 33 }] });
    await vi.advanceTimersByTimeAsync(0);
    session.probes[0].calls[1].resolve({ ...usageOf('claude', START), windows: [{ label: 'weekly', kind: 'weekly', usedPct: 99 }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.lastFrame()).toContain('33%');
    expect(session.lastFrame()).not.toContain('99%');
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
      const session = startSession({ copy: async () => false });
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
      let finish: (copied: boolean) => void = () => undefined;
      const session = startSession({ copy: () => new Promise((resolve) => (finish = resolve)) });
      await session.settleRound(0);
      session.press('c');
      session.press('q');
      await session.finished;
      finish(true);
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
  const notify = vi.fn();
  const session = startSession({ env: { NO_COLOR: '1', DANDELION_REFRESH_SECONDS: '1', ...env }, notifier: { notify } });
  for (const [round, window] of windows.entries()) {
    await session.settleRound(round, { claude: windowUsage('claude', window) });
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

  it('notifies once at 80% and once more at 95%', async () => {
    expect(await roundsOf({ DANDELION_NOTIFY: '1' }, [weekly(79), weekly(80), weekly(94), weekly(95)])).toEqual(['claude weekly at 80%', 'claude weekly at 95%']);
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
});
