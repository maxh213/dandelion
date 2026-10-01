import { execFile, spawn, type ChildProcess, type ChildProcessByStdio, type ExecException } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { constants as osConstants, homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough, pipeline, type Readable, type Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  probeClaudeStatus,
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
import {
  openEligibility,
  openHidden,
  openHistory,
  openRoutes,
  openUsageSnapshot,
  renderDashboard,
  renderRoute,
  renderRoutesFault,
  renderSnapshot,
  type Eligibility,
  type Hidden,
  type History,
  type ProviderUsage,
  type RouteOutput,
  type RouteRequest,
  type Snapshot,
  type SnapshotRequest,
  type Routes,
  type RoutesFile,
  type StateFile
} from '../render/index.ts';
import { openClipboard, type CommandTry } from './clipboard.ts';
import { extraArgs, launchOf, type RunSpawner } from './launch.ts';
import { startLive, type Keyboard, type Notifier, type Screen } from './live.ts';

export type { ProbeIo } from '../probes/index.ts';
export type { RouteMode, RouteOutput, RouteRequest } from '../render/index.ts';
export type { Keyboard, Screen } from './live.ts';
export type { RunSpawner } from './launch.ts';

export type JsonOutput = { out: string; err: string };

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
  run(command, args, timeoutMs, env) {
    return new Promise((resolve) => {
      const child = execFile(command, args, { timeout: timeoutMs, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
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
    const logDir = mkdtempSync(join(tmpdir(), 'dandelion-kimi-'));
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
  read: (path) => readFile(path, 'utf8').catch(() => undefined),
  isDirectory: (path) => stat(path).then((info) => info.isDirectory(), () => false)
};

export const realIo: ProbeIo = { runner: realCommandRunner, launcher: realLauncher, fetcher: realFetcher, reader: realReader, spawner: realSpawner };

function realPath(path: string): string | undefined {
  return existsSync(path) ? realpathSync(path) : undefined;
}

export function isEntryFile(moduleUrl: string, argv1: string): boolean {
  return realPath(argv1) === realPath(fileURLToPath(moduleUrl));
}

function probeOnce(io: ProbeIo, env: Record<string, string | undefined>, now: string) {
  return Promise.all(providerProbes(io, env).map(({ probe }) => probe(now)));
}

function readText(path: string): string {
  return String(readFileSync(path));
}

function renameOver(path: string, text: string): boolean {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(temp, text);
    renameSync(temp, path);
    return true;
  } catch {
    rmSync(temp, { force: true });
    return false;
  }
}

function replaceFile(path: string, text: string): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    return false;
  }
  return renameOver(path, text);
}

const realStateFile: StateFile = { read: readText, replace: replaceFile };

function eligibilityOf(io: ProbeIo, env: Record<string, string | undefined>): Eligibility {
  return openEligibility(env, io.reader.homeDir(), realStateFile);
}

function hiddenOf(io: ProbeIo, env: Record<string, string | undefined>): Hidden {
  return openHidden(env, io.reader.homeDir(), realStateFile);
}

function historyOf(io: ProbeIo, env: Record<string, string | undefined>): History {
  return openHistory(env, io.reader.homeDir(), realStateFile);
}

function snapshotOf(io: ProbeIo, env: Record<string, string | undefined>): Snapshot<ProviderUsage> {
  return openUsageSnapshot(env, io.reader.homeDir(), realStateFile);
}

const SHIPPED_ROUTES = fileURLToPath(new URL('../../routes.json', import.meta.url));
const realRoutesFile: RoutesFile = { read: readText };

function routesOf(env: Record<string, string | undefined>): Routes {
  return openRoutes(env, SHIPPED_ROUTES, realRoutesFile);
}

export function routesWarning(env: Record<string, string | undefined>): string {
  const { fault } = routesOf(env);
  return fault === undefined ? '' : renderRoutesFault(fault).err;
}

export async function runApp(io: ProbeIo, env: Record<string, string | undefined>, now: string): Promise<string> {
  const usages = await probeOnce(io, env, now);
  const noColor = env['NO_COLOR'] !== undefined;
  return renderDashboard(usages, noColor, now, eligibilityOf(io, env).ineligible(), processZone());
}

export type CachedRouteRequest = RouteRequest & { maxAge?: number };

function recentUsages(io: ProbeIo, env: Record<string, string | undefined>, request: CachedRouteRequest): ProviderUsage[] | undefined {
  if (request.maxAge === undefined) return undefined;
  const ids = providerProbes(io, env).map(({ id }) => id);
  return snapshotOf(io, env).fresh(ids, request.now, request.maxAge);
}

async function routeUsages(io: ProbeIo, env: Record<string, string | undefined>, request: CachedRouteRequest): Promise<ProviderUsage[]> {
  return recentUsages(io, env, request) ?? (await probeOnce(io, env, request.now));
}

export async function runRoute(io: ProbeIo, env: Record<string, string | undefined>, request: CachedRouteRequest): Promise<RouteOutput> {
  const { lines, fault } = routesOf(env);
  if (fault !== undefined) return renderRoutesFault(fault);
  return renderRoute(lines, await routeUsages(io, env, request), eligibilityOf(io, env).ineligible(), request);
}

export async function runJson(io: ProbeIo, env: Record<string, string | undefined>, request: SnapshotRequest): Promise<JsonOutput> {
  const routes = routesOf(env);
  const usages = await probeOnce(io, env, request.now);
  const err = routes.fault === undefined ? '' : renderRoutesFault(routes.fault).err;
  return { out: `${renderSnapshot(routes, usages, eligibilityOf(io, env).ineligible(), request)}\n`, err };
}

export const realNotifier: Notifier = {
  notify: (text) => execFile('notify-send', ['--app-name=dandelion', 'dandelion', text], () => undefined)
};

function statusOf(code: number | null, signal: NodeJS.Signals | null): number {
  return code ?? 128 + osConstants.signals[signal as NodeJS.Signals];
}

export const realRunSpawner: RunSpawner = {
  spawn({ command, args, env }) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
      child.once('error', () => resolve('missing'));
      child.once('close', (code, signal) => resolve(statusOf(code, signal)));
    });
  }
};

