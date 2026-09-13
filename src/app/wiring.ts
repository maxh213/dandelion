import { execFile, ExecException } from 'child_process';
import { probeKilo, type CommandRunner, type CommandRunnerResult } from '../probes/kilo.ts';
import { renderDashboard } from '../render/terminal.ts';

function getExecErrorCode(error: ExecException): number {
  return typeof error.code === 'number' ? error.code : 1;
}

function isExecTimeout(error: ExecException): boolean {
  if (!error.killed) return false;
  return error.signal === 'SIGTERM';
}

function handleExecResult(error: ExecException | null, stdout: string | Buffer, stderr: string | Buffer): CommandRunnerResult {
  const err = error || undefined;
  return {
    code: err ? getExecErrorCode(err) : 0,
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    timedOut: err ? isExecTimeout(err) : false,
    error: err
  };
}

export class RealCommandRunner implements CommandRunner {
  run(command: string, args: string[], timeoutMs: number): Promise<CommandRunnerResult> {
    return new Promise((resolve) => {
      execFile(command, args, { timeout: timeoutMs }, (error: ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        resolve(handleExecResult(error, stdout, stderr));
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
