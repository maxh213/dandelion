import type { ProviderUsage, UsageWindow } from '../domain/index.ts';

export type LaunchedProcess = {
  output(): Promise<string>;
  hasExited(): boolean;
  stop(): Promise<void>;
};

export interface Launcher {
  launch(command: string, args: string[]): Promise<LaunchedProcess | undefined>;
}

export type FetchOutcome = { status: number; body: string } | { failure: 'network' | 'timeout' };

export interface Fetcher {
  get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<FetchOutcome>;
}

export type KimiIo = { launcher: Launcher; fetcher: Fetcher };

const DEFAULT_PORT = 59177;
const MAX_PORT = 65535;
const POLL_MS = 500;
const TOKEN_WAIT_MS = 20000;
const REQUEST_TIMEOUT_MS = 10000;
const TOKEN = /token=([A-Za-z0-9._-]+)|Bearer ([A-Za-z0-9._-]+)/;
const DIGITS = /^\d+$/;
const DATE_BEFORE_TIME = /\d-\d{2}-\d{2}T/;
const PARSE_FAILURE = 'Could not parse usage from response';
const FETCH_FAILURES = {
  network: 'kimi usage request failed',
  timeout: `kimi usage request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
};

class KimiUnavailable extends Error {}

function isDefaultPort(raw: string | undefined): raw is undefined | '' {
  return raw === undefined || raw === '';
}

function isValidPort(raw: string): boolean {
  return DIGITS.test(raw) && Number(raw) >= 1 && Number(raw) <= MAX_PORT;
}

function parsePort(raw: string | undefined): number {
  if (isDefaultPort(raw)) return DEFAULT_PORT;
  if (!isValidPort(raw)) throw new KimiUnavailable(`ALLOWANCE_KIMI_PORT must be an integer from 1 to ${MAX_PORT}`);
  return Number(raw);
}

function findToken(log: string): string | undefined {
  const match = TOKEN.exec(log);
  return match?.[1] ?? match?.[2];
}

function tokenFailure(exited: boolean, waitedMs: number): string | undefined {
  if (exited) return 'kimi web exited without printing a token';
  if (waitedMs >= TOKEN_WAIT_MS) return `kimi web printed no token within ${TOKEN_WAIT_MS / 1000}s`;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForToken(child: LaunchedProcess, waitedMs: number): Promise<string> {
  const exited = child.hasExited();
  const token = findToken(await child.output());
  if (token !== undefined) return token;
  const failure = tokenFailure(exited, waitedMs);
  if (failure !== undefined) throw new KimiUnavailable(failure);
  await sleep(POLL_MS);
  return waitForToken(child, waitedMs + POLL_MS);
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

async function requestUsage(fetcher: Fetcher, port: number, token: string): Promise<string> {
  const url = `http://127.0.0.1:${port}/api/v1/oauth/usage`;
  const outcome = await fetcher.get(url, { Authorization: `Bearer ${token}` }, REQUEST_TIMEOUT_MS);
  if ('failure' in outcome) throw new KimiUnavailable(FETCH_FAILURES[outcome.failure]);
  if (!isSuccess(outcome.status)) throw new KimiUnavailable(`kimi usage request failed: HTTP ${outcome.status}`);
  return outcome.body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function percentOf(entry: unknown): number | undefined {
  const used = fieldOf(entry, 'used');
  const limit = fieldOf(entry, 'limit');
  if (!isCount(used) || !isCount(limit) || limit === 0) return undefined;
  return Math.round((used * 100) / limit);
}

function instantOf(value: unknown): string | undefined {
  return typeof value === 'string' && DATE_BEFORE_TIME.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function weeklyWindow(summary: unknown): UsageWindow {
  const usedPct = percentOf(summary);
  if (usedPct === undefined) throw new KimiUnavailable(PARSE_FAILURE);
  const resetsAt = instantOf(fieldOf(summary, 'reset_at'));
  return resetsAt === undefined ? { label: 'weekly', usedPct } : { label: 'weekly', usedPct, resetsAt };
}

function hourWindow(entry: unknown): UsageWindow[] {
  const hourly = fieldOf(fieldOf(entry, 'window'), 'unit') === 'hour';
  const usedPct = hourly ? percentOf(entry) : undefined;
  return usedPct === undefined ? [] : [{ label: '5h', usedPct }];
}

function hourWindows(limits: unknown): UsageWindow[] {
  return Array.isArray(limits) ? limits.flatMap(hourWindow) : [];
}

function parseUsage(body: string): UsageWindow[] {
  const data = fieldOf(JSON.parse(body), 'data');
  return [weeklyWindow(fieldOf(data, 'summary')), ...hourWindows(fieldOf(data, 'limits'))];
}

async function readKimi(io: KimiIo, env: Record<string, string | undefined>): Promise<UsageWindow[]> {
  const port = parsePort(env['ALLOWANCE_KIMI_PORT']);
  const child = await io.launcher.launch('kimi', ['web', '--no-open', '--port', String(port)]);
  if (child === undefined) throw new KimiUnavailable('kimi CLI not found in PATH');
  try {
    return parseUsage(await requestUsage(io.fetcher, port, await waitForToken(child, 0)));
  } finally {
    await child.stop();
  }
}

function reasonOf(error: unknown): string {
  return error instanceof KimiUnavailable ? error.message : PARSE_FAILURE;
}

export async function probeKimi(io: KimiIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage> {
  const usage = { id: 'kimi', displayName: 'kimi', planLabel: 'kimi code', fetchedAt: now };
  try {
    return { ...usage, windows: await readKimi(io, env), status: 'ok' };
  } catch (error) {
    return { ...usage, windows: [], status: 'unavailable', reason: reasonOf(error) };
  }
}
