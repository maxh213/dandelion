import {
  fieldOf,
  isCount,
  isFilled,
  isRecord,
  isStale,
  matchesOnJsonLine,
  newestLineMatch,
  parseJson,
  validInstant,
  withReset,
  type CommandRunner,
  type FetchOutcome,
  type Fetcher,
  type FileReader,
  type Fix,
  type ProviderUsage,
  type UsageWindow
} from '../domain/index.ts';
type Getter = Pick<Fetcher, 'get'>;

export type GrokIo = { reader: FileReader; fetcher?: Getter; runner?: Pick<CommandRunner, 'run'> };

type Env = Record<string, string | undefined>;
type Snapshot = { window: UsageWindow; tier: string; ts: string; ended: boolean };
type BillingReply = { body?: string; unauthorized?: boolean };

const BILLING_MSG = 'billing: fetched credits config';
const BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
const PERIOD_ENDED = ' · period ended since snapshot';
const REQUEST_TIMEOUT_MS = 10000;
const REFRESH_TIMEOUT_MS = 20000;
const FIX: Fix = { command: 'grok', args: [] };
const UNAVAILABLE = 'no grok billing snapshot — run grok once';

function grokHome(reader: FileReader, env: Env): string {
  return env['DANDELION_GROK_HOME'] || `${reader.homeDir()}/.grok`;
}

function usedPercent(config: unknown): number | undefined {
  const percent = fieldOf(config, 'creditUsagePercent');
  return isCount(percent) ? percent : undefined;
}

function tierOf(ctx: unknown): string {
  const tier = fieldOf(ctx, 'subscriptionTier');
  return isFilled(tier) ? tier : 'grok';
}

function periodEnded(end: string | undefined, now: string): boolean {
  return end !== undefined && Date.parse(end) <= Date.parse(now);
}

function creditsWindow(usedPct: number, resetsAt: string | undefined, ended: boolean): UsageWindow {
  return ended ? { label: 'credits', kind: 'weekly', usedPct: 0 } : withReset({ label: 'credits', kind: 'weekly', usedPct }, resetsAt);
}

function usableSnapshots(event: unknown, now: string): Snapshot[] {
  const ctx = fieldOf(event, 'ctx');
  const config = fieldOf(ctx, 'config');
  const usedPct = usedPercent(config);
  const ts = validInstant(fieldOf(event, 'ts'));
  if (usedPct === undefined || ts === undefined) return [];
  const resetsAt = validInstant(fieldOf(fieldOf(config, 'currentPeriod'), 'end'));
  const ended = periodEnded(resetsAt, now);
  return [{ window: creditsWindow(usedPct, resetsAt, ended), tier: tierOf(ctx), ts, ended }];
}

function snapshotsOn(line: string, now: string): Snapshot[] {
  return matchesOnJsonLine(line, (event) => (fieldOf(event, 'msg') === BILLING_MSG ? usableSnapshots(event, now) : []));
}

function staleFix(snapshotAt: string, now: string): { fix?: Fix } {
  return isStale(snapshotAt, now) ? { fix: FIX } : {};
}

function usageFrom(snapshot: Snapshot, now: string): ProviderUsage {
  const usage = { id: 'grok', displayName: 'grok', fetchedAt: now };
  const ok = { ...usage, planLabel: snapshot.tier, windows: [snapshot.window], status: 'ok' as const, snapshotAt: snapshot.ts, ...staleFix(snapshot.ts, now) };
  return snapshot.ended ? { ...ok, captionSuffix: PERIOD_ENDED } : ok;
}

function unavailable(now: string): ProviderUsage {
  return { id: 'grok', displayName: 'grok', fetchedAt: now, planLabel: 'grok', windows: [], status: 'unavailable', reason: UNAVAILABLE, fix: FIX };
}

async function logUsage(io: GrokIo, env: Env, now: string): Promise<ProviderUsage> {
  const log = await io.reader.read(`${grokHome(io.reader, env)}/logs/unified.jsonl`);
  const snapshot = log === undefined ? undefined : newestLineMatch(log, BILLING_MSG, (line) => snapshotsOn(line, now));
  return snapshot === undefined ? unavailable(now) : usageFrom(snapshot, now);
}

function billingUrl(env: Env): string {
  return env['DANDELION_GROK_BILLING_URL'] || BILLING_URL;
}

function tokenOf(auth: unknown): string | undefined {
  if (!isRecord(auth)) return undefined;
  for (const value of Object.values(auth)) {
    const token = fieldOf(value, 'key');
    if (isFilled(token)) return token;
  }
  return undefined;
}

async function accountToken(io: GrokIo, env: Env): Promise<string | undefined> {
  const text = await io.reader.read(`${grokHome(io.reader, env)}/auth.json`);
  if (text === undefined) return undefined;
  try {
    return tokenOf(parseJson(text));
  } catch {
    return undefined;
  }
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function replyOf(outcome: FetchOutcome): BillingReply {
  if ('failure' in outcome) return {};
  if (outcome.status === 401) return { unauthorized: true };
  return isOk(outcome.status) ? { body: outcome.body } : {};
}

async function requestBilling(fetcher: Getter, env: Env, token: string): Promise<BillingReply> {
  try {
    return replyOf(await fetcher.get(billingUrl(env), { Authorization: `Bearer ${token}`, Accept: 'application/json' }, REQUEST_TIMEOUT_MS));
  } catch {
    return {};
  }
}

async function refreshLogin(io: GrokIo): Promise<void> {
  await io.runner?.run('grok', ['models'], REFRESH_TIMEOUT_MS).catch(() => ({ stdout: '', stderr: '' }));
}

function withUnusedCredits(config: unknown): unknown {
  if (!isRecord(config) || fieldOf(config, 'creditUsagePercent') !== undefined) return config;
  return isRecord(fieldOf(config, 'currentPeriod')) ? { ...config, creditUsagePercent: 0 } : config;
}

function snapshotOf(body: string, now: string): Snapshot | undefined {
  try {
    const parsed = parseJson(body);
    const config = withUnusedCredits(fieldOf(parsed, 'config'));
    const tier = fieldOf(config, 'subscriptionTier') ?? fieldOf(parsed, 'subscriptionTier');
    return usableSnapshots({ ts: now, ctx: { config, subscriptionTier: tier } }, now)[0];
  } catch {
    return undefined;
  }
}

async function retriedBody(io: GrokIo, fetcher: Getter, env: Env): Promise<string | undefined> {
  if (io.runner === undefined) return undefined;
  await refreshLogin(io);
  const token = await accountToken(io, env);
  if (token === undefined) return undefined;
  return (await requestBilling(fetcher, env, token)).body;
}

async function billingBody(io: GrokIo, fetcher: Getter, env: Env, token: string): Promise<string | undefined> {
  const reply = await requestBilling(fetcher, env, token);
  return reply.unauthorized === true ? retriedBody(io, fetcher, env) : reply.body;
}

function usageOfBody(body: string, now: string): ProviderUsage | undefined {
  const snapshot = snapshotOf(body, now);
  return snapshot === undefined ? undefined : usageFrom(snapshot, now);
}

async function liveUsage(io: GrokIo, env: Env, now: string): Promise<ProviderUsage | undefined> {
  if (io.fetcher === undefined) return undefined;
  const token = await accountToken(io, env);
  if (token === undefined) return undefined;
  const body = await billingBody(io, io.fetcher, env, token);
  return body === undefined ? undefined : usageOfBody(body, now);
}

export async function probeGrok(io: GrokIo, env: Env, now: string): Promise<ProviderUsage> {
  return (await liveUsage(io, env, now)) ?? logUsage(io, env, now);
}