export type RunOutput = { err: string; code: number };

function missingCommand(command: string): RunOutput {
  return { err: `dandelion: ${command}: command not found\n`, code: 127 };
}

export async function runRun(io: ProbeIo, env: Record<string, string | undefined>, request: RouteRequest, args: string[], spawner: RunSpawner): Promise<RunOutput> {
  const routed = await runRoute(io, env, request);
  if (routed.code !== 0) return { err: routed.code === 1 ? 'none\n' : routed.err, code: routed.code };
  const launch = launchOf(routed.out.trimEnd(), extraArgs(args), env, io.reader.homeDir());
  const status = await spawner.spawn(launch);
  return status === 'missing' ? missingCommand(launch.command) : { err: '', code: status };
}

export function processZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const CLIPBOARD_TIMEOUT_MS = 3000;

const realCommandTry: CommandTry = (command, args, input) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], timeout: CLIPBOARD_TIMEOUT_MS });
    const fail = () => resolve(false);
    child.on('error', fail);
    child.on('close', (code) => resolve(code === 0));
    child.stdin.on('error', fail);
    child.stdin.end(input);
  });

export function runLive(
  io: ProbeIo,
  env: Record<string, string | undefined>,
  keyboard: Keyboard,
  screen: Screen,
  clock?: () => string
): Promise<void> {
  registry.closed = false;
  return startLive({
    probes: providerProbes(io, env),
    env,
    keyboard,
    screen,
    stopChildren,
    eligibility: eligibilityOf(io, env),
    hidden: hiddenOf(io, env),
    history: historyOf(io, env),
    snapshot: snapshotOf(io, env),
    routes: routesOf(env),
    zone: processZone(),
    notifier: realNotifier,
    spawner: realRunSpawner,
    statusProbe: () => probeClaudeStatus(io, env),
    clipboard: openClipboard({ tryCommand: realCommandTry, write: screen.write.bind(screen) }),
    clock
  });
}
