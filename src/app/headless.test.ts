import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { realHeadlessSpawner, runHeadless, type HeadlessSpawner } from './index.ts';
import { headlessLaunchOf, parseHeadlessArgs, promptProblem } from './launch.ts';
import type { CommandRunner, ProbeIo } from '../probes/index.ts';

const spawnSpy = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  spawnSpy.mockImplementation(actual.spawn);
  return { ...actual, spawn: spawnSpy };
});

const NOW = '2026-10-29T10:00:00.000Z';
const CLOCK = { now: NOW, zone: 'UTC' };
const ROUTES_FILE = fileURLToPath(new URL('../routes.fixture.json', import.meta.url));
const IDS = ['claude', 'claude-work', 'claude-animus', 'claude-deepseek', 'claude-ollama', 'agy', 'kimi', 'grok', 'codex', 'codex-animus', 'cursor', 'junie', 'hermes', 'kilo'];
const TEMPLATE = { before: [], after: ['-p'], stdin: true };
const PROMPT = { path: '/abs/prompt.md', text: 'do $& the {promptFile} thing', bytes: 28 };

describe('parseHeadlessArgs', () => {
  it('reads a seat launch', () => {
    expect(parseHeadlessArgs(['--headless', '--seat', 'model-a high claude', '--prompt-file', 'p.md', '--cwd', 'repo', '--timeout', '300'])).toEqual({
      args: { seat: 'model-a high claude', promptFile: 'p.md', cwd: 'repo', timeoutMs: 300000, high: false, maxAge: undefined }
    });
  });

  it('reads a routed launch with --high and --max-age, in any order', () => {
    expect(parseHeadlessArgs(['--cwd', 'repo', '--max-age', '600', '--high', '--prompt-file', 'p.md', '--headless'])).toEqual({
      args: { seat: undefined, promptFile: 'p.md', cwd: 'repo', timeoutMs: undefined, high: true, maxAge: 600 }
    });
    expect(parseHeadlessArgs(['--headless', '--prompt-file', 'p', '--cwd', 'd', '--max-age', '0']).args?.maxAge).toBeUndefined();
  });

  it.each<[string[], string]>([
    [['--headless', '--cwd', 'd'], '--prompt-file is required'],
    [['--headless', '--prompt-file', 'p'], '--cwd is required'],
    [['--headless', '--prompt-file', 'p', '--cwd'], '--cwd needs a value'],
    [['--headless', '--prompt-file', 'p', '--cwd', 'd', '--bogus'], 'unknown option --bogus'],
    [['--headless', '--prompt-file', 'p', '--cwd', 'd', '--', 'x'], 'unknown option --'],
    [['--headless', '--prompt-file', 'p', '--cwd', 'd', 'extra'], 'unexpected argument extra'],
    [['--headless', '--prompt-file', 'p', '--cwd', 'd', '--timeout', '0'], '--timeout must be a positive whole number of seconds, not 0'],
    [['--headless', '--prompt-file', 'p', '--cwd', 'd', '--timeout', '1.5'], '--timeout must be a positive whole number of seconds, not 1.5'],
    [['--headless', '--prompt-file', 'p', '--cwd', 'd', '--seat', 'model-a  high claude'], '--seat "model-a  high claude" is not "<model> [effort] <account>"'],
    [['--headless', '--prompt-file', 'p', '--cwd', 'd', '--seat', 'claude'], '--seat "claude" is not "<model> [effort] <account>"'],
    [['--headless', '--prompt-file', 'p', '--cwd', 'd', '--seat', 'a b c claude'], '--seat "a b c claude" is not "<model> [effort] <account>"'],
    [['--headless', '--prompt-file', 'p', '--cwd', 'd', '--seat', 'model-a high claudee'], 'unknown account claudee']
  ])('rejects %j: %s', (args, problem) => {
    expect(parseHeadlessArgs(args)).toEqual({ problem });
  });
});

