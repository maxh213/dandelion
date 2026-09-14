import { execFile, spawn, type ChildProcess, type ChildProcessByStdio, type ExecException } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough, pipeline, type Readable, type Writable } from 'node:stream';
import {
  providerProbes,
  type CommandRunner,
  type CommandRunnerResult,
  type Fetcher,
  type FileReader,
  type LaunchedProcess,
  type Launcher,
  type ProbeIo,
  type RpcChild,
  type RpcSpawner,
  type RunFailure
} from '../probes/index.ts';
import { renderDashboard } from '../render/index.ts';
import { startLive, type Keyboard, type Screen } from './live.ts';

export type { ProbeIo } from '../probes/index.ts';
export type { Keyboard, Screen } from './live.ts';

type Stop = () => Promise<void>;

const KILL_GRACE_MS = 5000;
const liveStops = new Set<Stop>();
const registry: { closed?: boolean } = {};

function tracked(stop: Stop): Stop {
  const untracked: Stop = () => {
    liveStops.delete(untracked);
    return stop();
  };
  liveStops.add(untracked);
  if (registry.closed) void untracked();
  return untracked;
}

async function stopChildren(): Promise<void> {
  registry.closed = true;
  await Promise.all([...liveStops].map((stop) => stop()));
}

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

const realCommandRunner: CommandRunner = {
  run(command, args, timeoutMs) {
    return new Promise((resolve) => {
      const child = execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
        liveStops.delete(stop);
        resolve(toRunnerResult(error, stdout, stderr));
      });
      const exited = exitOf(child);
      const stop = tracked(() => signalUntil(child, exited));
    });
  }
};

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function exitOf(child: ChildProcess): Promise<unknown> {
  return once(child, 'exit').catch(() => undefined);
}

async function signalUntil(child: ChildProcess, exited: Promise<unknown>): Promise<void> {
  const escalation = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
  child.kill('SIGTERM');
  await exited;
  clearTimeout(escalation);
}

function terminate(child: ChildProcess): Promise<void> {
  return hasExited(child) ? Promise.resolve() : signalUntil(child, exitOf(child));
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
    stop: tracked(async () => {
      await terminate(child);
      removeLogDir(logDir);
    })
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
    const launched = launchedProcess(child, logDir);
    return new Promise((resolve) => {
      child.once('spawn', () => resolve(launched));
      child.on('error', () => {
        removeLogDir(logDir);
        resolve(undefined);
      });
    });
  }
};

function rpcChild(child: ChildProcessByStdio<Writable, Readable, null>): RpcChild {
  const exited = exitOf(child);
  const input = new PassThrough();
  pipeline(input, child.stdin, () => undefined);
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  return {
    lines: { [Symbol.asyncIterator]: () => lines },
    send: (message) => input.write(`${message}\n`),
    stop: tracked(async () => {
      if (!hasExited(child)) await signalUntil(child, exited);
    })
  };
}

const realSpawner: RpcSpawner = {
  spawn: (command, args) => rpcChild(spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] }))
};

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

async function fetchWithin(url: string, init: RequestInit, timeoutMs: number): ReturnType<Fetcher['get']> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { failure: isTimeout(error) ? 'timeout' : 'network' };
  }
}

const realFetcher: Fetcher = {
  get: (url, headers, timeoutMs) => fetchWithin(url, { headers }, timeoutMs),
  post: (url, headers, body, timeoutMs) => fetchWithin(url, { method: 'POST', headers, body }, timeoutMs)
};

const realReader: FileReader = {
  homeDir: homedir,
  read: (path) => readFile(path, 'utf8').catch(() => undefined)
};

export const realIo: ProbeIo = { runner: realCommandRunner, launcher: realLauncher, fetcher: realFetcher, reader: realReader, spawner: realSpawner };

export async function runApp(io: ProbeIo, env: Record<string, string | undefined>, now: string): Promise<string> {
  const usages = await Promise.all(providerProbes(io, env).map(({ probe }) => probe(now)));
  const noColor = env['NO_COLOR'] !== undefined;
  return renderDashboard(usages, noColor, now);
}

export function runLive(io: ProbeIo, env: Record<string, string | undefined>, keyboard: Keyboard, screen: Screen): Promise<void> {
  registry.closed = false;
  return startLive({ probes: providerProbes(io, env), env, keyboard, screen, stopChildren });
}
