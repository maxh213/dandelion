import {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  fieldOf,
  isCount,
  isFilled,
  parseJson,
  successBody,
  unavailableFix,
  unavailableReason,
  usedPctFromRemaining,
  validInstant,
  withReset,
  type Fetcher,
  type FileReader,
  type Fix,
  type ProviderUsage,
  type UsageWindow
} from '../domain/index.ts';

export type HermesIo = { reader: FileReader; fetcher: Pick<Fetcher, 'get'> };

type Env = Record<string, string | undefined>;

type AccountUsage = { planLabel: string; windows: UsageWindow[]; captionSuffix?: string };

const PORTAL_BASE = 'https://portal.nousresearch.com';
const ACCOUNT_PATH = '/api/oauth/account';
const REQUEST_TIMEOUT_MS = 15000;
const FALLBACK_LABEL = 'hermes';
const NO_AUTH = 'no hermes auth — run hermes portal login';
const EXPIRED = 'hermes token expired — run hermes once';
const LOGIN_FIX: Fix = { command: 'hermes', args: ['portal', 'login'] };
const ONCE_FIX: Fix = { command: 'hermes', args: ['once'] };
const NO_PAID = ' · no paid access';

function authFile(reader: FileReader, env: Env): string {
  return env['DANDELION_HERMES_AUTH_FILE'] || `${reader.homeDir()}/.hermes/auth.json`;
}

function portalBase(env: Env): string {
  return env['DANDELION_HERMES_PORTAL_BASE'] || PORTAL_BASE;
}

function bearerOf(nous: unknown): { token: string; expiry: unknown } | undefined {
  const agentKey = fieldOf(nous, 'agent_key');
  if (isFilled(agentKey)) return { token: agentKey, expiry: fieldOf(nous, 'agent_key_expires_at') };
  const access = fieldOf(nous, 'access_token');
  return isFilled(access) ? { token: access, expiry: fieldOf(nous, 'expires_at') } : undefined;
}

function nousBearer(auth: unknown): { token: string; expiry: unknown } {
  const bearer = bearerOf(fieldOf(fieldOf(auth, 'providers'), 'nous'));
  if (bearer === undefined) throw new ProbeUnavailable(NO_AUTH, LOGIN_FIX);
  return bearer;
}

function unexpiredToken(token: string, expiry: unknown, now: string): string {
  const instant = validInstant(expiry);
  if (instant === undefined || Date.parse(instant) <= Date.parse(now)) throw new ProbeUnavailable(EXPIRED, ONCE_FIX);
  return token;
}

async function readToken(reader: FileReader, env: Env, now: string): Promise<string> {
  const text = await reader.read(authFile(reader, env));
  try {
    const { token, expiry } = nousBearer(parseJson(String(text)));
    return unexpiredToken(token, expiry, now);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ProbeUnavailable(NO_AUTH, LOGIN_FIX);
  }
}

function positiveCount(value: unknown): number | undefined {
  return isCount(value) && value > 0 ? value : undefined;
}

function creditsGrant(subscription: unknown): { monthly: number; remaining: number } {
  const monthly = positiveCount(fieldOf(subscription, 'monthly_credits'));
  const remaining = fieldOf(subscription, 'credits_remaining');
  if (monthly === undefined || !isCount(remaining)) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return { monthly, remaining };
}

function planLabelOf(plan: unknown, remaining: number, monthly: number): string {
  return isFilled(plan) ? `${plan} · $${remaining.toFixed(2)} of $${monthly}` : FALLBACK_LABEL;
}

function captionSuffixOf(body: unknown): string | undefined {
  return fieldOf(fieldOf(body, 'paid_service_access'), 'paid_access') === false ? NO_PAID : undefined;
}

function creditsWindow(remaining: number, monthly: number, periodEnd: unknown): UsageWindow {
  return withReset(
    { label: 'credits', kind: 'weekly', usedPct: usedPctFromRemaining(remaining, monthly) },
    validInstant(periodEnd)
  );
}

function withCaptionSuffix(usage: { planLabel: string; windows: UsageWindow[] }, suffix: string | undefined): AccountUsage {
  return suffix === undefined ? usage : { ...usage, captionSuffix: suffix };
}

function usageOf(body: string): AccountUsage {
  const parsed = parseJson(body);
  const subscription = fieldOf(parsed, 'subscription');
  const { monthly, remaining } = creditsGrant(subscription);
  return withCaptionSuffix(
    {
      planLabel: planLabelOf(fieldOf(subscription, 'plan'), remaining, monthly),
      windows: [creditsWindow(remaining, monthly, fieldOf(subscription, 'current_period_end'))]
    },
    captionSuffixOf(parsed)
  );
}

async function readHermes(io: HermesIo, env: Env, now: string): Promise<AccountUsage> {
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
    return { ...usage, planLabel: FALLBACK_LABEL, windows: [], status: 'unavailable', reason: unavailableReason(error), ...unavailableFix(error) };
  }
}
