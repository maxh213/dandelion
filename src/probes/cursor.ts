import {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  fieldOf,
  isCount,
  isFilled,
  isSuccess,
  parseJson,
  successBody,
  unavailableFix,
  unavailableReason,
  withReset,
  type FetchOutcome,
  type Fetcher,
  type FileReader,
  type Fix,
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
const LOGIN_FIX: Fix = { command: 'cursor-agent', args: ['login'] };
const WINDOW_FIELDS = [
  { label: 'total', key: 'totalPercentUsed' },
  { label: 'auto', key: 'autoPercentUsed' },
  { label: 'api', key: 'apiPercentUsed' }
] as const satisfies ReadonlyArray<{ label: string; key: string }>;

function authFile(reader: FileReader, env: Env): string {
  return env['DANDELION_CURSOR_AUTH_FILE'] || `${reader.homeDir()}/.config/cursor/auth.json`;
}

function tokenOf(auth: unknown): string {
  const token = fieldOf(auth, 'accessToken');
  if (!isFilled(token)) throw new ProbeUnavailable(NO_AUTH, LOGIN_FIX);
  return token;
}

async function readToken(reader: FileReader, env: Env): Promise<string> {
  const text = await reader.read(authFile(reader, env));
  try {
    return tokenOf(parseJson(String(text)));
  } catch {
    throw new ProbeUnavailable(NO_AUTH, LOGIN_FIX);
  }
}

function postTo(io: CursorIo, env: Env, token: string, method: string): Promise<FetchOutcome> {
  const url = `${env['DANDELION_CURSOR_API_BASE'] || API_BASE}${SERVICE}/${method}`;
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
  return [withReset({ label, kind: 'weekly', usedPct: Math.round(percent) }, resetsAt)];
}

function windowsOf(usage: unknown): UsageWindow[] {
  const planUsage = fieldOf(usage, 'planUsage');
  const resetsAt = cycleEnd(fieldOf(usage, 'billingCycleEnd'));
  const windows = WINDOW_FIELDS.flatMap(({ label, key }) => windowOf(label, fieldOf(planUsage, key), resetsAt));
  if (windows.length === 0) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return windows;
}

function labelOf(name: unknown, price: unknown): string {
  if (!isFilled(name)) return FALLBACK_LABEL;
  return isFilled(price) ? `${name} · ${price}` : name;
}

function planLabelFrom(body: string): string {
  const info = fieldOf(parseJson(body), 'planInfo');
  return labelOf(fieldOf(info, 'planName'), fieldOf(info, 'price'));
}

async function planLabelOf(pending: Promise<FetchOutcome>): Promise<string> {
  const outcome = await pending;
  try {
    return isSuccess(outcome) ? planLabelFrom(outcome.body) : FALLBACK_LABEL;
  } catch {
    return FALLBACK_LABEL;
  }
}

async function readCursor(io: CursorIo, env: Env): Promise<{ planLabel: string; windows: UsageWindow[] }> {
  const token = await readToken(io.reader, env);
  const usage = postTo(io, env, token, 'GetCurrentPeriodUsage');
  const plan = postTo(io, env, token, 'GetPlanInfo');
  const windows = windowsOf(parseJson(successBody(await usage, 'cursor usage request', REQUEST_TIMEOUT_MS)));
  return { planLabel: await planLabelOf(plan), windows };
}

export async function probeCursor(io: CursorIo, env: Env, now: string): Promise<ProviderUsage> {
  const usage = { id: 'cursor', displayName: 'cursor', fetchedAt: now };
  try {
    return { ...usage, ...(await readCursor(io, env)), status: 'ok' };
  } catch (error) {
    return { ...usage, planLabel: FALLBACK_LABEL, windows: [], status: 'unavailable', reason: unavailableReason(error), ...unavailableFix(error) };
  }
}
