import { execFile, type ExecException } from 'node:child_process';
import {
  probeProviders,
  type CommandRunner,
  type CommandRunnerResult,
  type RunFailure
} from '../probes/index.ts';
import { renderDashboard } from '../render/index.ts';

export type { CommandRunner } from '../probes/index.ts';

function wasKilledByTimeout(error: ExecException): boolean {
  return error.killed === true && error.signal === 'SIGTERM';
}

function failureOf(error: ExecException): RunFailure {
  if (error.code === 'ENOENT') return 'missing';
  if (wasKilledByTimeout(error)) return 'timeout';
  return 'exit';
}

function toRunnerResult(error: ExecException | null, stdout: string, stderr: string): CommandRunnerResult {
  if (!error) return { stdout, stderr };
  return { stdout, stderr, failure: failureOf(error) };
}

export const realCommandRunner: CommandRunner = {
  run(command, args, timeoutMs) {
    return new Promise((resolve) => {
      execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
        resolve(toRunnerResult(error, stdout, stderr));
      });
    });
  }
};

export async function runApp(
  runner: CommandRunner,
  env: Record<string, string | undefined>,
  now: string
): Promise<string> {
  const usages = await probeProviders(runner, now, env);
  const noColor = env['NO_COLOR'] !== undefined;
  return renderDashboard(usages, noColor, now);
}
