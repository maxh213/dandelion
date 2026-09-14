import { fieldOf, isCount, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

type PostOutcome = { status: number; body: string } | { failure: 'network' | 'timeout' };

export interface PostFetcher {
  post(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<PostOutcome>;
}

type AuthReader = {
  homeDir(): string;
  read(path: string): Promise<string | undefined>;
};

export type CursorIo = { reader: AuthReader; fetcher: PostFetcher };

type Env = Record<string, string | undefined>;

const API_BASE = 'https://api2.cursor.sh';
const SERVICE = '/aiserver.v1.DashboardService';
const REQUEST_TIMEOUT_MS = 15000;
const DIGITS = /^\d+$/;
const FALLBACK_LABEL = 'cursor';
const NO_AUTH = 'no cursor auth — run cursor-agent login';
const PARSE_FAILURE = 'Could not parse usage from response';
const FETCH_FAILURES = {
  network: 'cursor usage request failed',
  timeout: `cursor usage request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
};
const WINDOW_FIELDS = [
  ['total', 'totalPercentUsed'],
  ['auto', 'autoPercentUsed'],
  ['api', 'apiPercentUsed']
] as const;

class CursorUnavailable extends Error {}

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function authFile(reader: AuthReader, env: Env): string {
  return env['ALLOWANCE_CURSOR_AUTH_FILE'] || `${reader.homeDir()}/.config/cursor/auth.json`;
}

async function readToken(reader: AuthReader, env: Env): Promise<string> {
  const text = await reader.read(authFile(reader, env));
  const token = text === undefined ? undefined : fieldOf(parseJson(text), 'accessToken');
  if (!isFilled(token)) throw new CursorUnavailable(NO_AUTH);
  return token;
}

function postTo(io: CursorIo, env: Env, token: string, method: string): Promise<PostOutcome> {
  const url = `${env['ALLOWANCE_CURSOR_API_BASE'] || API_BASE}${SERVICE}/${method}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return io.fetcher.post(url, headers, '{}', REQUEST_TIMEOUT_MS);
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function usageBody(outcome: PostOutcome): string {
  if ('failure' in outcome) throw new CursorUnavailable(FETCH_FAILURES[outcome.failure]);
  if (!isSuccess(outcome.status)) throw new CursorUnavailable(`cursor usage request failed: HTTP ${outcome.status}`);
  return outcome.body;
}

function epochMs(value: unknown): number {
  return typeof value === 'string' && DIGITS.test(value) ? Number(value) : Number.NaN;
}

function cycleEnd(value: unknown): string | undefined {
  const end = new Date(epochMs(value));
  return Number.isNaN(end.getTime()) ? undefined : end.toISOString();
}

function windowOf(label: string, percent: unknown, resetsAt: string | undefined): UsageWindow[] {
  if (!isCount(percent)) return [];
  const usedPct = Math.round(percent);
  return resetsAt === undefined ? [{ label, usedPct }] : [{ label, usedPct, resetsAt }];
}

function windowsOf(usage: unknown): UsageWindow[] {
  const planUsage = fieldOf(usage, 'planUsage');
  const resetsAt = cycleEnd(fieldOf(usage, 'billingCycleEnd'));
  const windows = WINDOW_FIELDS.flatMap(([label, key]) => windowOf(label, fieldOf(planUsage, key), resetsAt));
  if (windows.length === 0) throw new CursorUnavailable(PARSE_FAILURE);
  return windows;
}

function labelOf(name: unknown, price: unknown): string {
  if (!isFilled(name)) return FALLBACK_LABEL;
  return isFilled(price) ? `${name} · ${price}` : name;
}

async function planLabelOf(pending: Promise<PostOutcome>): Promise<string> {
  const outcome = await pending;
  const info = 'body' in outcome && isSuccess(outcome.status) ? fieldOf(parseJson(outcome.body), 'planInfo') : undefined;
  return labelOf(fieldOf(info, 'planName'), fieldOf(info, 'price'));
}

async function readCursor(io: CursorIo, env: Env): Promise<{ planLabel: string; windows: UsageWindow[] }> {
  const token = await readToken(io.reader, env);
  const usage = postTo(io, env, token, 'GetCurrentPeriodUsage');
  const plan = postTo(io, env, token, 'GetPlanInfo');
  const windows = windowsOf(JSON.parse(usageBody(await usage)));
  return { planLabel: await planLabelOf(plan), windows };
}

function reasonOf(error: unknown): string {
  return error instanceof CursorUnavailable ? error.message : PARSE_FAILURE;
}

export async function probeCursor(io: CursorIo, env: Env, now: string): Promise<ProviderUsage> {
  const usage = { id: 'cursor', displayName: 'cursor', fetchedAt: now };
  try {
    return { ...usage, ...(await readCursor(io, env)), status: 'ok' };
  } catch (error) {
    return { ...usage, planLabel: FALLBACK_LABEL, windows: [], status: 'unavailable', reason: reasonOf(error) };
  }
}
