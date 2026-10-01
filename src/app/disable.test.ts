import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { disableWarning, runApp, runJson, runLine, runLive, runRoute, runRun } from './index.ts';
import type { ProbeIo } from '../probes/index.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const ROUTES_FILE = fileURLToPath(new URL('../routes.fixture.json', import.meta.url));
const LIVE_CLEAR = '\x1b[H\x1b[2J\x1b[0m';
const OFF = { DANDELION_DISABLE: 'hermes,junie' };
const IDS = ['claude', 'claude-work', 'claude-deepseek', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];

type Touched = { reads: string[]; urls: string[]; commands: string[] };

function recordingIo(): { io: ProbeIo; touched: Touched } {
  const touched: Touched = { reads: [], urls: [], commands: [] };
  const io: ProbeIo = {
    runner: { run: async (command, args) => { touched.commands.push([command, ...args].join(' ')); return { stdout: '', stderr: '', failure: 'missing' }; } },
    launcher: { launch: async (command, args) => { touched.commands.push([command, ...args].join(' ')); return undefined; } },
    fetcher: {
      get: async (url) => { touched.urls.push(url); return { failure: 'network' }; },
      post: async (url) => { touched.urls.push(url); return { failure: 'network' }; }
    },
    reader: {
      homeDir: () => '/home/t',
      read: async (path) => { touched.reads.push(path); return undefined; },
      isDirectory: async (path) => { touched.reads.push(path); return false; }
    },
    spawner: { spawn: (command, args) => { touched.commands.push([command, ...args].join(' ')); throw new Error('never started'); } }
  };
  return { io, touched };
}

function mentions(touched: Touched, needle: string): boolean {
  return [...touched.reads, ...touched.urls, ...touched.commands].some((text) => text.includes(needle));
}

function expectUntouched(touched: Touched): void {
  expect(mentions(touched, 'hermes') || mentions(touched, 'nousresearch')).toBe(false);
  expect(mentions(touched, 'junie')).toBe(false);
}

