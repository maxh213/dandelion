import {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  fieldOf,
  isCount,
  isSuccess,
  successBody,
  unavailableReason,
  type FetchOutcome,
  type Fetcher,
  type FileReader,
  type ProviderUsage,
  type UsageWindow
} from '../domain/index.ts';

export type CursorIo = { reader: FileReader; fetcher: Pick<Fetcher, 'post'> };

type Env = Record<string, string | undefined>;

const API_BASE = 'https://api2.cursor.sh';
const SERVICE = '/aiserver.v1.DashboardService';
const REQUEST_TIMEOUT_MS = 15000;
const DIGITS = /^\d+$/;
const FALLBACK_LABEL = 'cursor';
const NO_AUTH = 'no cursor auth — run cursor-agent login';
const WINDOW_FIELDS = [
  ['total', 'totalPercentUsed'],
  ['auto', 'autoPercentUsed'],
  ['api', 'apiPercentUsed']
] as const;

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

function authFile(reader: FileReader, env: Env): string {
  return env['ALLOWANCE_CURSOR_AUTH_FILE'] || `${reader.homeDir()}/.config/cursor/auth.json`;
}

async function readToken(reader: FileReader, env: Env): Promise<string> {
  const text = await reader.read(authFile(reader, env));
  const token = text === undefined ? undefined : fieldOf(parseJson(text), 'accessToken');
  if (!isFilled(token)) throw new ProbeUnavailable(NO_AUTH);
  return token;
}

function postTo(io: CursorIo, env: Env, token: string, method: string): Promise<FetchOutcome> {
  const url = `${env['ALLOWANCE_CURSOR_API_BASE'] || API_BASE}${SERVICE}/${method}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return io.fetcher.post(url, headers, '{}', REQUEST_TIMEOUT_MS);
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
  if (windows.length === 0) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return windows;
}

function labelOf(name: unknown, price: unknown): string {
  if (!isFilled(name)) return FALLBACK_LABEL;
  return isFilled(price) ? `${name} · ${price}` : name;
}

function planInfoOf(outcome: FetchOutcome): unknown {
  return isSuccess(outcome) ? fieldOf(parseJson(outcome.body), 'planInfo') : undefined;
}

async function planLabelOf(pending: Promise<FetchOutcome>): Promise<string> {
  const info = planInfoOf(await pending);
  return labelOf(fieldOf(info, 'planName'), fieldOf(info, 'price'));
}

async function readCursor(io: CursorIo, env: Env): Promise<{ planLabel: string; windows: UsageWindow[] }> {
  const token = await readToken(io.reader, env);
  const usage = postTo(io, env, token, 'GetCurrentPeriodUsage');
  const plan = postTo(io, env, token, 'GetPlanInfo');
  const windows = windowsOf(JSON.parse(successBody(await usage, 'cursor usage request', REQUEST_TIMEOUT_MS)));
  return { planLabel: await planLabelOf(plan), windows };
}

export async function probeCursor(io: CursorIo, env: Env, now: string): Promise<ProviderUsage> {
  const usage = { id: 'cursor', displayName: 'cursor', fetchedAt: now };
  try {
    return { ...usage, ...(await readCursor(io, env)), status: 'ok' };
  } catch (error) {
    return { ...usage, planLabel: FALLBACK_LABEL, windows: [], status: 'unavailable', reason: unavailableReason(error) };
  }
}
