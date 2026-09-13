import { describe, it, expect } from 'vitest';
import { runApp, RealCommandRunner } from './wiring.ts';
import type { CommandRunner, CommandRunnerResult } from '../probes/kilo.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const PROFILE = 'Name: Max\nEmail: yeti213@googlemail.com\nTeam: Personal\nBalance: $14.15\n';

class MockRunner implements CommandRunner {
  result: CommandRunnerResult;
  constructor(result: CommandRunnerResult) { this.result = result; }
  async run() {
    return this.result;
  }
}

function profileRunner(stdout: string): MockRunner {
  return new MockRunner({ code: 0, stdout, stderr: '', timedOut: false });
}

function visibleLines(output: string): string[] {
  return ['\x1b[1m', '\x1b[90m', '\x1b[0m']
    .reduce((text, code) => text.replaceAll(code, ''), output)
    .split('\n');
}

describe('wiring', () => {
  it('displays kilo balance with default reference', async () => {
    const output = await runApp(profileRunner(PROFILE), {}, NOW);
    expect(output).toContain('ALLOWANCE');
    expect(output).toContain('10:00:00Z');
    expect(output).toContain('━'.repeat(72));
    expect(output).toContain('$14.15 ██████████████░░░░░░');
    expect(output).toContain('\x1b[90mapi balance · kilo\x1b[0m');
  });

  it('rounds gauge fill half-up', async () => {
    const output = await runApp(profileRunner('Balance: $14.50'), {}, NOW);
    expect(output).toContain('$14.50 ███████████████░░░░░ ');
  });

  it('fills the gauge when balance exceeds reference', async () => {
    const output = await runApp(profileRunner('Balance: $25.00'), {}, NOW);
    expect(output).toContain('$25.00 ████████████████████ ');
  });

  it('renders an empty gauge when reference is empty', async () => {
    const output = await runApp(profileRunner('Balance: $14.15'), { ALLOWANCE_KILO_REFERENCE: '' }, NOW);
    expect(output).toContain('$14.15 ░░░░░░░░░░░░░░░░░░░░');
  });

  it('uses a custom reference', async () => {
    const output = await runApp(profileRunner('Balance: $5.00'), { ALLOWANCE_KILO_REFERENCE: '10' }, NOW);
    expect(output).toContain('$5.00 ██████████░░░░░░░░░░');
  });

  it('degrades to ASCII when NO_COLOR is set', async () => {
    const output = await runApp(profileRunner('Balance: $14.15'), { NO_COLOR: '1' }, NOW);
    expect(output).toContain('$14.15 ##############------');
    expect(output).not.toContain('\x1b[');
  });

  it('keeps every line within 72 columns', async () => {
    const lines = [
      ...visibleLines(await runApp(profileRunner(PROFILE), {}, NOW)),
      ...visibleLines(await runApp(profileRunner(PROFILE), { NO_COLOR: '1' }, NOW))
    ];
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  it('renders a dim unavailable panel when kilo is missing', async () => {
    const runner = new MockRunner({ code: 1, stdout: '', stderr: '', timedOut: false, error: new Error('spawn kilo ENOENT') });
    const output = await runApp(runner, {}, NOW);
    expect(output).toContain('ALLOWANCE');
    expect(output).toContain('\x1b[90m' + '━'.repeat(72) + '\nkilo\nkilo CLI not found in PATH');
  });

  it('renders a dim unavailable panel for unparseable output', async () => {
    const output = await runApp(profileRunner('Name: Max\nEmail: yeti213@googlemail.com\nTeam: Personal\n'), {}, NOW);
    expect(output).toContain('\x1b[90m');
    expect(output).toContain('Could not parse balance from output');
    expect(output).not.toContain('█');
  });

  it('renders a dim unavailable panel when kilo times out', async () => {
    const runner = new MockRunner({ code: 1, stdout: '', stderr: '', timedOut: true, error: new Error('killed') });
    const output = await runApp(runner, {}, NOW);
    expect(output).toContain('Command timed out after 20s');
  });

  it('renders a dim unavailable panel when kilo exits with an error', async () => {
    const runner = new MockRunner({ code: 1, stdout: '', stderr: '', timedOut: false, error: new Error('Command failed') });
    const output = await runApp(runner, {}, NOW);
    expect(output).toContain('Command failed or timed out');
  });

  it('probes kilo profile with a 20 second timeout', async () => {
    const calls: [string, string[], number][] = [];
    const runner: CommandRunner = {
      run: async (command, args, timeoutMs) => {
        calls.push([command, args, timeoutMs]);
        return { code: 0, stdout: PROFILE, stderr: '', timedOut: false };
      }
    };
    await runApp(runner, {}, NOW);
    expect(calls).toEqual([['kilo', ['profile'], 20000]]);
  });

  it('RealCommandRunner executes commands successfully', async () => {
    const runner = new RealCommandRunner();
    const result = await runner.run('node', ['-e', 'console.log("hello")'], 2000);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.timedOut).toBe(false);
  });

  it('RealCommandRunner handles ENOENT', async () => {
    const runner = new RealCommandRunner();
    const result = await runner.run('thiscommanddoesnotexist', [], 2000);
    expect(result.code).toBe(1);
    expect(result.error?.message).toContain('ENOENT');
  });

  it('RealCommandRunner handles timeout', async () => {
    const runner = new RealCommandRunner();
    const result = await runner.run('node', ['-e', 'setTimeout(() => {}, 5000)'], 100);
    expect(result.timedOut).toBe(true);
  });

  it('RealCommandRunner handles error with number code', async () => {
    const runner = new RealCommandRunner();
    const result = await runner.run('node', ['-e', 'process.exit(2)'], 2000);
    expect(result.code).toBe(2);
    expect(result.timedOut).toBe(false);
  });
});
