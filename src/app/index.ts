import { execFile, spawn, type ChildProcess, type ExecException } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  probeProviders,
  type CommandRunner,
  type CommandRunnerResult,
  type Fetcher,
  type LaunchedProcess,
  type Launcher,
  type ProbeIo,
  type RunFailure
} from '../probes/index.ts';
import { renderDashboard } from '../render/index.ts';

export type { CommandRunner, ProbeIo } from '../probes/index.ts';

const KILL_GRACE_MS = 5000;

function wasKilledByTimeout(error: ExecException): boolean {
  return error.killed === true;
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

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function terminate(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const escalation = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    child.once('exit', () => {
      clearTimeout(escalation);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function logFileIn(logDir: string): string {
  return join(logDir, 'web.log');
}

function removeLogDir(logDir: string): void {
  rmSync(logDir, { recursive: true, force: true });
}

function readLog(logDir: string): Promise<string> {
  return readFile(logFileIn(logDir), 'utf8').catch(() => '');
}

function launchedProcess(child: ChildProcess, logDir: string): LaunchedProcess {
  return {
    output: () => readLog(logDir),
    hasExited: () => hasExited(child),
    async stop() {
      await terminate(child);
      removeLogDir(logDir);
    }
  };
}

function spawnLoggingTo(logDir: string, command: string, args: string[]): ChildProcess {
  const log = openSync(logFileIn(logDir), 'w');
  const child = spawn(command, args, { stdio: ['ignore', log, log] });
  closeSync(log);
  return child;
}

const realLauncher: Launcher = {
  launch(command, args) {
    const logDir = mkdtempSync(join(tmpdir(), 'allowance-kimi-'));
    const child = spawnLoggingTo(logDir, command, args);
    return new Promise((resolve) => {
      child.once('spawn', () => resolve(launchedProcess(child, logDir)));
      child.on('error', () => {
        removeLogDir(logDir);
        resolve(undefined);
      });
    });
  }
};

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

const realFetcher: Fetcher = {
  async get(url, headers, timeoutMs) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      return { status: response.status, body: await response.text() };
    } catch (error) {
      return { failure: isTimeout(error) ? 'timeout' : 'network' };
    }
  }
};

export const realIo: ProbeIo = { runner: realCommandRunner, launcher: realLauncher, fetcher: realFetcher };

export async function runApp(io: ProbeIo, env: Record<string, string | undefined>, now: string): Promise<string> {
  const usages = await probeProviders(io, env, now);
  const noColor = env['NO_COLOR'] !== undefined;
  return renderDashboard(usages, noColor, now);
}
