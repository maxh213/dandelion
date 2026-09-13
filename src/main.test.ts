import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProbeIo } from './app/index.ts';

vi.mock('./app/index.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./app/index.ts')>();
  const stubIo: ProbeIo = {
    runner: { run: async () => ({ stdout: 'Balance: $14.15', stderr: '' }) },
    launcher: { launch: async () => undefined },
    fetcher: { get: async () => ({ failure: 'network' }) },
    reader: { homeDir: () => '/nowhere', read: async () => undefined }
  };
  return { ...original, realIo: stubIo };
});

const { main, runIfMain } = await import('./main.ts');

const profileIo: ProbeIo = {
  runner: { run: async () => ({ stdout: 'Name: Max\nBalance: $14.15', stderr: '' }) },
  launcher: { launch: async () => undefined },
  fetcher: { get: async () => ({ failure: 'network' }) },
  reader: { homeDir: () => '/nowhere', read: async () => undefined }
};

function writeFixture(dir: string, name: string, body: string): void {
  const script = join(dir, name);
  writeFileSync(script, `#!/bin/sh\n${body}\n`);
  chmodSync(script, 0o755);
}

function runWithFixtureKilo(extraEnv: NodeJS.ProcessEnv) {
  const dir = mkdtempSync(join(tmpdir(), 'allowance-kilo-'));
  try {
    const script = join(dir, 'kilo');
    writeFileSync(script, '#!/bin/sh\n[ "$1" = "profile" ] || exit 2\nprintf "Name: Max\\nEmail: yeti213@googlemail.com\\nTeam: Personal\\nBalance: \\$14.15\\n"\n');
    chmodSync(script, 0o755);
    writeFixture(dir, 'claude', "printf '%s\\n' 'Current week (all models): 86% used'");
    writeFixture(dir, 'agy', "printf 'Claude and GPT models\\tFive Hour Limit Remaining\\t25%%\\tsoon\\n'");
    writeFixture(dir, 'kimi', 'exit 0');
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    delete env.NO_COLOR;
    delete env.ALLOWANCE_KILO_REFERENCE;
    delete env.ALLOWANCE_KIMI_PORT;
    Object.assign(env, { ALLOWANCE_GROK_HOME: dir }, extraEnv);
    return spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf-8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('main', () => {
  it('prints the kilo panel with a 14 of 20 gauge from a fixture kilo on PATH', () => {
    const result = runWithFixtureKilo({});
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('\x1b[1mALLOWANCE ')).toBe(true);
    expect(result.stdout).toMatch(/^\S+ALLOWANCE +\d{2}:\d{2}:\d{2}Z\S+\n/);
    expect(result.stdout).toContain('\x1b[90m' + '━'.repeat(72) + '\x1b[0m\nkilo\n$14.15 ' + '█'.repeat(14) + '░'.repeat(6) + ' '.repeat(45) + '\n\x1b[90mapi balance · kilo\x1b[0m');
    expect(result.stdout).not.toContain('not found');
  });

  it('fills the gauge from a fixture kilo when ALLOWANCE_KILO_REFERENCE is 10', () => {
    const result = runWithFixtureKilo({ ALLOWANCE_KILO_REFERENCE: '10', NO_COLOR: '1' });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('\x1b[');
    expect(result.stdout).toContain('='.repeat(72) + '\nkilo\n$14.15 ' + '#'.repeat(20) + ' '.repeat(45) + '\n');
  });

  it('prints claude, agy, kimi, grok and kilo panels in order from fixture CLIs on PATH', () => {
    const result = runWithFixtureKilo({ NO_COLOR: '1' });
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines.indexOf('claude')).toBeLessThan(lines.indexOf('agy'));
    expect(lines.indexOf('agy')).toBeLessThan(lines.indexOf('kimi'));
    expect(lines.indexOf('kimi')).toBeLessThan(lines.indexOf('grok'));
    expect(lines.indexOf('grok')).toBeLessThan(lines.indexOf('kilo'));
    expect(lines).toContain('weekly                              #################---  86%');
    expect(lines).toContain('Claude and GPT models · Five Hour…  ###############-----  75%');
    expect(lines).toContain('claude code · claude');
    expect(lines).toContain('agy · agy');
    expect(result.stdout).toContain('\nkimi\nkimi web exited without printing a token\nkimi code · kimi\n');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  it('writes the dashboard to the stream', async () => {
    let output = '';
    await main(profileIo, { NO_COLOR: '1' }, { write: (out: string) => { output += out; } }, '2026-09-13T10:00:00.000Z');
    expect(output).toContain('ALLOWANCE');
    expect(output).toContain('10:00:00Z');
    expect(output).toContain('$14.15');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('runIfMain writes to stdout when invoked as the entry file', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runIfMain('file:///path/to/main.ts', '/path/to/main.ts', profileIo);
      expect(write).toHaveBeenCalledWith(expect.stringContaining('$14.15'));
    } finally {
      write.mockRestore();
    }
  });

  it('runIfMain does nothing for another entry file', async () => {
    const io = { runner: { run: vi.fn() }, launcher: { launch: vi.fn() }, fetcher: { get: vi.fn() }, reader: { homeDir: vi.fn(), read: vi.fn() } };
    await runIfMain('file:///path/to/main.ts', 'other.ts', io);
    await runIfMain('file:///path/to/main.ts', undefined, io);
    expect(io.runner.run).not.toHaveBeenCalled();
    expect(io.launcher.launch).not.toHaveBeenCalled();
  });

  it('prints five dim unavailable panels when no CLI is on PATH and grok home is empty', () => {
    const grokHome = mkdtempSync(join(tmpdir(), 'allowance-grok-'));
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: '', ALLOWANCE_GROK_HOME: grokHome };
    delete env.NO_COLOR;
    const result = spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf-8' });
    rmSync(grokHome, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ALLOWANCE');
    expect(result.stdout).toContain('\x1b[90m' + '━'.repeat(72) + '\nclaude\nclaude CLI not found in PATH\nclaude code · claude\x1b[0m\n');
    expect(result.stdout).toContain('\x1b[90m' + '━'.repeat(72) + '\nagy\nagy CLI not found in PATH\nagy · agy\x1b[0m\n');
    expect(result.stdout).toContain('\x1b[90m' + '━'.repeat(72) + '\nkimi\nkimi CLI not found in PATH\nkimi code · kimi\x1b[0m\n');
    expect(result.stdout).toContain('\x1b[90m' + '━'.repeat(72) + '\ngrok\nno grok billing snapshot — run grok once\ngrok · grok\x1b[0m\n');
    expect(result.stdout).toContain('\x1b[90m' + '━'.repeat(72) + '\nkilo\nkilo CLI not found in PATH\n');
    expect(result.stdout).not.toContain('Command failed');
  });

  it('README is updated with project details', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme).toContain('Allowance');
    expect(readme).toContain('npm start');
    expect(readme).toContain('ALLOWANCE_KILO_REFERENCE');
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
    expect(readme).toMatch(/^- `ALLOWANCE_KIMI_PORT` - .*Defaults to `59177`/m);
  });

  it('README documents grok', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme).toContain('subscription usage windows for `claude`, `agy`, `kimi` and `grok`, and the API balance for `kilo`');
    const providers = readme.split('\n').filter((line) => /^- `(claude|agy|kimi|grok|kilo)` /.test(line));
    expect(providers.map((line) => line.split('`')[1])).toEqual(['claude', 'agy', 'kimi', 'grok', 'kilo']);
    const grok = providers[3];
    expect(grok).toContain('newest billing snapshot from `<grok home>/logs/unified.jsonl` without running grok');
    expect(grok).toContain('older than 48h is shown dim as stale');
    expect(readme).toContain('All five probes run in parallel');
    expect(readme).not.toContain('All four probes run in parallel');
    expect(readme).toMatch(/^- `ALLOWANCE_GROK_HOME` - .*Defaults to `~\/\.grok`/m);
  });
});
