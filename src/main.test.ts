import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProbeIo } from './app/index.ts';

const MAIN_URL = new URL('./main.ts', import.meta.url).href;
const MAIN = fileURLToPath(MAIN_URL);
const ROUTES_FILE = fileURLToPath(new URL('./routes.fixture.json', import.meta.url));
const LINES = JSON.parse(readFileSync(ROUTES_FILE, 'utf8'));

vi.mock('./app/index.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./app/index.ts')>();
  const stubIo: ProbeIo = {
    runner: { run: async () => ({ stdout: 'Balance: $14.15', stderr: '' }) },
    launcher: { launch: async () => undefined },
    fetcher: { get: async () => ({ failure: 'network' }), post: async () => ({ failure: 'network' }) },
    reader: { homeDir: () => '/nowhere', read: async () => undefined, isDirectory: async () => false },
    spawner: { spawn: () => { throw new Error('codex app-server is never started'); } }
  };
  return { ...original, realIo: stubIo, runRoute: vi.fn(original.runRoute), runJson: vi.fn(original.runJson), runLine: vi.fn(original.runLine), runRun: vi.fn(original.runRun) };
});

const { main, runIfMain } = await import('./main.ts');
const { runJson, runLine, runRoute, runRun, realRunSpawner } = await import('./app/index.ts');
const { highRouteLine, routeLine } = await import('./domain/index.ts');

const routeIo: ProbeIo = {
  runner: { run: async (command) => ({ stdout: command === 'claude' ? 'Current week (all models): 86% used' : '', stderr: '' }) },
  launcher: { launch: async () => undefined },
  fetcher: { get: async () => ({ failure: 'network' }), post: async () => ({ failure: 'network' }) },
  reader: { homeDir: () => '/nowhere', read: async () => undefined, isDirectory: async () => false },
  spawner: { spawn: () => { throw new Error('codex app-server is never started'); } }
};

const profileIo: ProbeIo = {
  runner: { run: async () => ({ stdout: 'Name: Max\nBalance: $14.15', stderr: '' }) },
  launcher: { launch: async () => undefined },
  fetcher: { get: async () => ({ failure: 'network' }), post: async () => ({ failure: 'network' }) },
  reader: { homeDir: () => '/nowhere', read: async () => undefined, isDirectory: async () => false },
  spawner: { spawn: () => { throw new Error('codex app-server is never started'); } }
};

const ENTER_ALTERNATE = '\x1b[?1049h\x1b[?25l';

function procOf(argv: string[], stdinTTY: boolean | undefined, stdoutTTY: boolean | undefined, env: Record<string, string> = { DANDELION_ROUTES_FILE: ROUTES_FILE }) {
  const writes: string[] = [];
  const errors: string[] = [];
  const keyboard = Object.assign(new EventEmitter(), { setRawMode: vi.fn(), setEncoding: vi.fn(), pause: vi.fn(), resume: vi.fn(), isTTY: stdinTTY });
  const stdout = { isTTY: stdoutTTY, rows: 60, write: (text: string) => writes.push(text) };
  const stderr = { write: (text: string) => errors.push(text) };
  const proc = { argv, env: { NO_COLOR: '1', ...env }, stdin: keyboard, stdout, stderr, exit: vi.fn() };
  return { proc, keyboard, output: () => writes.join(''), errors: () => errors.join('') };
}

function writeFixture(dir: string, name: string, body: string): void {
  const script = join(dir, name);
  writeFileSync(script, `#!/bin/sh\n${body}\n`);
  chmodSync(script, 0o755);
}

function linkNodeAndShell(dir: string): void {
  symlinkSync(process.execPath, join(dir, 'node'));
  symlinkSync('/bin/sh', join(dir, 'sh'));
}

function isolatedEnv(dir: string, extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { HOME: dir, PATH: dir, DANDELION_KIMI_PORT: '1', DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'missing.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: join(dir, 'missing'), DANDELION_HERMES_AUTH_FILE: join(dir, 'missing-hermes.json'), DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json'), ...extra };
}

function withoutCountdowns(dashboard: string): string {
  return dashboard.split('\n').slice(1).map((line) => line.replace(/ ↻ \S+$/, '')).join('\n');
}