describe('headlessLaunchOf and promptProblem', () => {
  const base = { command: 'codex', args: ['--model', 'model-i', '-c', 'model_reasoning_effort=high'], env: { CODEX_HOME: '/h/.codex-animus' } };

  it('builds command, before, model and effort flags, then after with the prompt and its path filled in literally', () => {
    const template = { before: ['exec'], after: ['--yes', '{promptFile}', '{prompt}', 'x={prompt};{promptFile}'], stdin: false };
    expect(headlessLaunchOf(base, template, PROMPT, { cwd: '/repo', timeoutMs: 5000 })).toEqual({
      command: 'codex',
      args: ['exec', '--model', 'model-i', '-c', 'model_reasoning_effort=high', '--yes', '/abs/prompt.md', 'do $& the {promptFile} thing', 'x=do $& the {promptFile} thing;/abs/prompt.md'],
      env: { CODEX_HOME: '/h/.codex-animus', PWD: '/repo' },
      cwd: '/repo',
      stdin: undefined,
      timeoutMs: 5000
    });
  });

  it('pipes the prompt file to stdin only for a stdin template', () => {
    expect(headlessLaunchOf(base, TEMPLATE, PROMPT, { cwd: '/repo' })).toMatchObject({ stdin: '/abs/prompt.md', timeoutMs: undefined });
  });

  it('refuses a {prompt} template only above 120000 bytes', () => {
    const inline = { before: [], after: ['{prompt}'], stdin: false };
    expect(promptProblem('kimi', inline, { ...PROMPT, bytes: 120000 })).toBeUndefined();
    expect(promptProblem('kimi', inline, { ...PROMPT, bytes: 120001 })).toBe('prompt too long for kimi; use a stdin or {promptFile} template');
    expect(promptProblem('kimi', { ...inline, after: ['{promptFile}'] }, { ...PROMPT, bytes: 999999 })).toBeUndefined();
    expect(promptProblem('kimi', TEMPLATE, { ...PROMPT, bytes: 999999 })).toBeUndefined();
  });
});

function ioWith(run: CommandRunner['run']): ProbeIo {
  return {
    runner: { run },
    launcher: { launch: async () => undefined },
    fetcher: { get: async () => ({ failure: 'network' }), post: async () => ({ failure: 'network' }) },
    reader: { homeDir: () => '/home/tester', read: async () => undefined, isDirectory: async () => false },
    spawner: { spawn: () => { throw new Error('never spawned'); } }
  };
}

const missing = vi.fn<CommandRunner['run']>(async () => ({ stdout: '', stderr: '', failure: 'missing' }));

function kiloAt(balance: number): CommandRunner['run'] {
  return async (command) => (command === 'kilo' ? { stdout: JSON.stringify({ balance }), stderr: '' } : { stdout: '', stderr: '', failure: 'missing' });
}

function fakeSpawner(result: number | 'missing' | 'timeout' = 0) {
  const spawn = vi.fn<HeadlessSpawner['spawn']>(async () => result);
  return { spawn, spawner: { spawn } };
}

