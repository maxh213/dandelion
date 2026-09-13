import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import type { CommandRunner } from './probes/kilo.ts';

vi.mock('./app/wiring.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./app/wiring.ts')>();
  class StubRunner implements CommandRunner {
    async run() {
      return { code: 0, stdout: 'Balance: $14.15', stderr: '', timedOut: false };
    }
  }
  return { ...original, RealCommandRunner: StubRunner };
});

const { main, runIfMain } = await import('./main.ts');

const profileRunner: CommandRunner = {
  run: async () => ({ code: 0, stdout: 'Name: Max\nBalance: $14.15', stderr: '', timedOut: false })
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

  it('README is updated with project details', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme).toContain('Allowance');
    expect(readme).toContain('npm start');
    expect(readme).toContain('ALLOWANCE_KILO_REFERENCE');
  });
});