describe('DANDELION_DISABLE', () => {
  let scratch = '';
  let env: Record<string, string>;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'dandelion-disable-'));
    env = { NO_COLOR: '1', DANDELION_ROUTES_FILE: ROUTES_FILE, DANDELION_STATE_FILE: join(scratch, 'state', 'eligibility.json'), DANDELION_HISTORY_FILE: join(scratch, 'history.json') };
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('probes hermes and junie when nothing is disabled', async () => {
    const { io, touched } = recordingIo();
    await runApp(io, env, NOW);
    expect(mentions(touched, 'hermes')).toBe(true);
    expect(mentions(touched, 'junie')).toBe(true);
  });

  it.each(['', '  ', ' , ,'])('behaves as today when set to %j', async (value) => {
    const plain = await runJson(recordingIo().io, env, { now: NOW, zone: 'UTC' });
    expect(await runJson(recordingIo().io, { ...env, DANDELION_DISABLE: value }, { now: NOW, zone: 'UTC' })).toEqual(plain);
    expect(disableWarning(recordingIo().io, { DANDELION_DISABLE: value })).toBe('');
  });

  it.each(['headroom', 'high'] as const)('never touches them for route in %s mode and prints the same line', async (mode) => {
    const { io, touched } = recordingIo();
    expect(await runRoute(io, { ...env, ...OFF }, { mode, now: NOW, zone: 'UTC' })).toEqual(await runRoute(recordingIo().io, env, { mode, now: NOW, zone: 'UTC' }));
    expectUntouched(touched);
  });

  it('never touches them for run', async () => {
    const { io, touched } = recordingIo();
    const spawner = { spawn: vi.fn(async () => 0) };
    await runRun(io, { ...env, ...OFF }, { mode: 'headroom', now: NOW, zone: 'UTC' }, [], spawner);
    expectUntouched(touched);
  });

  it('shows no panel for them in --once', async () => {
    const { io, touched } = recordingIo();
    const out = await runApp(io, { ...env, ...OFF }, NOW);
    expect(out).not.toContain('hermes');
    expect(out).not.toContain('junie');
    expect(out).toContain('kilo');
    expectUntouched(touched);
  });

  it('omits them from --json providers and --line segments', async () => {
    const { io, touched } = recordingIo();
    const json = JSON.parse((await runJson(io, { ...env, ...OFF }, { now: NOW, zone: 'UTC' })).out);
    expect(json.providers.map((entry: { id: string }) => entry.id)).toEqual(IDS.filter((id) => id !== 'hermes' && id !== 'junie'));
    const line = await runLine(io, { ...env, ...OFF }, { now: NOW, zone: 'UTC' });
    expect(line.out).not.toContain('hermes');
    expectUntouched(touched);
  });

  describe('the live dashboard', () => {
    it('shows no panel, never probes them and writes no snapshot entries for them', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      vi.setSystemTime(new Date(NOW));
      const { io, touched } = recordingIo();
      const writes: string[] = [];
      const keyboard = Object.assign(new EventEmitter(), { setRawMode: vi.fn(), setEncoding: vi.fn(), pause: vi.fn(), resume: vi.fn() });
      const finished = runLive(io, { ...env, ...OFF }, keyboard, { rows: 80, write: (text: string) => writes.push(text) });
      await vi.advanceTimersByTimeAsync(50);
      const frame = writes.filter((text) => text.startsWith(LIVE_CLEAR)).at(-1) ?? '';
      expect(frame).toContain('kilo');
      expect(frame).not.toContain('hermes');
      expect(frame).not.toContain('junie');
      keyboard.emit('data', 'q');
      await finished;
      const saved = JSON.parse(readFileSync(join(scratch, 'state', 'snapshot.json'), 'utf8'));
      expect(saved.map((entry: { id: string }) => entry.id)).toEqual(IDS.filter((id) => id !== 'hermes' && id !== 'junie'));
      expectUntouched(touched);
    });
  });

  describe('--max-age', () => {
    const idle = (id: string) => ({ id, displayName: id, status: 'ok', windows: [{ label: 'weekly', kind: 'weekly', usedPct: 0 }], fetchedAt: NOW });

    it('answers from a snapshot with an entry for every enabled provider only, without probing', async () => {
      mkdirSync(join(scratch, 'state'), { recursive: true });
      writeFileSync(join(scratch, 'state', 'snapshot.json'), JSON.stringify(IDS.filter((id) => id !== 'hermes' && id !== 'junie').map(idle)));
      const { io, touched } = recordingIo();
      const request = { now: NOW, zone: 'UTC', maxAge: 60 };
      const routed = await runRoute(io, { ...env, ...OFF }, { mode: 'headroom', ...request });
      expect(routed.code).toBe(0);
      expect((await runJson(io, { ...env, ...OFF }, request)).out).toContain('"generatedAt"');
      expect((await runLine(io, { ...env, ...OFF }, request)).out).toContain('claude 0%');
      expect(touched).toEqual({ reads: [], urls: [], commands: [] });
    });

    it('leaves entries of disabled providers out of the answer', async () => {
      mkdirSync(join(scratch, 'state'), { recursive: true });
      writeFileSync(join(scratch, 'state', 'snapshot.json'), JSON.stringify(IDS.map(idle)));
      const { io, touched } = recordingIo();
      const request = { now: NOW, zone: 'UTC', maxAge: 60 };
      const json = JSON.parse((await runJson(io, { ...env, ...OFF }, request)).out);
      expect(json.providers.map((entry: { id: string }) => entry.id)).toEqual(IDS.filter((id) => id !== 'hermes' && id !== 'junie'));
      const line = (await runLine(io, { ...env, ...OFF }, request)).out;
      expect(line).toContain('claude 0%');
      expect(line).not.toContain('hermes');
      expect(touched).toEqual({ reads: [], urls: [], commands: [] });
    });

    it('still probes when an enabled provider has no entry', async () => {
      mkdirSync(join(scratch, 'state'), { recursive: true });
      writeFileSync(join(scratch, 'state', 'snapshot.json'), JSON.stringify(IDS.filter((id) => id !== 'hermes' && id !== 'kilo').map(idle)));
      const { io, touched } = recordingIo();
      await runRoute(io, { ...env, ...OFF }, { mode: 'headroom', now: NOW, zone: 'UTC', maxAge: 60 });
      expect(touched.commands.length).toBeGreaterThan(0);
    });
  });

  describe('disableWarning', () => {
    it('names each unknown id once and ignores the known ones and the whitespace', () => {
      const { io } = recordingIo();
      expect(disableWarning(io, { DANDELION_DISABLE: ' kimi , nosuch' })).toBe('dandelion: DANDELION_DISABLE: unknown provider nosuch\n');
      expect(disableWarning(io, { DANDELION_DISABLE: 'a,b,a' })).toBe('dandelion: DANDELION_DISABLE: unknown provider a\ndandelion: DANDELION_DISABLE: unknown provider b\n');
      expect(disableWarning(io, {})).toBe('');
    });

    it('disables the known ids and leaves route unaffected by the unknown one', async () => {
      const { io, touched } = recordingIo();
      const out = await runRoute(io, { ...env, DANDELION_DISABLE: ' kimi , nosuch' }, { mode: 'headroom', now: NOW, zone: 'UTC' });
      expect(out).toEqual(await runRoute(recordingIo().io, { ...env, DANDELION_DISABLE: 'kimi' }, { mode: 'headroom', now: NOW, zone: 'UTC' }));
      expect(out.err).toBe('');
      expect(touched.commands.some((text) => text.includes('kimi'))).toBe(false);
    });
  });
});
