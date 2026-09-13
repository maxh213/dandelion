import { describe, it, expect } from 'vitest';
import { runApp, RealCommandRunner } from './wiring.ts';
import type { CommandRunner, CommandRunnerResult } from '../probes/kilo.ts';

class MockRunner implements CommandRunner {
  result: CommandRunnerResult;
  constructor(result: CommandRunnerResult) { this.result = result; }
  async run() {
    return this.result;
  }
}

describe('wiring', () => {
  it('runs app and renders dashboard', async () => {
    const runner = new MockRunner({ code: 0, stdout: 'Name: Max\nBalance: $14.15', stderr: '', timedOut: false });
    const output = await runApp(runner, { NO_COLOR: '1' }, '10:00:00Z');
    expect(output).toContain('ALLOWANCE');
    expect(output).toContain('kilo');
    expect(output).toContain('##############------');
  });

  it('runs app with unavailable probe', async () => {
    const runner = new MockRunner({ code: 1, stdout: '', stderr: '', timedOut: false, error: new Error('ENOENT') });
    const output = await runApp(runner, { NO_COLOR: '1' }, '10:00:00Z');
    expect(output).toContain('kilo CLI not found in PATH');
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
  });
});
