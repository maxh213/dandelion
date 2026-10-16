import { fieldOf, isCount, isFilled, isRecord, parseJson, withReset, type FileReader, type ProviderUsage, type UsageWindow, type WindowKind } from '../domain/index.ts';
import type { CommandRunner, CommandRunnerResult, RunFailure } from './cli.ts';

export type RpcChild = {
  lines: AsyncIterable<string>;
  send(message: string): void;
  stop(): Promise<void>;
};

export interface RpcSpawner {
  spawn(command: string, args: string[], env?: Record<string, string>): RpcChild;
}

export type CodexIo = { runner: CommandRunner; spawner: RpcSpawner };

type AnimusIo = CodexIo & { reader: FileReader };

type Account = { id: string; planLabel: string; env?: Record<string, string> };

type Deadline = { expired: Promise<never>; cancel(): void };

const LOGIN_TIMEOUT_MS = 15000;
const PERSONAL: Account = { id: 'codex', planLabel: 'codex' };
const ANIMUS_ID = 'codex-animus';
const ANIMUS_PLAN = 'codex · animus';
const ANIMUS_HOME_VAR = 'DANDELION_CODEX_ANIMUS_HOME';
const ANIMUS_HOME = '.codex-animus';
const NO_ANIMUS_HOME = 'no animus codex home — CODEX_HOME=~/.codex-animus codex login';
const ANSWER_TIMEOUT_MS = 30000;
const ANSWER_ID = 2;
const API_KEY_LINE = /^Logged in using an API key/m;
const CHATGPT_LINE = /ChatGPT/;
const API_KEY_NOTE = 'api-key billing · no usage windows';
const PARSE_FAILURE = 'Could not parse rate limits from response';
const LOGIN_FAILURES = {
  missing: 'codex CLI not found in PATH',
  timeout: `Command timed out after ${LOGIN_TIMEOUT_MS / 1000}s`,
  exit: 'codex is not logged in'
} satisfies Record<RunFailure, string>;
const REQUESTS = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'dandelion', title: null, version: '0.1.0' } } },
  { jsonrpc: '2.0', method: 'initialized' },
  { jsonrpc: '2.0', id: ANSWER_ID, method: 'account/rateLimits/read', params: {} }
];
const MINUTES_PER_WEEK = 10080;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

class CodexFailure extends Error {}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function loginMode(login: CommandRunnerResult): 'apikey' | 'chatgpt' | undefined {
  if (login.failure !== undefined) return undefined;
  const text = `${login.stdout}\n${login.stderr}`;
  if (API_KEY_LINE.test(text)) return 'apikey';
  return CHATGPT_LINE.test(text) ? 'chatgpt' : undefined;
}

function unitOf(minutes: number): [number, string] {
  if (minutes % MINUTES_PER_DAY === 0) return [MINUTES_PER_DAY, 'd'];
  if (minutes % MINUTES_PER_HOUR === 0) return [MINUTES_PER_HOUR, 'h'];
  return [1, 'm'];
}

function labelOf(minutes: unknown, fallback: string): string {
  if (minutes === MINUTES_PER_WEEK) return 'weekly';
  if (!isPositiveInteger(minutes)) return fallback;
  const [size, unit] = unitOf(minutes);
  return `${minutes / size}${unit}`;
}

function kindOf(label: string): WindowKind {
  if (label === 'weekly') return 'weekly';
  return label === '5h' ? 'rolling' : 'other';
}