describe('runHeadless', () => {
  let scratch = '';
  let env: Record<string, string> = {};
  let prompt = '';

  beforeEach(() => {
    missing.mockClear();
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'dandelion-headless-')));
    const headless = { claude: TEMPLATE, codex: { before: ['exec'], after: ['-'], stdin: true }, kimi: { before: [], after: ['-p', '{prompt}'], stdin: false }, kilo: { before: ['run'], after: ['{prompt}'], stdin: false } };
    writeFileSync(join(scratch, 'routes.json'), JSON.stringify({ ...JSON.parse(readFileSync(ROUTES_FILE, 'utf8')), headless }));
    const windows = [{ label: 'session', kind: 'rolling', usedPct: 10, resetsAt: '2026-10-29T13:00:00.000Z' }, { label: 'weekly', kind: 'weekly', usedPct: 10, resetsAt: '2026-11-01T10:00:00.000Z' }];
    const entries = IDS.map((id) => (id === 'codex' ? { id, displayName: id, status: 'ok', windows, fetchedAt: NOW } : { id, displayName: id, status: 'unavailable', reason: 'gone', windows: [], fetchedAt: NOW }));
    writeFileSync(join(scratch, 'snapshot.json'), JSON.stringify(entries));
    prompt = join(scratch, 'prompt.md');
    writeFileSync(prompt, 'Create ok.txt');
    env = { DANDELION_ROUTES_FILE: join(scratch, 'routes.json'), DANDELION_STATE_FILE: join(scratch, 'eligibility.json'), DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR: '/cfg/deepseek' };
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  const seatArgs = (seat: string, ...rest: string[]) => ['--headless', '--seat', seat, '--prompt-file', prompt, '--cwd', scratch, ...rest];

  it('launches the seat as given, without probing, and exits with the child code', async () => {
    const { spawn, spawner } = fakeSpawner(3);
    expect(await runHeadless(ioWith(missing), env, seatArgs('model-x high claude-deepseek', '--timeout', '60'), CLOCK, spawner)).toEqual({ err: '', code: 3 });
    expect(spawn).toHaveBeenCalledExactlyOnceWith({ command: 'claude', args: ['--model', 'model-x', '--effort', 'high', '-p'], env: { CLAUDE_CONFIG_DIR: '/cfg/deepseek', PWD: scratch }, cwd: scratch, stdin: prompt, timeoutMs: 60000 });
    expect(missing).not.toHaveBeenCalled();
  });

  it('resolves the route as plain run does without --seat, --high and --max-age included', async () => {
    const plain = fakeSpawner();
    expect(await runHeadless(ioWith(missing), env, ['--headless', '--prompt-file', prompt, '--cwd', scratch, '--max-age', '600'], CLOCK, plain.spawner)).toEqual({ err: '', code: 0 });
    expect(plain.spawn.mock.calls[0][0]).toMatchObject({ command: 'codex', args: ['exec', '--model', 'model-i', '-c', 'model_reasoning_effort=high', '-'] });
    const high = fakeSpawner();
    await runHeadless(ioWith(missing), env, ['--headless', '--high', '--prompt-file', prompt, '--cwd', scratch, '--max-age', '600'], CLOCK, high.spawner);
    expect(high.spawn.mock.calls[0][0].args).toEqual(['exec', '--model', 'model-i', '-c', 'model_reasoning_effort=xhigh', '-']);
    expect(missing).not.toHaveBeenCalled();
  });

  it('prints none and exits 1 when nothing routes', async () => {
    const { spawn, spawner } = fakeSpawner();
    expect(await runHeadless(ioWith(missing), env, ['--headless', '--prompt-file', prompt, '--cwd', scratch], CLOCK, spawner)).toEqual({ err: 'none\n', code: 1 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('exits 124 on a timeout and 127 when the CLI is not on PATH', async () => {
    expect(await runHeadless(ioWith(missing), env, seatArgs('model-a high claude', '--timeout', '1'), CLOCK, fakeSpawner('timeout').spawner)).toEqual({ err: '', code: 124 });
    expect(await runHeadless(ioWith(missing), env, seatArgs('model-a high claude'), CLOCK, fakeSpawner('missing').spawner)).toEqual({ err: 'dandelion: claude: command not found\n', code: 127 });
  });

  it('checks a kilo seat with a fresh profile and refuses it at or below $10', async () => {
    const low = fakeSpawner();
    expect(await runHeadless(ioWith(kiloAt(10)), env, seatArgs('vendor/model-k max kilo'), CLOCK, low.spawner)).toEqual({ err: 'dandelion: kilo balance at or below $10\n', code: 1 });
    expect(low.spawn).not.toHaveBeenCalled();
    const ok = fakeSpawner();
    expect(await runHeadless(ioWith(kiloAt(14.15)), env, seatArgs('vendor/model-k max kilo'), CLOCK, ok.spawner)).toEqual({ err: '', code: 0 });
    expect(ok.spawn.mock.calls[0][0]).toMatchObject({ command: 'kilo', args: ['run', '--model', 'vendor/model-k', '--variant', 'max', 'Create ok.txt'], stdin: undefined });
  });

  it.each<[string, () => string[], () => string]>([
    ['a missing --prompt-file', () => ['--headless', '--seat', 'model-a high claude', '--cwd', scratch], () => 'dandelion: run: --prompt-file is required\n'],
    ['an unreadable prompt file', () => ['--headless', '--seat', 'model-a high claude', '--prompt-file', join(scratch, 'nope.md'), '--cwd', scratch], () => `dandelion: run: prompt file ${join(scratch, 'nope.md')} cannot be read\n`],
    ['a prompt file that is a folder', () => ['--headless', '--seat', 'model-a high claude', '--prompt-file', scratch, '--cwd', scratch], () => `dandelion: run: prompt file ${scratch} cannot be read\n`],
    ['a missing cwd', () => ['--headless', '--seat', 'model-a high claude', '--prompt-file', prompt, '--cwd', join(scratch, 'nope')], () => `dandelion: run: --cwd ${join(scratch, 'nope')} is not a directory\n`],
    ['a cwd that is a file', () => ['--headless', '--seat', 'model-a high claude', '--prompt-file', prompt, '--cwd', prompt], () => `dandelion: run: --cwd ${prompt} is not a directory\n`],
    ['an unknown account', () => seatArgs('model-a high claudee'), () => 'dandelion: run: unknown account claudee\n'],
    ['a bad line', () => seatArgs('model-a  high claude'), () => 'dandelion: run: --seat "model-a  high claude" is not "<model> [effort] <account>"\n'],
    ['no template', () => seatArgs('model-c high agy'), () => 'dandelion: run: no headless template for agy\n']
  ])('exits 2 without launching for %s', async (_case, args, err) => {
    const { spawn, spawner } = fakeSpawner();
    expect(await runHeadless(ioWith(missing), env, args(), CLOCK, spawner)).toEqual({ err: err(), code: 2 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('exits 2 for a {prompt} template with a prompt over 120000 bytes', async () => {
    writeFileSync(prompt, 'a'.repeat(120001));
    const { spawn, spawner } = fakeSpawner();
    expect(await runHeadless(ioWith(missing), env, seatArgs('model-d kimi'), CLOCK, spawner)).toEqual({ err: 'dandelion: run: prompt too long for kimi; use a stdin or {promptFile} template\n', code: 2 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('exits 2 with the routes file fault for a bad routes.json', async () => {
    const path = join(scratch, 'nope.json');
    expect(await runHeadless(ioWith(missing), { ...env, DANDELION_ROUTES_FILE: path }, seatArgs('model-a high claude'), CLOCK, fakeSpawner().spawner)).toEqual({ err: `dandelion: routes file ${path}: cannot be read\n`, code: 2 });
  });
});

describe('realHeadlessSpawner', () => {
  let scratch = '';

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'dandelion-headless-spawn-')));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  const node = (script: string, extra: { stdin?: string; timeoutMs?: number; env?: Record<string, string> } = {}) =>
    realHeadlessSpawner.spawn({ command: process.execPath, args: ['-e', script], env: extra.env ?? {}, cwd: scratch, stdin: extra.stdin, timeoutMs: extra.timeoutMs });

  it('runs in cwd with the env merged over the process env and resolves the exit code', async () => {
    expect(await node(`process.exit(process.env.PWD === ${JSON.stringify(scratch)} ? 4 : 3)`, { env: { PWD: scratch } })).toBe(4);
    expect(await node(`process.exit(process.cwd() === ${JSON.stringify(scratch)} && process.env.flag === "yes" && process.env.PATH !== undefined ? 5 : 6)`, { env: { flag: 'yes' } })).toBe(5);
    expect(await node('process.kill(process.pid, "SIGTERM")')).toBe(143);
  });

  it('pipes the prompt file to stdin, or gives an empty stdin', async () => {
    const file = join(scratch, 'prompt.md');
    writeFileSync(file, 'hi there');
    const reader = 'let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => process.exit(d === "hi there" ? 9 : d === "" ? 10 : 11))';
    expect(await node(reader, { stdin: file })).toBe(9);
    expect(await node(reader)).toBe(10);
  });

  it('resolves missing when the command does not exist', async () => {
    expect(await realHeadlessSpawner.spawn({ command: 'dandelion-no-such-cli', args: [], env: {}, cwd: scratch })).toBe('missing');
  });

  it('resolves timeout once a child that outlives --timeout has been stopped', async () => {
    expect(await node('setInterval(() => undefined, 1000)', { timeoutMs: 200 })).toBe('timeout');
  });

  describe('with a fake child', () => {
    const fakeChild = () => Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: vi.fn() });
    const counts = () => ['SIGINT', 'SIGTERM', 'SIGHUP'].map((name) => process.listenerCount(name));

    it.each<[NodeJS.Signals, number]>([['SIGTERM', 143], ['SIGHUP', 129], ['SIGINT', 130]])('forwards %s to the child and resolves only after it exits with %i', async (signal, status) => {
      const child = fakeChild();
      spawnSpy.mockImplementationOnce(() => child);
      const before = counts();
      const running = realHeadlessSpawner.spawn({ command: 'claude', args: [], env: {}, cwd: scratch });
      const settled = vi.fn();
      void running.then(settled);
      process.emit(signal);
      await Promise.resolve();
      expect(child.kill).toHaveBeenCalledExactlyOnceWith(signal);
      expect(settled).not.toHaveBeenCalled();
      child.emit('close', null, signal);
      expect(await running).toBe(status);
      expect(counts()).toEqual(before);
    });

    it('sends SIGTERM at the timeout, SIGKILL 5s later, and resolves timeout after the child exits', async () => {
      vi.useFakeTimers();
      try {
        const child = fakeChild();
        spawnSpy.mockImplementationOnce(() => child);
        const before = counts();
        const running = realHeadlessSpawner.spawn({ command: 'claude', args: [], env: {}, cwd: scratch, timeoutMs: 1000 });
        await vi.advanceTimersByTimeAsync(999);
        expect(child.kill).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(child.kill).toHaveBeenLastCalledWith('SIGTERM');
        await vi.advanceTimersByTimeAsync(5000);
        expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
        child.emit('exit', null, 'SIGKILL');
        child.emit('close', null, 'SIGKILL');
        expect(await running).toBe('timeout');
        expect(counts()).toEqual(before);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears the timeout when the child exits first', async () => {
      vi.useFakeTimers();
      try {
        const child = fakeChild();
        spawnSpy.mockImplementationOnce(() => child);
        const running = realHeadlessSpawner.spawn({ command: 'claude', args: [], env: {}, cwd: scratch, timeoutMs: 1000 });
        child.emit('close', 0, null);
        expect(await running).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(child.kill).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
