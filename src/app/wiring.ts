import { execFile, type ExecException } from 'node:child_process';
import { probeKilo, type CommandRunner, type CommandRunnerResult } from '../probes/kilo.ts';
import { renderDashboard } from '../render/terminal.ts';

function exitCode(error: ExecException): number {
  return typeof error.code === 'number' ? error.code : 1;
}

function wasKilledByTimeout(error: ExecException): boolean {
  return error.killed === true && error.signal === 'SIGTERM';
}

function toRunnerResult(error: ExecException | null, stdout: string, stderr: string): CommandRunnerResult {
  if (!error) return { code: 0, stdout, stderr, timedOut: false, error: undefined };
  return { code: exitCode(error), stdout, stderr, timedOut: wasKilledByTimeout(error), error };
}

export class RealCommandRunner implements CommandRunner {
  run(command: string, args: string[], timeoutMs: number): Promise<CommandRunnerResult> {
    return new Promise((resolve) => {
      execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
        resolve(toRunnerResult(error, stdout, stderr));
      });
    });
  }
}

export async function runApp(
  runner: CommandRunner,
  env: Record<string, string | undefined>,
  now: string
): Promise<string> {
  const kiloUsage = await probeKilo(runner, now, env);
  const noColor = env['NO_COLOR'] !== undefined;
  return renderDashboard([kiloUsage], noColor, now);
}
