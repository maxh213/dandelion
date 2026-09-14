import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProbeIo } from './app/index.ts';

const MAIN_URL = new URL('./main.ts', import.meta.url).href;
const MAIN = fileURLToPath(MAIN_URL);

vi.mock('./app/index.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./app/index.ts')>();
  const stubIo: ProbeIo = {
    runner: { run: async () => ({ stdout: 'Balance: $14.15', stderr: '' }) },
    launcher: { launch: async () => undefined },
    fetcher: { get: async () => ({ failure: 'network' }), post: async () => ({ failure: 'network' }) },
    reader: { homeDir: () => '/nowhere', read: async () => undefined, isDirectory: async () => false },
    spawner: { spawn: () => { throw new Error('codex app-server is never started'); } }
  };
  return { ...original, realIo: stubIo, runRoute: vi.fn(original.runRoute) };
});

const { main, runIfMain } = await import('./main.ts');
const { runRoute } = await import('./app/index.ts');

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

function procOf(argv: string[], stdinTTY: boolean | undefined, stdoutTTY: boolean | undefined) {
  const writes: string[] = [];
  const keyboard = Object.assign(new EventEmitter(), { setRawMode: vi.fn(), setEncoding: vi.fn(), pause: vi.fn(), isTTY: stdinTTY });
  const stdout = { isTTY: stdoutTTY, write: (text: string) => writes.push(text) };
  const proc = { argv, env: { NO_COLOR: '1' }, stdin: keyboard, stdout, exit: vi.fn() };
  return { proc, keyboard, output: () => writes.join('') };
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
    Object.assign(env, { DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'no-cursor-auth.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: dir, DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json') }, extraEnv);
    return spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf-8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('main', () => {
  it('prints the kilo panel with a 14 of 20 gauge from a fixture kilo on PATH', () => {
    const result = runWithFixtureKilo({});
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('\x1b[1mDANDELION ')).toBe(true);
    expect(result.stdout).toMatch(/^\S+DANDELION +\d{2}:\d{2}:\d{2}Z\S+\n/);
    expect(result.stdout).toContain('\x1b[90m' + '━'.repeat(72) + '\x1b[0m\nkilo\n$14.15 ' + '█'.repeat(14) + '░'.repeat(6) + ' '.repeat(45) + '\n\x1b[90mapi balance · kilo\x1b[0m');
    expect(result.stdout).not.toContain('not found');
  });

  it('fills the gauge from a fixture kilo when DANDELION_KILO_REFERENCE is 10', () => {
    const result = runWithFixtureKilo({ DANDELION_KILO_REFERENCE: '10', NO_COLOR: '1' });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('\x1b[');
    expect(result.stdout).toContain('='.repeat(72) + '\nkilo\n$14.15 ' + '#'.repeat(20) + ' '.repeat(45) + '\n');
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
    expect(lines).toContain('Claude and GPT models · Five Hour…  ###############-----  75%');
    expect(lines).toContain('claude · personal · claude');
    expect(lines).toContain('agy · agy');
    expect(result.stdout).toContain('\nkimi\nkimi web exited without printing a token\nkimi code · kimi\n');
    expect(result.stdout).toContain('\ncodex\ncodex is not logged in\ncodex · codex\n');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  it('writes the dashboard to the stream', async () => {
    let output = '';
    await main(profileIo, { NO_COLOR: '1' }, { write: (out: string) => { output += out; } }, '2026-09-13T10:00:00.000Z');
    expect(output).toContain('DANDELION');
    expect(output).toContain('10:00:00Z');
    expect(output).toContain('$14.15');
    expect(output.endsWith('\n')).toBe(true);
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
    expect(output()).toMatch(/^DANDELION +\d{2}:\d{2}:\d{2}Z\n/);
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
      expect(output()).toMatch(/^DANDELION +\d{2}:\d{2}:\d{2}Z\n/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect(output()).toBe('claude-opus-5 high\n');
    expect(keyboard.setRawMode).not.toHaveBeenCalled();
    expect(proc.exit).not.toHaveBeenCalled();
    const [io, env, now, zone] = vi.mocked(runRoute).mock.calls[0];
    expect([io, env, zone]).toEqual([routeIo, proc.env, Intl.DateTimeFormat().resolvedOptions().timeZone]);
    expect(now >= before && now <= after).toBe(true);
  });

  it('runIfMain route prints none and exits 1 when nothing routes', async () => {
    const { proc, output } = procOf(['node', MAIN, 'route'], undefined, undefined);
    await runIfMain(MAIN_URL, MAIN, profileIo, proc);
    expect(output()).toBe('none\n');
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it.each([[['--once', 'route']], [['routes']]])('runIfMain keeps the dashboard for %j', async (args) => {
    vi.mocked(runRoute).mockClear();
    const { proc, output } = procOf(['node', MAIN, ...args], true, false);
    await runIfMain(MAIN_URL, MAIN, profileIo, proc);
    expect(output()).toMatch(/^DANDELION +\d{2}:\d{2}:\d{2}Z\n/);
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
      const env: NodeJS.ProcessEnv = { HOME: dir, PATH: dir, DANDELION_KIMI_PORT: '1', DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'missing.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: join(dir, 'missing'), DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json') };
      const routed = spawnSync(process.execPath, ['src/main.ts', 'route'], { env, encoding: 'utf-8', timeout: 60000 });
      expect([routed.stdout, routed.stderr, routed.status]).toEqual(['claude-opus-5 high\n', '', 0]);
      rmSync(join(dir, 'claude'));
      const none = spawnSync(process.execPath, ['src/main.ts', 'route'], { env, encoding: 'utf-8', timeout: 60000 });
      expect([none.stdout, none.stderr, none.status]).toEqual(['none\n', '', 1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect([pkg.name, pkg.bin, pkg.dependencies]).toEqual(['dandelion', { dandelion: 'src/main.ts' }, undefined]);
    expect(readFileSync(MAIN, 'utf-8').split('\n')[0]).toBe('#!/usr/bin/env node');
    const index = spawnSync('git', ['ls-files', '-s', '--', ':/src/main.ts'], { encoding: 'utf-8' });
    expect(index.stdout).toMatch(/^100755 /);
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
      const env: NodeJS.ProcessEnv = { HOME: dir, PATH: dir, NO_COLOR: '1', DANDELION_KIMI_PORT: '1', DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'missing.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: dir, DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json') };
      const runs = ['src/main.ts', join(dir, 'dandelion')].map((entry) => spawnSync(process.execPath, [entry, '--once'], { env, encoding: 'utf-8', timeout: 60000 }));
      const panelOrder = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];
      for (const run of runs) {
        expect(run.status).toBe(0);
        const lines = run.stdout.split('\n');
        expect(lines[0]).toMatch(/^DANDELION +\d{2}:\d{2}:\d{2}Z$/);
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
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: dir, NO_COLOR: '1', DANDELION_GROK_HOME: dir, DANDELION_CURSOR_AUTH_FILE: join(dir, 'no-cursor-auth.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: dir, DANDELION_STATE_FILE: join(dir, 'state', 'eligibility.json') };
      const result = spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf-8', timeout: 60000 });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/\ngrok\n[^]*\ncodex\napi-key billing · no usage windows\ncodex · codex\n[^]*\ncursor\n[^]*\nkilo\n/);
      expect(JSON.parse(readFileSync('package.json', 'utf-8')).dependencies).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints eight dim unavailable panels in order when no CLI is on PATH, grok home is empty and cursor auth is missing', () => {
    const grokHome = mkdtempSync(join(tmpdir(), 'dandelion-grok-'));
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: '', DANDELION_GROK_HOME: grokHome, DANDELION_CURSOR_AUTH_FILE: join(grokHome, 'missing.json'), DANDELION_CLAUDE_WORK_CONFIG_DIR: grokHome, DANDELION_STATE_FILE: join(grokHome, 'state', 'eligibility.json') };
    delete env.NO_COLOR;
    const result = spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf-8' });
    rmSync(grokHome, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('DANDELION');
    const panels = [
      ['claude', 'claude CLI not found in PATH', 'claude · personal · claude'],
      ['claude-work', 'claude CLI not found in PATH', 'claude · work · claude-work'],
      ['agy', 'agy CLI not found in PATH', 'agy · agy'],
      ['kimi', 'kimi CLI not found in PATH', 'kimi code · kimi'],
      ['grok', 'no grok billing snapshot — run grok once', 'grok · grok'],
      ['codex', 'codex CLI not found in PATH', 'codex · codex'],
      ['cursor', 'no cursor auth — run cursor-agent login', 'cursor · cursor'],
      ['kilo', 'kilo CLI not found in PATH', 'api balance · kilo']
    ].map((lines) => `\x1b[90m${'━'.repeat(72)}\n${lines.join('\n')}\x1b[0m`);
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
    expect(readme).toContain('subscription usage windows for `claude`, `agy`, `kimi`, `grok`, `codex` and `cursor`, and the API balance for `kilo`');
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

  it('README documents the work claude account', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const providers = readme.split('\n').filter((line) => /^- `(claude|claude-work|agy)` /.test(line));
    expect(providers.map((line) => line.split('`')[1])).toEqual(['claude', 'claude-work', 'agy']);
    expect(providers[0]).toContain('(claude · personal)');
    expect(providers[1]).toContain('(claude · work)');
    expect(providers[1]).toContain('same command with `CLAUDE_CONFIG_DIR` set to the work config dir');
    expect(providers[1]).toContain('Without that dir it is unavailable');
    expect(readme).toContain('All eight probes run in parallel');
    expect(readme).not.toContain('All seven probes run in parallel');
    expect(readme).toMatch(/^- `DANDELION_CLAUDE_WORK_CONFIG_DIR` - .*Defaults to `~\/\.claude-work`/m);
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
    for (const row of [
      '| claude | `claude-opus-5 high` | `claude-opus-5 max` |',
      '| claude-work | `claude-opus-5 high` | `claude-opus-5 max` |',
      '| agy | `gemini-3.1-pro-high medium` | `gemini-3.1-pro-high high` |',
      '| kimi | `kimi-code/kimi-for-coding-highspeed` | `kimi-code/kimi-for-coding-highspeed` |',
      '| grok | `grok-4.6` | `grok-4.6` |',
      '| cursor | `kimi-k3-max` | `kimi-k3-max` |'
    ]) expect(route).toContain(row);
  });

  it('README documents route eligibility', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const commands = readme.split('## Run Commands')[1].split('## ')[0];
    expect(commands).toMatch(/^- `npm start` - .*`↑↓\/jk select`.*`space routing on\/off`/m);
    const route = readme.split('## Route')[1].split('## ')[0];
    const paragraphs = route.split('\n\n').filter((paragraph) => paragraph.includes('ineligible'));
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toMatch(/dropped before both rules.*press space.*cannot be toggled.*state file/);
    expect(readme).toMatch(/^- `DANDELION_STATE_FILE` - .*Defaults to `\$XDG_STATE_HOME\/dandelion\/eligibility\.json`, else `~\/\.local\/state\/dandelion\/eligibility\.json`/m);
  });

  it('README documents live mode', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const commands = readme.split('## Run Commands')[1]?.split('## ')[0] ?? '';
    expect(commands).toMatch(/^- `npm start` - .*live dashboard.*`r` refresh.*`q` quit.*`\?` help/m);
    expect(commands).toMatch(/^- `npm start -- --once` - Run the dashboard once and exit$/m);
    expect(commands).toContain('runs once when stdout or stdin is not a terminal');
    expect(readme).toMatch(/^- `DANDELION_REFRESH_SECONDS` - .*Defaults to `300`/m);
  });
});