function runWithFixtureKilo(extraEnv: NodeJS.ProcessEnv) {
  const dir = mkdtempSync(join(tmpdir(), 'dandelion-kilo-'));
  try {
    const script = join(dir, 'kilo');
    writeFileSync(script, '#!/bin/sh\n[ "$1" = "profile" ] || exit 2\nprintf "Name: Max\\nEmail: yeti213@googlemail.com\\nTeam: Personal\\nBalance: \\$14.15\\n"\n');
    chmodSync(script, 0o755);
    writeFixture(dir, 'claude', "printf '%s\\n' 'Current week (all models): 86% used'");
    writeFixture(dir, 'agy', "printf 'Claude and GPT models\\tFive Hour Limit Remaining\\t25%%\\tsoon\\n'");
    writeFixture(dir, 'kimi', 'exit 0');
    writeFixture(dir, 'codex', "echo 'Not logged in' >&2; exit 1");
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    delete env.NO_COLOR;
    delete env.DANDELION_KILO_REFERENCE;
    delete env.DANDELION_KIMI_PORT;
    delete env.DANDELION_CURSOR_API_BASE;
    delete env.CLAUDE_CONFIG_DIR;
    Object.assign(env, { DANDELION_KIMI_HOME: dir, DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'no-cursor-auth.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: dir, DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR: join(dir, 'no-deepseek'), DANDELION_HERMES_AUTH_FILE: join(dir, 'missing-hermes.json'), DANDELION_ROUTES_FILE: ROUTES_FILE, DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json') }, extraEnv);
    return spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf-8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('main', () => {
  it('trips a rolling window at exactly 90 percent', () => {
    const now = '2026-09-14T11:00:00.000Z';
    const midnight = '2026-09-15T00:00:00.000Z';
    const tripped = {
      id: 'claude',
      displayName: 'claude',
      fetchedAt: now,
      status: 'ok' as const,
      windows: [{ label: 'session', kind: 'rolling' as const, usedPct: 90 }]
    };
    const free = {
      id: 'grok',
      displayName: 'grok',
      fetchedAt: now,
      status: 'ok' as const,
      windows: [{ label: 'credits', kind: 'weekly' as const, usedPct: 95, resetsAt: '2026-09-20T00:00:00.000Z' }]
    };
    expect(routeLine(LINES, [tripped, free], now, midnight, [])).toBe('model-e xhigh grok');
    expect(highRouteLine(LINES, [
      { ...tripped, windows: [{ label: 'session', kind: 'rolling' as const, usedPct: 90 }, { label: 'Fable', kind: 'weekly' as const, usedPct: 10 }] },
      { id: 'cursor', displayName: 'cursor', fetchedAt: now, status: 'ok' as const, windows: [{ label: 'total', kind: 'weekly' as const, usedPct: 10 }] }
    ], [])).toBe('model-f cursor');
  });

  it('kills route edge mutants before the long suite', () => {
    const now = '2026-09-14T11:00:00.000Z';
    const midnight = '2026-09-15T00:00:00.000Z';
    const ok = (id: string, windows: { label: string; kind: 'rolling' | 'weekly' | 'other'; usedPct: number; resetsAt?: string }[]) => ({
      id, displayName: id, fetchedAt: now, status: 'ok' as const, windows
    });
    expect(routeLine(LINES, [ok('claude', [])], now, midnight, [])).toBe('none');
    expect(routeLine(LINES, [
      ok('claude', [{ label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: now }]),
      ok('agy', [{ label: '5h', kind: 'rolling', usedPct: 40 }])
    ], now, midnight, [])).toBe('model-c high agy');
    expect(routeLine(LINES, [
      ok('claude', [{ label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: '2026-09-14T10:00:00.000Z' }]),
      ok('agy', [{ label: '5h', kind: 'rolling', usedPct: 40 }])
    ], now, midnight, [])).toBe('model-c high agy');
    expect(routeLine(LINES, [
      ok('claude', [{ label: 'weekly', kind: 'weekly', usedPct: 3, resetsAt: '2026-09-14T20:00:00.000Z' }]),
      ok('agy', [{ label: '5h', kind: 'rolling', usedPct: 0 }])
    ], now, midnight, [])).toBe('model-c high agy');
    expect(highRouteLine(LINES, [
      ok('claude', [
        { label: 'session', kind: 'rolling', usedPct: 10 },
        { label: 'weekly', kind: 'weekly', usedPct: 50 },
        { label: 'Fable', kind: 'weekly', usedPct: 100 }
      ])
    ], [])).toBe('model-a max claude');
    expect(highRouteLine(LINES, [
      ok('claude', [
        { label: 'session', kind: 'rolling', usedPct: 10 },
        { label: 'FABLE', kind: 'weekly', usedPct: 90 }
      ]),
      ok('cursor', [{ label: 'total', kind: 'weekly', usedPct: 10 }])
    ], [])).toBe('model-f cursor');
  });

  it('prints the kilo panel with a 14 of 20 gauge from a fixture kilo on PATH', () => {
    const result = runWithFixtureKilo({});
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('\x1b[1mDANDELION ')).toBe(true);
    expect(result.stdout).toMatch(/^\S+DANDELION +\d{2}:\d{2}:\d{2}\S+\n/);
    expect(result.stdout).toContain('\x1b[90m' + '━'.repeat(72) + '\x1b[0m\nkilo\n' + 'balance $14.15'.padEnd(35) + ' \x1b[32m' + '█'.repeat(14) + '░'.repeat(6) + '\x1b[0m \x1b[32m 71%\x1b[0m' + ' '.repeat(11) + '\n\x1b[90mapi balance · kilo\x1b[0m');
    expect(result.stdout).not.toContain('not found');
  });

  it('fills the gauge from a fixture kilo when DANDELION_KILO_REFERENCE is 10', () => {
    const result = runWithFixtureKilo({ DANDELION_KILO_REFERENCE: '10', NO_COLOR: '1' });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('\x1b[');
    expect(result.stdout).toContain('='.repeat(72) + '\nkilo\n' + 'balance $14.15'.padEnd(35) + ' ' + '#'.repeat(20) + ' 100%' + ' '.repeat(11) + '\n');
  });

  it('prints claude, claude-work, agy, kimi, grok, codex and kilo panels in order from fixture CLIs on PATH', () => {
    const result = runWithFixtureKilo({ NO_COLOR: '1' });
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines.indexOf('claude')).toBeLessThan(lines.indexOf('claude-work'));
    expect(lines.indexOf('claude-work')).toBeLessThan(lines.indexOf('agy'));
    expect(lines).toContain('claude · work · claude-work');
    expect(lines.indexOf('agy')).toBeLessThan(lines.indexOf('kimi'));
    expect(lines.indexOf('kimi')).toBeLessThan(lines.indexOf('grok'));
    expect(lines.indexOf('grok')).toBeLessThan(lines.indexOf('codex'));
    expect(lines.indexOf('codex')).toBeLessThan(lines.indexOf('kilo'));
    expect(lines).toContain('weekly                              #################---  86%');
    expect(lines).toContain(`${'Claude+GPT · 5h'.padEnd(35)} ###############-----  75%`);
    expect(lines).toContain('claude · personal · claude');
    expect(lines).toContain('agy · agy');
    expect(result.stdout).toContain('\nkimi\nkimi web exited without printing a token\nkimi code · kimi\n');
    expect(result.stdout).toContain('\ncodex\ncodex is not logged in\ncodex · codex\n');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  it('writes the dashboard to stdout and nothing to stderr when the routes file is good', async () => {
    let output = '';
    const stderr = { write: vi.fn() };
    await main(profileIo, { NO_COLOR: '1', DANDELION_ROUTES_FILE: ROUTES_FILE }, { stdout: { write: (out: string) => { output += out; } }, stderr }, '2026-09-13T10:00:00.000Z');
    expect(stderr.write).toHaveBeenCalledWith('');
    expect(output).toContain('DANDELION');
    expect(output).toContain('10:00:00');
    expect(output).toContain('$14.15');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('runIfMain prints the DANDELION_DISABLE warning once on stderr and routes as usual', async () => {
    const { proc, errors } = procOf(['node', MAIN, 'route'], true, true, { DANDELION_ROUTES_FILE: ROUTES_FILE, DANDELION_DISABLE: ' kimi , nosuch' });
    await runIfMain(MAIN_URL, MAIN, profileIo, proc);
    expect(errors()).toBe('dandelion: DANDELION_DISABLE: unknown provider nosuch\n');
  });

  it('runIfMain writes to stdout when invoked as the entry file', async () => {
    const { proc, output } = procOf(['node', MAIN], true, undefined);
    await runIfMain(MAIN_URL, MAIN, profileIo, proc);
    expect(output()).toContain('$14.15');
    expect(output().endsWith('\n')).toBe(true);
    expect(output()).not.toContain(ENTER_ALTERNATE);
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it.each<[string, string[], boolean | undefined, boolean | undefined]>([
    ['--once on two terminals', ['node', 'main.ts', '--once'], true, true],
    ['stdout piped', ['node', 'main.ts'], true, false],
    ['stdin not a terminal', ['node', 'main.ts'], undefined, true]
  ])('runIfMain runs once with %s', async (_case, argv, stdinTTY, stdoutTTY) => {
    const { proc, output, keyboard } = procOf(argv, stdinTTY, stdoutTTY);
    await runIfMain(MAIN_URL, MAIN, profileIo, proc);
    expect(output()).toMatch(/^DANDELION +\d{2}:\d{2}:\d{2}\n/);
    expect(output()).not.toContain('probing…');
    expect(output()).not.toContain(ENTER_ALTERNATE);
    expect(keyboard.setRawMode).not.toHaveBeenCalled();
  });

  it('runIfMain runs once when invoked through a symlink to main.ts, as npm link creates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dandelion-bin-'));
    try {
      symlinkSync(MAIN, join(dir, 'dandelion'));
      const { proc, output } = procOf(['node', join(dir, 'dandelion'), '--once'], true, true);
      await runIfMain(MAIN_URL, join(dir, 'dandelion'), profileIo, proc);
      expect(output()).toMatch(/^DANDELION +\d{2}:\d{2}:\d{2}\n/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each<[string[]]>([[['--once']], [['route']], [['route', '--high']], [['--json']], [['--line']], [['run']]])('runIfMain %j installs no SIGTERM or SIGHUP handler', async (args) => {
    const spawn = vi.spyOn(realRunSpawner, 'spawn').mockResolvedValue(0);
    const on = vi.spyOn(process, 'on');
    const before = [process.listenerCount('SIGTERM'), process.listenerCount('SIGHUP')];
    await runIfMain(MAIN_URL, MAIN, routeIo, procOf(['node', MAIN, ...args], true, true).proc);
    expect(on.mock.calls.filter(([name]) => name === 'SIGTERM' || name === 'SIGHUP')).toEqual([]);
    expect([process.listenerCount('SIGTERM'), process.listenerCount('SIGHUP')]).toEqual(before);
    on.mockRestore();
    spawn.mockRestore();
  });

  it.each<[NodeJS.Signals, number]>([['SIGTERM', 143], ['SIGHUP', 129]])('runIfMain live dashboard exits %s with %i', async (signal, code) => {
    const { proc, output, keyboard } = procOf(['node', MAIN], true, true);
    const running = runIfMain(MAIN_URL, MAIN, profileIo, proc);
    await vi.waitFor(() => expect(output()).toContain('$14.15'));
    process.emit(signal);
    await running;
    expect(output().endsWith('\x1b[?25h\x1b[?1049l')).toBe(true);
    expect(keyboard.setRawMode).toHaveBeenLastCalledWith(false);
    expect(proc.exit).toHaveBeenCalledWith(code);
  });

  it('runIfMain runs the live dashboard on two terminals and exits 0 after q', async () => {
    const { proc, output, keyboard } = procOf(['node', MAIN], true, true);
    const running = runIfMain(MAIN_URL, MAIN, profileIo, proc);
    expect(output().startsWith(`${ENTER_ALTERNATE}\x1b[H\x1b[2J`)).toBe(true);
    expect(keyboard.setRawMode).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(output()).toContain('$14.15'));
    keyboard.emit('data', 'q');
    await running;
    expect(output().endsWith('\x1b[?25h\x1b[?1049l')).toBe(true);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it('runIfMain route prints one line on two terminals without live mode, from the real clock and the process TZ', async () => {
    vi.mocked(runRoute).mockClear();
    const { proc, output, keyboard } = procOf(['node', MAIN, 'route', 'extra'], true, true);
    const before = new Date().toISOString();
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    const after = new Date().toISOString();
    expect(output()).toBe('model-a high claude\n');
    expect(keyboard.setRawMode).not.toHaveBeenCalled();
    expect(proc.exit).not.toHaveBeenCalled();
    const [io, env, { mode, now, zone }] = vi.mocked(runRoute).mock.calls[0];
    expect([io, env, mode, zone]).toEqual([routeIo, proc.env, 'headroom', Intl.DateTimeFormat().resolvedOptions().timeZone]);
    expect(now >= before && now <= after).toBe(true);
  });

  it.each<[string[], string, string]>([
    [['route', '--high'], 'high', 'model-h1 max claude\n'],
    [['route', 'extra', '--high'], 'high', 'model-h1 max claude\n'],
    [['route'], 'headroom', 'model-a high claude\n'],
    [['route', '--High'], 'headroom', 'model-a high claude\n']
  ])('runIfMain %j uses the --high chain only when an exact --high follows route', async (args, mode, line) => {
    vi.mocked(runRoute).mockClear();
    const { proc, output } = procOf(['node', MAIN, ...args], false, false);
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    expect(output()).toBe(line);
    expect(vi.mocked(runRoute).mock.calls[0][2].mode).toBe(mode);
  });

  it.each<[string[], string, string]>([
    [['route', '--why'], 'headroom', 'model-a high claude\n'],
    [['route', '--high', '--why'], 'high', 'model-h1 max claude\n'],
    [['route', '--why', '--high'], 'high', 'model-h1 max claude\n']
  ])('runIfMain %j asks for the explanation and keeps the route line first', async (args, mode, line) => {
    vi.mocked(runRoute).mockClear();
    const { proc, output } = procOf(['node', MAIN, ...args], false, false);
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    const [first, ...explanation] = output().trimEnd().split('\n');
    expect([first, explanation.length > 0, explanation.length <= 2]).toEqual([line.trimEnd(), true, true]);
    expect(vi.mocked(runRoute).mock.calls[0][2]).toMatchObject({ mode, why: true });
  });

  it.each<[string[], number | undefined]>([
    [['route', '--max-age', '30'], 30],
    [['route', '--high', '--max-age', '5', '--why'], 5],
    [['route', '--why', '--max-age', '1'], 1],
    [['route'], undefined],
    [['route', '--max-age'], undefined],
    [['route', '--max-age', '0'], undefined],
    [['route', '--max-age', '-5'], undefined],
    [['route', '--max-age', '1.5'], undefined],
    [['route', '--max-age', 'abc'], undefined],
    [['route', '--max-age', '--high'], undefined],
    [['route', '--max-age=30'], undefined],
    [['route', '30'], undefined]
  ])('runIfMain %j passes max age %s to route', async (args, maxAge) => {
    vi.mocked(runRoute).mockClear();
    await runIfMain(MAIN_URL, MAIN, routeIo, procOf(['node', MAIN, ...args], false, false).proc);
    expect(vi.mocked(runRoute).mock.calls[0][2].maxAge).toBe(maxAge);
  });

  it('runIfMain route never asks for the explanation without --why', async () => {
    vi.mocked(runRoute).mockClear();
    await runIfMain(MAIN_URL, MAIN, routeIo, procOf(['node', MAIN, 'route', '--Why'], false, false).proc);
    expect(vi.mocked(runRoute).mock.calls[0][2].why).toBe(false);
  });

  it.each<[string[], string, string]>([
    [['--high', MAIN, 'route'], 'headroom', 'model-a high claude\n'],
    [['node', '--high', 'route'], 'headroom', 'model-a high claude\n']
  ])('runIfMain %j ignores a --high that comes before route', async (argv, mode, line) => {
    vi.mocked(runRoute).mockClear();
    const { proc, output } = procOf(argv, false, false);
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    expect(output()).toBe(line);
    expect(vi.mocked(runRoute).mock.calls[0][2].mode).toBe(mode);
  });

  it('runIfMain prints identical usage for --help, -h and help, listing every command', async () => {
    const texts: string[] = [];
    for (const arg of ['--help', '-h', 'help']) {
      const { proc, output } = procOf(['node', MAIN, arg], true, true);
      await runIfMain(MAIN_URL, MAIN, routeIo, proc);
      texts.push(output());
    }
    expect(new Set(texts).size).toBe(1);
    for (const command of ['dandelion run', 'dandelion run --high', 'dandelion --json', 'dandelion --line', 'dandelion route --why', 'dandelion route --max-age <seconds>']) {
      expect(texts[0]).toMatch(new RegExp(`^  ${command.replace(/[-<>]/g, '\\$&')} +\\S`, 'm'));
    }
  });

  it.each<[string]>([['--help'], ['-h'], ['help']])('runIfMain %s prints the usage to stdout, exits 0 and runs no probe', async (arg) => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const io: ProbeIo = { ...routeIo, runner: { run } };
    const { proc, output, errors } = procOf(['node', MAIN, arg, 'extra'], true, true);
    await runIfMain(MAIN_URL, MAIN, io, proc);
    expect(output()).toMatch(/^Usage: dandelion \[command\]\n[\s\S]*dandelion route --high[\s\S]*README\.md[\s\S]*\n$/);
    expect(errors()).toBe('');
    expect(proc.exit).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each<[string[]]>([[['rout']], [['routes']], [['rout', '--once']], [['x']]])('runIfMain %j reports an unknown command on stderr, exits 2 and runs no probe', async (args) => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const io: ProbeIo = { ...routeIo, runner: { run } };
    const { proc, output, errors } = procOf(['node', MAIN, ...args], true, true);
    await runIfMain(MAIN_URL, MAIN, io, proc);
    expect(errors()).toMatch(new RegExp(`^dandelion: unknown command ${args[0]}\\nUsage: dandelion \\[command\\]\\n[\\s\\S]*README\\.md[\\s\\S]*\\n$`));
    expect(output()).toBe('');
    expect(proc.exit).toHaveBeenCalledExactlyOnceWith(2);
    expect(run).not.toHaveBeenCalled();
  });

  it.each<[string[]]>([[['--json']], [['--once', '--json']], [['--json', '--once']], [['x', '--json']]])('runIfMain %j prints one JSON line on two terminals without live mode and exits 0', async (args) => {
    const { proc, output, errors, keyboard } = procOf(['node', MAIN, ...args], true, true);
    const before = new Date().toISOString();
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    const after = new Date().toISOString();
    const snapshot = JSON.parse(output());
    expect(output().endsWith('}\n')).toBe(true);
    expect(output().slice(0, -1)).not.toContain('\n');
    expect(snapshot.generatedAt >= before && snapshot.generatedAt <= after).toBe(true);
    expect(snapshot.providers).toHaveLength(11);
    expect([snapshot.route, snapshot.routeHigh]).toEqual(['model-a high claude', 'model-h1 max claude']);
    expect(errors()).toBe('');
    expect(keyboard.setRawMode).not.toHaveBeenCalled();
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it.each<[string[], number | undefined]>([
    [['--json', '--max-age', '30'], 30],
    [['--max-age', '5', '--json'], 5],
    [['--json'], undefined],
    [['--json', '--max-age'], undefined],
    [['--json', '--max-age', '0'], undefined],
    [['--json', '--max-age', '-5'], undefined],
    [['--json', '--max-age', '1.5'], undefined]
  ])('runIfMain %j passes max age %s to --json', async (args, maxAge) => {
    vi.mocked(runJson).mockClear();
    await runIfMain(MAIN_URL, MAIN, routeIo, procOf(['node', MAIN, ...args], false, false).proc);
    expect(vi.mocked(runJson).mock.calls[0][2].maxAge).toBe(maxAge);
  });

  it.each<[string[], number | undefined]>([
    [['--line', '--max-age', '30'], 30],
    [['--max-age', '5', '--line'], 5],
    [['--line'], undefined],
    [['--line', '--max-age', '0'], undefined]
  ])('runIfMain %j passes max age %s to --line', async (args, maxAge) => {
    vi.mocked(runLine).mockClear();
    await runIfMain(MAIN_URL, MAIN, routeIo, procOf(['node', MAIN, ...args], false, false).proc);
    expect(vi.mocked(runLine).mock.calls[0][2].maxAge).toBe(maxAge);
  });

  it('runIfMain --line prints one plain line on two terminals without live mode and exits 0', async () => {
    const { proc, output, errors, keyboard } = procOf(['node', MAIN, '--line'], true, true);
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    expect(output()).toMatch(/^.* → model-a high claude\n$/);
    expect(output()).not.toContain('\x1b');
    expect([errors(), proc.exit.mock.calls, keyboard.setRawMode.mock.calls]).toEqual(['', [], []]);
  });

  it('runIfMain --line with a bad routes file warns on stderr and does not exit', async () => {
    const { proc, output, errors } = procOf(['node', MAIN, '--line'], true, true, { DANDELION_ROUTES_FILE: '/nonexistent/routes.json' });
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    expect(output()).toMatch(/→ routes file error\n$/);
    expect(errors()).toBe('dandelion: routes file /nonexistent/routes.json: cannot be read\n');
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it('runIfMain --json --line prints the JSON object and route --line prints the route', async () => {
    const both = procOf(['node', MAIN, '--line', '--json'], false, false);
    await runIfMain(MAIN_URL, MAIN, routeIo, both.proc);
    expect(JSON.parse(both.output()).route).toBe('model-a high claude');
    const route = procOf(['node', MAIN, 'route', '--line'], false, false);
    await runIfMain(MAIN_URL, MAIN, routeIo, route.proc);
    expect(route.output()).toBe('model-a high claude\n');
  });

  it('runIfMain --json with a bad routes file nulls the routes, warns on stderr and does not exit', async () => {
    const { proc, output, errors } = procOf(['node', MAIN, '--json'], true, true, { DANDELION_ROUTES_FILE: '/nonexistent/routes.json' });
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    const snapshot = JSON.parse(output());
    expect([snapshot.route, snapshot.routeHigh, snapshot.routesError]).toEqual([null, null, '/nonexistent/routes.json: cannot be read']);
    expect(errors()).toBe('dandelion: routes file /nonexistent/routes.json: cannot be read\n');
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it.each<[string[], string]>([[['route', '--json'], 'model-a high claude\n'], [['route', '--high', '--json'], 'model-h1 max claude\n']])('runIfMain %j ignores --json', async (args, line) => {
    const { proc, output, errors } = procOf(['node', MAIN, ...args], true, true);
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    expect([output(), errors()]).toEqual([line, '']);
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it('runIfMain route --json keeps exit code 1 for none and exit code 2 for a bad routes file', async () => {
    const none = procOf(['node', MAIN, 'route', '--json'], false, false);
    await runIfMain(MAIN_URL, MAIN, profileIo, none.proc);
    expect([none.output(), none.proc.exit.mock.calls]).toEqual(['none\n', [[1]]]);
    const bad = procOf(['node', MAIN, 'route', '--json'], false, false, { DANDELION_ROUTES_FILE: '/nonexistent/routes.json' });
    await runIfMain(MAIN_URL, MAIN, routeIo, bad.proc);
    expect([bad.output(), bad.errors(), bad.proc.exit.mock.calls]).toEqual(['', 'dandelion: routes file /nonexistent/routes.json: cannot be read\n', [[2]]]);
  });

  it.each<[string[], string[]]>([
    [['run'], ['--model', 'model-a', '--effort', 'high']],
    [['run', '--high', 'x'], ['--model', 'model-h1', '--effort', 'max', 'x']],
    [['run', '--', '--high'], ['--model', 'model-a', '--effort', 'high', '--high']],
    [['run', '--max-age', '600', 'x'], ['--model', 'model-a', '--effort', 'high', 'x']],
    [['run', '--max-age', '0', 'x'], ['--model', 'model-a', '--effort', 'high', 'x']],
    [['run', '--', '--max-age', '600'], ['--model', 'model-a', '--effort', 'high', '--max-age', '600']]
  ])('runIfMain %j launches the routed CLI and exits with its code', async (args, expected) => {
    const spawn = vi.spyOn(realRunSpawner, 'spawn').mockResolvedValue(4);
    const { proc, output, errors } = procOf(['node', MAIN, ...args], true, true);
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    expect(spawn.mock.calls[0][0].args).toEqual(expected);
    expect(proc.exit).toHaveBeenCalledWith(4);
    expect([output(), errors()]).toEqual(['', '']);
    spawn.mockRestore();
  });

  it.each<[string[], number | undefined]>([
    [['run', '--max-age', '30'], 30],
    [['run', '--high', '--max-age', '5'], 5],
    [['run'], undefined],
    [['run', '--max-age', '0'], undefined],
    [['run', '--', '--max-age', '30'], undefined]
  ])('runIfMain %j passes max age %s to the route resolution', async (args, maxAge) => {
    vi.mocked(runRun).mockClear();
    const spawn = vi.spyOn(realRunSpawner, 'spawn').mockResolvedValue(0);
    await runIfMain(MAIN_URL, MAIN, routeIo, procOf(['node', MAIN, ...args], true, true).proc);
    expect(vi.mocked(runRun).mock.calls[0][2].maxAge).toBe(maxAge);
    spawn.mockRestore();
  });

  it('runIfMain run prints none on stderr and exits 1 when nothing routes', async () => {
    const { proc, output, errors } = procOf(['node', MAIN, 'run'], true, true);
    await runIfMain(MAIN_URL, MAIN, profileIo, proc);
    expect([output(), errors()]).toEqual(['', 'none\n']);
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it('runIfMain route prints none and exits 1 when nothing routes', async () => {
    const { proc, output } = procOf(['node', MAIN, 'route'], undefined, undefined);
    await runIfMain(MAIN_URL, MAIN, profileIo, proc);
    expect(output()).toBe('none\n');
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it.each([[['--once', 'route']], [['--once', 'route', '--high']]])('runIfMain keeps the dashboard for %j', async (args) => {
    vi.mocked(runRoute).mockClear();
    const { proc, output } = procOf(['node', MAIN, ...args], true, false);
    await runIfMain(MAIN_URL, MAIN, profileIo, proc);
    expect(output()).toMatch(/^DANDELION +\d{2}:\d{2}:\d{2}\n/);
    expect(runRoute).not.toHaveBeenCalled();
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it('prints only the route line, with empty stderr, through node src/main.ts route and exits 1 with none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dandelion-route-'));
    try {
      linkNodeAndShell(dir);
      writeFixture(dir, 'claude', "[ -z \"$CLAUDE_CONFIG_DIR\" ] || exit 1\nprintf '%s\\n' 'Current week (all models): 86% used'");
      writeFixture(dir, 'codex', "echo 'Logged in using an API key - sk-proj-***n5zQA' >&2");
      writeFixture(dir, 'kilo', "echo 'Balance: $14.15'");
      const env: NodeJS.ProcessEnv = { HOME: dir, PATH: dir, DANDELION_KIMI_PORT: '1', DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'missing.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: join(dir, 'missing'), DANDELION_HERMES_AUTH_FILE: join(dir, 'missing-hermes.json'), DANDELION_ROUTES_FILE: ROUTES_FILE, DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json') };
      const routed = spawnSync(process.execPath, ['src/main.ts', 'route'], { env, encoding: 'utf-8', timeout: 60000 });
      expect([routed.stdout, routed.stderr, routed.status]).toEqual(['model-a high claude\n', '', 0]);
      rmSync(join(dir, 'claude'));
      const none = spawnSync(process.execPath, ['src/main.ts', 'route'], { env, encoding: 'utf-8', timeout: 60000 });
      expect([none.stdout, none.stderr, none.status]).toEqual(['none\n', '', 1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([[['route']], [['route', '--high']], [['route', '--why']], [['route', '--high', '--why']]])('runIfMain %j prints nothing on stdout, the fault on stderr and exits 2 with a bad routes file', async (args) => {
    const path = join(tmpdir(), 'dandelion-no-such-dir', 'nope.json');
    const { proc, output, errors } = procOf(['node', MAIN, ...args], false, false, { DANDELION_ROUTES_FILE: path });
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    expect([output(), errors()]).toEqual(['', `dandelion: routes file ${path}: cannot be read\n`]);
    expect(proc.exit).toHaveBeenCalledWith(2);
  });

  it('runIfMain --once prints the dashboard, the routes file fault on stderr and exits 0', async () => {
    const good = procOf(['node', MAIN, '--once'], false, false);
    await runIfMain(MAIN_URL, MAIN, profileIo, good.proc);
    const path = join(tmpdir(), 'dandelion-no-such-dir', 'nope.json');
    const bad = procOf(['node', MAIN, '--once'], false, false, { DANDELION_ROUTES_FILE: path });
    await runIfMain(MAIN_URL, MAIN, profileIo, bad.proc);
    expect(withoutCountdowns(bad.output())).toBe(withoutCountdowns(good.output()));
    expect([good.errors(), bad.errors()]).toEqual(['', `dandelion: routes file ${path}: cannot be read\n`]);
    expect(bad.proc.exit).not.toHaveBeenCalled();
  });

  it('runIfMain route --high prints one line on two terminals without live mode', async () => {
    vi.mocked(runRoute).mockClear();
    const { proc, output, keyboard } = procOf(['node', MAIN, 'route', '--high'], true, true);
    await runIfMain(MAIN_URL, MAIN, routeIo, proc);
    expect(output()).toBe('model-h1 max claude\n');
    expect(keyboard.setRawMode).not.toHaveBeenCalled();
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it('walks the chain past a tripped Fable window through node src/main.ts route --high, while plain route keeps 010 with the token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dandelion-route-high-'));
    try {
      linkNodeAndShell(dir);
      writeFixture(dir, 'claude', "[ -z \"$CLAUDE_CONFIG_DIR\" ] || exit 1\nprintf '%s\\n' 'Current session: 10% used' 'Current week (all models): 50% used' 'Current week (Fable): 100% used'");
      writeFixture(dir, 'codex', "echo 'Logged in using an API key - sk-proj-***n5zQA' >&2");
      writeFixture(dir, 'kilo', "echo 'Balance: $14.15'");
      const env: NodeJS.ProcessEnv = { HOME: dir, PATH: dir, DANDELION_KIMI_PORT: '1', DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'missing.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: join(dir, 'missing'), DANDELION_HERMES_AUTH_FILE: join(dir, 'missing-hermes.json'), DANDELION_ROUTES_FILE: ROUTES_FILE, DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json') };
      const high = spawnSync(process.execPath, ['src/main.ts', 'route', '--high'], { env, encoding: 'utf-8', timeout: 60000 });
      expect([high.stdout, high.stderr, high.status]).toEqual(['model-a max claude\n', '', 0]);
      const plain = spawnSync(process.execPath, ['src/main.ts', 'route'], { env, encoding: 'utf-8', timeout: 60000 });
      expect([plain.stdout, plain.stderr, plain.status]).toEqual(['model-a high claude\n', '', 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a bad routes file wins over none: node src/main.ts route exits 2 with one stderr line and no stdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dandelion-routes-none-'));
    try {
      linkNodeAndShell(dir);
      const env = isolatedEnv(dir, { DANDELION_ROUTES_FILE: join(dir, 'nope.json') });
      const result = spawnSync(process.execPath, ['src/main.ts', 'route'], { env, encoding: 'utf-8', timeout: 60000 });
      expect([result.stdout, result.stderr, result.status]).toEqual(['', `dandelion: routes file ${join(dir, 'nope.json')}: cannot be read\n`, 2]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('a copy of the checkout run through npm link symlinks', () => {
    const F = {
      route: {
        claude: { standard: 'model-a high', max: 'model-a max' },
        'claude-work': { standard: 'model-b high', max: 'model-b max' },
        'claude-deepseek': { standard: 'vendor/model-o max', max: 'vendor/model-o max' },
        agy: { standard: 'model-c high', max: 'model-c max' },
        kimi: { standard: 'model-d', max: 'model-d max' },
        grok: { standard: 'model-e xhigh', max: 'model-e xhigh' },
        cursor: { standard: 'model-f', max: 'model-f' },
        junie: { standard: 'model-g high', max: 'model-g high' },
        hermes: { standard: 'vendor/model-h xhigh', max: 'vendor/model-h xhigh' }
      },
      high: { fable: 'model-h1 max', cursor: 'model-h2', opus: 'model-h3 max', grok: 'model-h4 xhigh', agy: 'model-h5 high' }
    };
    const DECOY = JSON.stringify(F).replaceAll('model-', 'decoy-');

    function linkedCopy() {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'dandelion-linked-')));
      const checkout = join(root, 'checkout');
      cpSync(dirname(MAIN), join(checkout, 'src'), { recursive: true });
      cpSync(join(dirname(MAIN), '..', 'package.json'), join(checkout, 'package.json'));
      writeFileSync(join(checkout, 'routes.json'), JSON.stringify(F));
      for (const folder of ['lib', 'bin', 'work', 'tools']) mkdirSync(join(root, folder));
      symlinkSync(checkout, join(root, 'lib', 'dandelion'));
      symlinkSync(join(root, 'lib', 'dandelion', 'src', 'main.ts'), join(root, 'bin', 'dandelion'));
      for (const folder of ['', 'lib', 'bin', 'work']) writeFileSync(join(root, folder, 'routes.json'), DECOY);
      linkNodeAndShell(join(root, 'tools'));
      const grokHome = join(root, 'grok');
      mkdirSync(join(grokHome, 'logs'), { recursive: true });
      const now = Date.now();
      const config = { creditUsagePercent: 50, currentPeriod: { end: new Date(now + 72 * 3600000).toISOString() } };
      writeFileSync(join(grokHome, 'logs', 'unified.jsonl'), `${JSON.stringify({ ts: new Date(now).toISOString(), msg: 'billing: fetched credits config', ctx: { config } })}\n`);
      const run = (extra: NodeJS.ProcessEnv, entry = join(root, 'bin', 'dandelion')) => {
        const env = { ...isolatedEnv(join(root, 'tools'), extra), DANDELION_GROK_HOME: grokHome };
        return spawnSync(process.execPath, [entry, 'route'], { cwd: join(root, 'work'), env, encoding: 'utf-8', timeout: 60000 });
      };
      return { root, checkout, run };
    }

    it.each<[string, NodeJS.ProcessEnv]>([
      ['unset', {}],
      ['empty', { DANDELION_ROUTES_FILE: '' }]
    ])('reads the checkout routes.json, not a decoy, with DANDELION_ROUTES_FILE %s', (_case, extra) => {
      const { root, run } = linkedCopy();
      try {
        const result = run(extra);
        expect([result.stdout, result.stderr, result.status]).toEqual(['model-e xhigh grok\n', '', 0]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('finds a relative DANDELION_ROUTES_FILE from the working directory', () => {
      const { root, run } = linkedCopy();
      try {
        expect(run({ DANDELION_ROUTES_FILE: 'routes.json' }).stdout).toBe('decoy-e xhigh grok\n');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('prints an edited line after a one-line edit to routes.json', () => {
      const { root, checkout, run } = linkedCopy();
      try {
        writeFileSync(join(checkout, 'routes.json'), JSON.stringify({ ...F, route: { ...F.route, grok: { standard: 'model-z high', max: 'model-e xhigh' } } }));
        expect(run({}).stdout).toBe('model-z high grok\n');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('names the real path of a missing shipped file, and still routes with DANDELION_ROUTES_FILE', () => {
      const { root, checkout, run } = linkedCopy();
      try {
        rmSync(join(checkout, 'routes.json'));
        const missing = run({}, join(checkout, 'src', 'main.ts'));
        expect([missing.stdout, missing.stderr, missing.status]).toEqual(['', `dandelion: routes file ${join(checkout, 'routes.json')}: cannot be read\n`, 2]);
        expect(run({ DANDELION_ROUTES_FILE: join(root, 'routes.json') }).stdout).toBe('decoy-e xhigh grok\n');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  it('runIfMain does nothing for another entry file', async () => {
    const io = { runner: { run: vi.fn() }, launcher: { launch: vi.fn() }, fetcher: { get: vi.fn(), post: vi.fn() }, reader: { homeDir: vi.fn(), read: vi.fn(), isDirectory: vi.fn() }, spawner: { spawn: vi.fn() } };
    await runIfMain(MAIN_URL, 'other.ts', io, procOf(['node', 'other.ts'], true, true).proc);
    await runIfMain(MAIN_URL, 'README.md', io, procOf(['node', 'README.md'], true, true).proc);
    expect(io.runner.run).not.toHaveBeenCalled();
    expect(io.launcher.launch).not.toHaveBeenCalled();
    expect(io.spawner.spawn).not.toHaveBeenCalled();
  });

  it('declares the dandelion bin with a shebang on an executable main.ts and no dependencies', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
    expect([pkg.name, pkg.bin, pkg.scripts, pkg.dependencies]).toEqual([
      'dandelion',
      { dandelion: 'src/main.ts' },
      { start: 'node src/main.ts', test: 'vitest run', qa: 'node qa/e2e.mjs' },
      undefined
    ]);
    expect(readFileSync(MAIN, 'utf-8').split('\n')[0]).toBe('#!/usr/bin/env node');
    const index = spawnSync('git', ['ls-files', '-s', '--', ':/src/main.ts'], { encoding: 'utf-8' });
    expect(index.stdout).toMatch(/^100755 /);
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme.startsWith('# Dandelion Dashboard\n\nDandelion is a terminal dashboard')).toBe(true);
    expect(readme).toContain('All eleven probes run in parallel');
  });

  it('prints the same DANDELION dashboard through node src/main.ts and a dandelion symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dandelion-entry-'));
    try {
      linkNodeAndShell(dir);
      symlinkSync(MAIN, join(dir, 'dandelion'));
      writeFixture(dir, 'claude', "printf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'");
      writeFixture(dir, 'agy', "printf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'");
      writeFixture(dir, 'kimi', 'exit 0');
      writeFixture(dir, 'codex', "echo 'Logged in using an API key - sk-proj-***n5zQA' >&2");
      writeFixture(dir, 'kilo', "echo 'Balance: $14.15'");
      const env: NodeJS.ProcessEnv = { HOME: dir, PATH: dir, NO_COLOR: '1', DANDELION_KIMI_PORT: '1', DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'missing.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: dir, DANDELION_HERMES_AUTH_FILE: join(dir, 'missing-hermes.json'), DANDELION_ROUTES_FILE: ROUTES_FILE, DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json') };
      const runs = ['src/main.ts', join(dir, 'dandelion')].map((entry) => spawnSync(process.execPath, [entry, '--once'], { env, encoding: 'utf-8', timeout: 60000 }));
      const panelOrder = ['claude', 'claude-work', 'claude-deepseek', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];
      for (const run of runs) {
        expect(run.status).toBe(0);
        const lines = run.stdout.split('\n');
        expect(lines[0]).toMatch(/^DANDELION +\d{2}:\d{2}:\d{2}$/);
        expect(lines.filter((line) => panelOrder.includes(line))).toEqual(panelOrder);
        expect(lines.every((line) => [...line].length <= 72)).toBe(true);
        expect(run.stdout).not.toMatch(/allowance/i);
      }
      expect(new Set(runs.map((run) => withoutCountdowns(run.stdout))).size).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs with only fixtures, node and sh on PATH and no runtime dependencies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dandelion-nodebin-'));
    try {
      linkNodeAndShell(dir);
      writeFixture(dir, 'codex', "echo 'Logged in using an API key - sk-proj-***n5zQA' >&2");
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: dir, NO_COLOR: '1', DANDELION_KIMI_HOME: dir, DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'no-cursor-auth.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: dir, DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR: join(dir, 'no-deepseek'), DANDELION_HERMES_AUTH_FILE: join(dir, 'missing-hermes.json'), DANDELION_ROUTES_FILE: ROUTES_FILE, DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json') };
      const result = spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf-8', timeout: 60000 });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/\ngrok\n[^]*\ncodex\napi-key billing · no usage windows\ncodex · codex\n[^]*\ncursor\n[^]*\nkilo\n/);
      expect(JSON.parse(readFileSync('package.json', 'utf-8')).dependencies).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints eleven dim unavailable panels in order when no CLI is on PATH, grok and junie homes are empty and cursor auth is missing', () => {
    const grokHome = mkdtempSync(join(tmpdir(), 'dandelion-grok-'));
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: '', DANDELION_KIMI_HOME: grokHome, DANDELION_GROK_HOME: grokHome, DANDELION_JUNIE_HOME: grokHome, DANDELION_CURSOR_AUTH_FILE: join(grokHome, 'missing.json'), DANDELION_HERMES_AUTH_FILE: join(grokHome, 'missing-hermes.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: grokHome, DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR: join(grokHome, 'no-deepseek'), DANDELION_ROUTES_FILE: ROUTES_FILE, DANDELION_STATE_FILE: join(grokHome, 'state', 'eligibility.json') };
    delete env.NO_COLOR;
    const result = spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf-8' });
    rmSync(grokHome, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('DANDELION');
    const panels = [
      ['claude', 'claude CLI not found in PATH', 'claude · personal · claude'],
      ['claude-work', 'claude CLI not found in PATH', 'claude · work · claude-work'],
      ['claude-deepseek', 'no deepseek config — CLAUDE_CONFIG_DIR=~/.claude-deepseek claude', 'claude · deepseek · claude-deepseek'],
      ['agy', 'agy CLI not found in PATH', 'agy · agy'],
      ['kimi', 'kimi CLI not found in PATH', 'kimi code · kimi'],
      ['grok', 'no grok billing snapshot — run grok once', 'grok · grok'],
      ['codex', 'codex CLI not found in PATH', 'codex · codex'],
      ['cursor', 'no cursor auth — run cursor-agent login', 'cursor · cursor'],
      ['junie', 'no junie quota snapshot — run junie once', 'junie · junie'],
      ['hermes', 'no hermes auth — run hermes portal login', 'hermes · hermes'],
      ['kilo', 'kilo CLI not found in PATH', 'api balance · kilo']
    ].map((lines) => `\x1b[90m${'━'.repeat(72)}\x1b[0m\n\x1b[90m${lines.join('\x1b[0m\n\x1b[90m')}\x1b[0m`);
    expect(result.stdout).toBe(`${result.stdout.split('\n')[0]}\n${panels.join('\n')}\n`);
    expect(result.stdout).not.toContain('Command failed');
  });

  it('README is updated with project details', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme.startsWith('# Dandelion Dashboard\n\nDandelion is a terminal dashboard')).toBe(true);
    expect(readme).toMatch(/^- `dandelion` - .*`npm link`.*`dandelion --once`/m);
    expect(readme).toContain('npm start');
    expect(readme).toContain('DANDELION_KILO_REFERENCE');
  });

  it('README documents kimi', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const providers = readme.split('\n').filter((line) => /^- `(claude|agy|kimi|kilo)` /.test(line));
    const kimi = providers[2];
    expect(kimi).toContain('(kimi code)');
    expect(kimi).toContain("`kimi web`'s local usage endpoint");
    expect(kimi).toContain('20s');
    expect(kimi).toContain('10s request timeout');
    expect(kimi).toContain('SIGTERM, then SIGKILL after 5s');
    expect(readme).toMatch(/^- `DANDELION_KIMI_PORT` - .*Defaults to `59177`/m);
  });

  it('README documents grok', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const providers = readme.split('\n').filter((line) => /^- `(claude|agy|kimi|grok|kilo)` /.test(line));
    const grok = providers[3];
    expect(grok).toContain('newest billing snapshot from `<grok home>/logs/unified.jsonl` without running grok');
    expect(grok).toContain('older than 48h is shown dim as stale');
    expect(readme).not.toContain('All four probes run in parallel');
    expect(readme).toMatch(/^- `DANDELION_GROK_HOME` - .*Defaults to `~\/\.grok`/m);
  });

  it('README documents codex', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const providers = readme.split('\n').filter((line) => /^- `(claude|agy|kimi|grok|codex|kilo)` /.test(line));
    expect(providers.map((line) => line.split('`')[1])).toEqual(['claude', 'agy', 'kimi', 'grok', 'codex', 'kilo']);
    const codex = providers[4];
    expect(codex).toContain('runs `codex login status` (15s timeout)');
    expect(codex).toContain('api-key billing · no usage windows');
    expect(codex).toContain('reads `account/rateLimits/read`');
    expect(codex).toContain('`codex app-server`');
    expect(codex).toContain('30s timeout');
    expect(codex).toContain('SIGTERM, then SIGKILL after 5s');
  });

  it('README documents cursor', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme).toContain('subscription usage windows for `claude`, `agy`, `kimi`, `grok`, `codex` and `cursor`, the credits balance for `junie`, the Nous Portal credits for `hermes`, and the API balance for `kilo`');
    const providers = readme.split('\n').filter((line) => /^- `(claude|agy|kimi|grok|codex|cursor|kilo)` /.test(line));
    expect(providers.map((line) => line.split('`')[1])).toEqual(['claude', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo']);
    const cursor = providers[5];
    expect(cursor).toContain('without running cursor-agent');
    expect(cursor).toContain('`GetCurrentPeriodUsage`');
    expect(cursor).toContain('`GetPlanInfo`');
    expect(cursor).toContain('15s timeout each');
    expect(cursor).toContain('total, auto and api windows with a reset countdown');
    expect(readme).not.toContain('All six probes run in parallel');
    expect(readme).toMatch(/^- `DANDELION_CURSOR_AUTH_FILE` - .*Defaults to `~\/\.config\/cursor\/auth\.json`/m);
    expect(readme).toMatch(/^- `DANDELION_CURSOR_API_BASE` - .*Defaults to `https:\/\/api2\.cursor\.sh`/m);
  });

  it('README documents junie', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme).toContain('`codex` and `cursor`, the credits balance for `junie`, the Nous Portal credits for `hermes`, and the API balance for `kilo`');
    const providers = readme.split('\n').filter((line) => /^- `(claude|claude-work|agy|kimi|grok|codex|cursor|junie|kilo)` /.test(line));
    expect(providers.map((line) => line.split('`')[1])).toEqual(['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'kilo']);
    const junie = providers[7];
    expect(junie).toContain('newest completion snapshot from `<junie home>/sessions/<id>/events.jsonl` without running junie');
    expect(junie).toContain('credits used against a reference');
    expect(junie).toContain("the snapshot's age");
    expect(junie).toContain('older than 48h is shown dim as stale');
    expect(junie).toContain('says to run junie once');
    expect(readme).toContain('All eleven probes run in parallel');
    expect(readme).not.toContain('All nine probes run in parallel');
    expect(readme).toMatch(/^- `DANDELION_JUNIE_HOME` - .*Defaults to `~\/\.junie`.*never writes to it/m);
    expect(readme).toMatch(/^- `DANDELION_JUNIE_REFERENCE` - .*Defaults to `1000000`.*empty string, there is no reference.*not a positive number uses the default/m);
    const route = readme.split('## Route')[1].split('## ')[0];
    expect(route).toContain('`grok`, `cursor`, `junie` and `hermes`, in dashboard order');
    expect(route).toContain('junie credits, hermes credits, claude-deepseek spending limit)');
    expect(route).toContain('| cursor | `route.cursor.standard` | `route.cursor.max` |\n| junie | `route.junie.standard` | `route.junie.max` |\n');
    expect(route).toContain('so `--high` does not use junie');
  });

  it('README documents hermes', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme).toContain('the credits balance for `junie`, the Nous Portal credits for `hermes`, and the API balance for `kilo`');
    const providers = readme.split('\n').filter((line) => /^- `(claude|claude-work|agy|kimi|grok|codex|cursor|junie|hermes|kilo)` /.test(line));
    expect(providers.map((line) => line.split('`')[1])).toEqual(['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo']);
    const hermes = providers[8];
    expect(hermes).toContain('Nous Portal tokens from the hermes auth file without running hermes');
    expect(hermes).toContain('GETs `/api/oauth/account` (15s timeout)');
    expect(hermes).toContain('credits window with a reset countdown');
    expect(hermes).toContain('remaining versus the monthly grant');
    expect(hermes).toContain('never prints the tokens');
    expect(hermes).toContain('hermes portal login');
    expect(hermes).toContain('hermes once');
    expect(readme).toContain('All eleven probes run in parallel');
    expect(readme).not.toContain('All nine probes run in parallel');
    expect(readme).toMatch(/^- `DANDELION_HERMES_AUTH_FILE` - .*Defaults to `~\/\.hermes\/auth\.json`/m);
    expect(readme).toMatch(/^- `DANDELION_HERMES_PORTAL_BASE` - .*Defaults to `https:\/\/portal\.nousresearch\.com`/m);
    const route = readme.split('## Route')[1].split('## ')[0];
    expect(route).toContain('`junie` and `hermes`, in dashboard order');
    expect(route).toContain('hermes credits, claude-deepseek spending limit)');
    expect(route).toContain('| junie | `route.junie.standard` | `route.junie.max` |\n| hermes | `route.hermes.standard` | `route.hermes.max` |\n');
    expect(route).toContain('`--high` does not use hermes');
  });

  it('README documents the work claude account', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const providers = readme.split('\n').filter((line) => /^- `(claude|claude-work|agy)` /.test(line));
    expect(providers.map((line) => line.split('`')[1])).toEqual(['claude', 'claude-work', 'agy']);
    expect(providers[0]).toContain('(claude · personal)');
    expect(providers[1]).toContain('(claude · work)');
    expect(providers[1]).toContain('same command with `CLAUDE_CONFIG_DIR` set to the work config dir');
    expect(providers[1]).toContain('Without that dir it is unavailable');
    expect(readme).not.toContain('All seven probes run in parallel');
    expect(readme).toMatch(/^- `DANDELION_CLAUDE_WORK_CONFIG_DIR` - .*Defaults to `~\/\.claude-work`/m);
  });

  it('README documents the deepseek claude account', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const providers = readme.split('\n').filter((line) => /^- `claude-deepseek` /.test(line));
    expect(providers).toHaveLength(1);
    expect(providers[0]).toContain('(claude · deepseek)');
    expect(providers[0]).toContain('https://openrouter.ai/api/v1/key');
    expect(providers[0]).toContain('10s timeout');
    expect(providers[0]).toContain('openrouter key has no spending limit');
    expect(providers[0]).toContain('no deepseek config — CLAUDE_CONFIG_DIR=~/.claude-deepseek claude');
    expect(providers[0]).toContain('never printed');
    expect(readme).toContain('All eleven probes run in parallel');
    expect(readme).toMatch(/^- `DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR` - .*Defaults to `~\/\.claude-deepseek`/m);
    const route = readme.split('## Route')[1].split('## ')[0];
    expect(route).toContain('| claude-deepseek | `route.claude-deepseek.standard` | `route.claude-deepseek.max` |');
    expect(route).toContain('claude-deepseek spending limit');
    expect(route).toContain('`--high` does not use claude-deepseek');
    expect(route).toMatch(/`claude-deepseek` means launching claude with `CLAUDE_CONFIG_DIR` set to `DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR` \(default `~\/\.claude-deepseek`\)/);
  });

  it('README documents route', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const commands = readme.split('## Run Commands')[1].split('## ')[0];
    expect(commands).toMatch(/^- `dandelion route` \(or `npm start -- route`\) - .*print one line.*prints `none` and exits 1/m);
    const route = readme.split('## Route')[1];
    expect(route).toContain('`kilo` is never routed, because it reports a balance');
    expect(route).toContain('`codex` is never routed, because it has no subscription windows to route on');
    expect(route).toMatch(/Evaporation: a weekly window .* before the next local midnight with less than 97% left/);
    expect(route).toMatch(/Most headroom: .*lowest left over its rolling and weekly windows \(100 when it has neither\)/);
    for (const id of ['claude', 'claude-work', 'claude-deepseek', 'agy', 'kimi', 'grok', 'cursor']) expect(route).toContain(`| ${id} | \`route.${id}.standard\` | \`route.${id}.max\` |`);
  });

  it('README documents route --high and the account token', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const commands = readme.split('## Run Commands')[1].split('## ')[0];
    expect(commands).toMatch(/^- `dandelion route --high` \(or `npm start -- route --high`\) - .*strongest model.*prints `none` and exits 1/m);
    const route = readme.split('## Route')[1].split('## ')[0];
    for (const row of [
      '| 1 | claude, claude-work | `fable`: the Fable weekly window plus session | `high.fable` |',
      '| 2 | cursor | (all) | `high.cursor` |',
      '| 3 | claude, claude-work | (all) | `high.opus` |',
      '| 4 | grok | (all) | `high.grok` |',
      '| 5 | agy | (all) | `high.agy` |'
    ]) expect(route).toContain(row);
    expect(route).toMatch(/except the windows another entry of the same provider matches/);
    expect(route).toMatch(/every gating window is under 90% used; at 90% it pops down/);
    expect(route).toMatch(/Ineligible, unavailable and failed providers are skipped/);
    expect(route).toMatch(/both `route` and `route --high` print `<line> <provider id>`/);
    expect(route).toMatch(/`claude-work` means launching claude with `CLAUDE_CONFIG_DIR` set to `DANDELION_CLAUDE_WORK_CONFIG_DIR` \(default `~\/\.claude-work`\)/);
  });

  it('README documents route eligibility', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const commands = readme.split('## Run Commands')[1].split('## ')[0];
    expect(commands).toMatch(/^- `npm start` - .*`↑↓\/jk select`.*`space routing on\/off`/m);
    const route = readme.split('## Route')[1].split('## ')[0];
    const paragraphs = route.split('\n\n').filter((paragraph) => paragraph.startsWith('Eligibility:'));
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toMatch(/dropped before both rules.*press space.*cannot be toggled.*state file/);
    expect(readme).toMatch(/^- `DANDELION_STATE_FILE` - .*Defaults to `\$XDG_STATE_HOME\/dandelion\/eligibility\.json`, else `~\/\.local\/state\/dandelion\/eligibility\.json`/m);
  });

  it('README documents the route trip', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const route = readme.split('## Route')[1].split('## ')[0];
    const [trip] = route.split('\n\n').filter((paragraph) => paragraph.startsWith('The trip:'));
    expect(trip).toMatch(/before both rules, route skips every tripped account/);
    expect(trip).toMatch(/rolling windows \(claude and claude-work session, kimi 5h, agy 5h \(Claude\+GPT · 5h, Gemini · 5h\)\) is 90% used or more; 90% itself trips/);
    expect(trip).toMatch(/weekly and other windows never trip/);
    expect(trip).toMatch(/ignored by rule 1 and its binding is ignored by rule 2/);
    expect(trip).toMatch(/same 90% trip `route --high` uses/);
    expect(trip).toMatch(/ineligible, unavailable and tripped accounts are skipped, route prints `none` and exits 1/);
  });

  it('README documents live mode', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const commands = readme.split('## Run Commands')[1]?.split('## ')[0] ?? '';
    expect(commands).toMatch(/^- `npm start` - .*live dashboard.*`r` refresh.*`q` quit.*`\?` help/m);
    expect(commands).toMatch(/^- `npm start -- --once` - Run the dashboard once and exit$/m);
    expect(commands).toContain('runs once when stdout or stdin is not a terminal');
    expect(readme).toMatch(/^- `DANDELION_REFRESH_SECONDS` - .*Defaults to `300`/m);
  });

  it('README documents the route boxes', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const commands = readme.split('## Run Commands')[1].split('## ')[0];
    expect(commands).toMatch(/^- `npm start` - .*Two boxes at the top show the answers `dandelion route` and `dandelion route --high` would print; they update when a round settles or routing is toggled/m);
  });

  it('README documents routes.json, its shape, DANDELION_ROUTES_FILE and the exit-2 errors, with no line strings in the route tables', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const file = readme.split('## routes.json')[1].split('\n## ')[0];
    expect(file).toContain('To change a routed model, edit routes.json.');
    expect(file).toMatch(/real path of `src\/main\.ts` after following symlinks, never from the working directory/);
    expect(file).toMatch(/"route": \{\n {4}"claude": \{ "standard": "<line>", "max": "<line>" \}/);
    expect(file).toContain('"high": { "fable": "<line>", "cursor": "<line>", "opus": "<line>", "grok": "<line>", "agy": "<line>" }');
    expect(file).toContain('A line is `<model>` or `<model> <effort>`: one or two words, one space apart.');
    expect(file).toMatch(/print nothing on stdout, print `dandelion: routes file <path>: <what is wrong>` on stderr and exit 2, even when nothing could be routed\. Exit 1 stays reserved for `none`/);
    expect(file).toMatch(/`--once` prints its dashboard as usual, the same line on stderr, and exits 0/);
    expect(file).toMatch(/both route boxes show `routes file error`/);
    expect(readme).toMatch(/^- `DANDELION_ROUTES_FILE` - .*unset or empty\. A relative path is taken from the working directory\.$/m);
    const route = readme.split('## Route')[1].split('## ')[0];
    const tableRows = route.split('\n').filter((line) => /^\| (\d|claude|agy|kimi|grok|cursor|junie|hermes)/.test(line));
    expect(tableRows).toHaveLength(14);
    expect(tableRows.every((row) => /`(route\.[a-z-]+\.(standard|max)|high\.[a-z]+)` \|$/.test(row))).toBe(true);
  });

  it('README documents that the live dashboard fits the terminal', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const commands = readme.split('## Run Commands')[1].split('## ')[0];
    expect(commands).toMatch(/^- `npm start` - .*fits the terminal: the `route` and `route --high` boxes stay at the top, and the provider list scrolls with `↑↓\/jk` so earlier panels, personal `claude` included, stay reachable/m);
  });
});
