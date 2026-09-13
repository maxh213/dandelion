import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { spawnSync } from 'node:child_process';
import type { CommandRunner } from './app/index.ts';

vi.mock('./app/index.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./app/index.ts')>();
  const stubRunner: CommandRunner = {
    run: async () => ({ stdout: 'Balance: $14.15', stderr: '' })
  };
  return { ...original, realCommandRunner: stubRunner };
});

const { main, runIfMain } = await import('./main.ts');

const profileRunner: CommandRunner = {
  run: async () => ({ stdout: 'Name: Max\nBalance: $14.15', stderr: '' })
};

describe('main', () => {
  it('writes the dashboard to the stream', async () => {
    let output = '';
    await main(profileRunner, { NO_COLOR: '1' }, { write: (out: string) => { output += out; } }, '2026-09-13T10:00:00.000Z');
    expect(output).toContain('ALLOWANCE');
    expect(output).toContain('10:00:00Z');
    expect(output).toContain('$14.15');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('runIfMain writes to stdout when invoked as the entry file', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runIfMain('file:///path/to/main.ts', '/path/to/main.ts', profileRunner);
      expect(write).toHaveBeenCalledWith(expect.stringContaining('$14.15'));
    } finally {
      write.mockRestore();
    }
  });

  it('runIfMain does nothing for another entry file', async () => {
    const runner = { run: vi.fn() };
    await runIfMain('file:///path/to/main.ts', 'other.ts', runner);
    await runIfMain('file:///path/to/main.ts', undefined, runner);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('prints a dim unavailable kilo panel with the exact reason when kilo is not on PATH', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: '' };
    delete env.NO_COLOR;
    const result = spawnSync(process.execPath, ['src/main.ts'], { env, encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ALLOWANCE');
    expect(result.stdout).toContain('\x1b[90m' + '━'.repeat(72) + '\nkilo\nkilo CLI not found in PATH\n');
    expect(result.stdout).not.toContain('Command failed');
  });

  it('README is updated with project details', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme).toContain('Allowance');
    expect(readme).toContain('npm start');
    expect(readme).toContain('ALLOWANCE_KILO_REFERENCE');
  });
});