function resetInstant(seconds: unknown): string | undefined {
  if (typeof seconds !== 'number') return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function windowOf(limits: unknown, name: string): UsageWindow[] {
  const entry = fieldOf(limits, name);
  const usedPercent = fieldOf(entry, 'usedPercent');
  if (!isCount(usedPercent)) return [];
  const label = labelOf(fieldOf(entry, 'windowDurationMins'), name);
  const resetsAt = resetInstant(fieldOf(entry, 'resetsAt'));
  return [withReset({ label, kind: kindOf(label), usedPct: usedPercent }, resetsAt)];
}

function errorMessage(error: unknown): string {
  const message = fieldOf(error, 'message');
  return isFilled(message) ? message : 'codex app-server error';
}

function windowsOf(answer: unknown): UsageWindow[] {
  const error = fieldOf(answer, 'error');
  if (isRecord(error)) throw new CodexFailure(errorMessage(error));
  const limits = fieldOf(fieldOf(answer, 'result'), 'rateLimits');
  const windows = [...windowOf(limits, 'primary'), ...windowOf(limits, 'secondary')];
  if (windows.length === 0) throw new CodexFailure(PARSE_FAILURE);
  return windows;
}

function answerIn(line: string): unknown {
  try {
    const message = parseJson(line);
    return fieldOf(message, 'id') === ANSWER_ID ? message : null;
  } catch {
    return null;
  }
}

async function answerOf(lines: AsyncIterable<string>): Promise<unknown> {
  for await (const line of lines) {
    const answer = answerIn(line);
    if (answer !== null) return answer;
  }
  throw new CodexFailure('codex app-server exited without answering');
}

function startDeadline(): Deadline {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CodexFailure(`codex app-server did not answer within ${ANSWER_TIMEOUT_MS / 1000}s`)), ANSWER_TIMEOUT_MS);
  });
  return { expired, cancel: () => clearTimeout(timer) };
}

async function readRateLimits(spawner: RpcSpawner, env: Record<string, string> | undefined): Promise<UsageWindow[]> {
  const child = spawner.spawn('codex', ['app-server'], env);
  const deadline = startDeadline();
  try {
    REQUESTS.forEach((request) => child.send(JSON.stringify(request)));
    return windowsOf(await Promise.race([answerOf(child.lines), deadline.expired]));
  } finally {
    deadline.cancel();
    await child.stop();
  }
}

function reasonOf(error: unknown): string {
  return error instanceof CodexFailure ? error.message : 'codex app-server failed';
}

type CodexIdentity = Pick<ProviderUsage, 'id' | 'displayName' | 'planLabel' | 'fetchedAt'>;

async function rateLimitUsage(spawner: RpcSpawner, usage: CodexIdentity, env: Record<string, string> | undefined): Promise<ProviderUsage> {
  try {
    return { ...usage, windows: await readRateLimits(spawner, env), status: 'ok' };
  } catch (error) {
    return { ...usage, windows: [], status: 'error', reason: reasonOf(error) };
  }
}

async function probeAccount(io: CodexIo, account: Account, now: string): Promise<ProviderUsage> {
  const usage = { id: account.id, displayName: account.id, planLabel: account.planLabel, fetchedAt: now };
  const login = await io.runner.run('codex', ['login', 'status'], LOGIN_TIMEOUT_MS, account.env);
  const mode = loginMode(login);
  if (mode === 'apikey') return { ...usage, windows: [], status: 'ok', note: API_KEY_NOTE };
  if (mode === 'chatgpt') return rateLimitUsage(io.spawner, usage, account.env);
  return { ...usage, windows: [], status: 'unavailable', reason: LOGIN_FAILURES[login.failure ?? 'exit'] };
}

export function probeCodex(io: CodexIo, now: string): Promise<ProviderUsage> {
  return probeAccount(io, PERSONAL, now);
}

export function animusHome(env: Record<string, string | undefined>, homeDir: string): string {
  return env[ANIMUS_HOME_VAR] || `${homeDir}/${ANIMUS_HOME}`;
}

export async function probeCodexAnimus(io: AnimusIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage> {
  const home = animusHome(env, io.reader.homeDir());
  const identity = { id: ANIMUS_ID, displayName: ANIMUS_ID, planLabel: ANIMUS_PLAN, fetchedAt: now };
  if (!(await io.reader.isDirectory(home))) {
    return { ...identity, windows: [], status: 'unavailable', reason: NO_ANIMUS_HOME, fix: { command: 'codex', args: ['login'], env: { CODEX_HOME: home } } };
  }
  return probeAccount(io, { id: ANIMUS_ID, planLabel: ANIMUS_PLAN, env: { CODEX_HOME: home } }, now);
}
