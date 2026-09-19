import {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  fieldOf,
  isCount,
  successBody,
  unavailableReason,
  validInstant,
  withReset,
  type Fetcher,
  type FileReader,
  type ProviderUsage,
  type UsageWindow
} from '../domain/index.ts';

export type HermesIo = { reader: FileReader; fetcher: Pick<Fetcher, 'get'> };

type Env = Record<string, string | undefined>;

const PORTAL_BASE = 'https://portal.nousresearch.com';
const ACCOUNT_PATH = '/api/oauth/account';
const REQUEST_TIMEOUT_MS = 15000;
const FULL_PCT = 100;
const FALLBACK_LABEL = 'hermes';
const NO_AUTH = 'no hermes auth — run hermes portal login';
const EXPIRED = 'hermes token expired — run hermes once';
const NO_PAID = ' · no paid access';

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function authPath(reader: FileReader, env: Env): string {
  return env['DANDELION_HERMES_AUTH_FILE'] || `${reader.homeDir()}/.hermes/auth.json`;
}

function portalBase(env: Env): string {
  return env['DANDELION_HERMES_PORTAL_BASE'] || PORTAL_BASE;
}

function tokenPair(nous: unknown): { token: string; expiry: unknown } | undefined {
  const agentKey = fieldOf(nous, 'agent_key');
  if (isFilled(agentKey)) return { token: agentKey, expiry: fieldOf(nous, 'agent_key_expires_at') };
  const access = fieldOf(nous, 'access_token');
  return isFilled(access) ? { token: access, expiry: fieldOf(nous, 'expires_at') } : undefined;
}

function pairOf(auth: unknown): { token: string; expiry: unknown } {
  const pair = tokenPair(fieldOf(fieldOf(auth, 'providers'), 'nous'));
  if (pair === undefined) throw new ProbeUnavailable(NO_AUTH);
  return pair;
}

function tokenOf(auth: unknown, now: string): string {
  const { token, expiry } = pairOf(auth);
  const instant = validInstant(expiry);
  if (instant === undefined || Date.parse(instant) <= Date.parse(now)) throw new ProbeUnavailable(EXPIRED);
  return token;
}

async function readToken(reader: FileReader, env: Env, now: string): Promise<string> {
  const text = await reader.read(authPath(reader, env));
  if (text === undefined) throw new ProbeUnavailable(NO_AUTH);
  try {
    return tokenOf(JSON.parse(text), now);
  } catch (error) {
    throw error instanceof ProbeUnavailable ? error : new ProbeUnavailable(NO_AUTH);
  }
}

function grantOf(monthly: unknown, remaining: unknown): { monthly: number; remaining: number } {
  if (isCount(monthly) && monthly > 0 && isCount(remaining)) return { monthly, remaining };
  throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
}

function usedPercent(remaining: number, monthly: number): number {
  return Math.min(FULL_PCT, Math.max(0, Math.round(FULL_PCT - (FULL_PCT * remaining) / monthly)));
}

function planLabelOf(plan: unknown, remaining: number, monthly: number): string {
  return isFilled(plan) ? `${plan} · $${remaining.toFixed(2)} of $${monthly}` : FALLBACK_LABEL;
}

function captionSuffixOf(body: unknown): string | undefined {
  return fieldOf(fieldOf(body, 'paid_service_access'), 'paid_access') === false ? NO_PAID : undefined;
}

function usageOf(body: string): { planLabel: string; windows: UsageWindow[]; captionSuffix?: string } {
  const parsed: unknown = JSON.parse(body);
  const subscription = fieldOf(parsed, 'subscription');
  const { monthly, remaining } = grantOf(fieldOf(subscription, 'monthly_credits'), fieldOf(subscription, 'credits_remaining'));
  const windows = [
    withReset(
      { label: 'credits', kind: 'weekly', usedPct: usedPercent(remaining, monthly) },
      validInstant(fieldOf(subscription, 'current_period_end'))
    )
  ];
  const planLabel = planLabelOf(fieldOf(subscription, 'plan'), remaining, monthly);
  const captionSuffix = captionSuffixOf(parsed);
  return captionSuffix === undefined ? { planLabel, windows } : { planLabel, windows, captionSuffix };
}

async function readHermes(io: HermesIo, env: Env, now: string): Promise<{ planLabel: string; windows: UsageWindow[]; captionSuffix?: string }> {
  const token = await readToken(io.reader, env, now);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const outcome = await io.fetcher.get(`${portalBase(env)}${ACCOUNT_PATH}`, headers, REQUEST_TIMEOUT_MS);
  return usageOf(successBody(outcome, 'hermes account request', REQUEST_TIMEOUT_MS));
}

export async function probeHermes(io: HermesIo, env: Env, now: string): Promise<ProviderUsage> {
  const usage = { id: 'hermes', displayName: 'hermes', fetchedAt: now };
  try {
    return { ...usage, ...(await readHermes(io, env, now)), status: 'ok' };
  } catch (error) {
    return { ...usage, planLabel: FALLBACK_LABEL, windows: [], status: 'unavailable', reason: unavailableReason(error) };
  }
}
