import { fieldOf, isCount, isRecord, type ProviderUsage, type UsageWindow } from '../domain/index.ts';
import type { CommandRunner, CommandRunnerResult, RunFailure } from './cli.ts';

export type RpcChild = {
  lines: AsyncIterable<string>;
  send(message: string): void;
  stop(): Promise<void>;
};

export interface RpcSpawner {
  spawn(command: string, args: string[]): RpcChild;
}

export type CodexIo = { runner: CommandRunner; spawner: RpcSpawner };

type Deadline = { expired: Promise<never>; cancel(): void };

const LOGIN_TIMEOUT_MS = 15000;
const ANSWER_TIMEOUT_MS = 30000;
const ANSWER_ID = 2;
const API_KEY_LINE = /^Logged in using an API key/m;
const CHATGPT_LINE = /ChatGPT/;
const API_KEY_NOTE = 'api-key billing · no usage windows';
const PARSE_FAILURE = 'Could not parse rate limits from response';
const LOGIN_FAILURES: Record<RunFailure, string> = {
  missing: 'codex CLI not found in PATH',
  timeout: `Command timed out after ${LOGIN_TIMEOUT_MS / 1000}s`,
  exit: 'codex is not logged in'
};
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

function resetInstant(seconds: unknown): string | undefined {
  if (typeof seconds !== 'number') return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function windowOf(limits: unknown, name: string): UsageWindow[] {
  const entry = fieldOf(limits, name);
  const usedPercent = fieldOf(entry, 'usedPercent');
  if (!isCount(usedPercent)) return [];
  const window = { label: labelOf(fieldOf(entry, 'windowDurationMins'), name), usedPct: Math.round(usedPercent) };
  const resetsAt = resetInstant(fieldOf(entry, 'resetsAt'));
  return [resetsAt === undefined ? window : { ...window, resetsAt }];
}

function errorMessage(error: unknown): string {
  const message = fieldOf(error, 'message');
  return typeof message === 'string' && message !== '' ? message : 'codex app-server error';
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
    const message: unknown = JSON.parse(line);
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

async function readRateLimits(spawner: RpcSpawner): Promise<UsageWindow[]> {
  const child = spawner.spawn('codex', ['app-server']);
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

async function rateLimitUsage(spawner: RpcSpawner, usage: CodexIdentity): Promise<ProviderUsage> {
  try {
    return { ...usage, windows: await readRateLimits(spawner), status: 'ok' };
  } catch (error) {
    return { ...usage, windows: [], status: 'error', reason: reasonOf(error) };
  }
}

export async function probeCodex(io: CodexIo, now: string): Promise<ProviderUsage> {
  const usage = { id: 'codex', displayName: 'codex', planLabel: 'codex', fetchedAt: now };
  const login = await io.runner.run('codex', ['login', 'status'], LOGIN_TIMEOUT_MS);
  const mode = loginMode(login);
  if (mode === 'apikey') return { ...usage, windows: [], status: 'ok', note: API_KEY_NOTE };
  if (mode === 'chatgpt') return rateLimitUsage(io.spawner, usage);
  return { ...usage, windows: [], status: 'unavailable', reason: LOGIN_FAILURES[login.failure ?? 'exit'] };
}
