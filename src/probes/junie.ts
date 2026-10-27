import { ProbeUnavailable, USAGE_PARSE_FAILURE, fieldOf, isCount, isFilled, parseJson, successBody, matchesOnJsonLine, newestLineMatch, isStale, unavailableReason, usedPctFromRemaining, type Fetcher, type FileReader, type Fix, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

export type JunieIo = { reader: FileReader; fetcher?: Fetcher };

type Session = { id: string; updatedAt: number };

type Snapshot = { balance: number; endedAtMs: number };

const SNAPSHOT_TYPE = 'TaskQuotaSnapshot.JetBrains';
const DEFAULT_REFERENCE = 1000000;
const FIX: Fix = { command: 'junie', args: [] };
const UNAVAILABLE = 'no junie quota snapshot — run junie once';
const NO_REFERENCE = 'balance without a reference';

function junieHome(reader: FileReader, env: Record<string, string | undefined>): string {
  return env['DANDELION_JUNIE_HOME'] || `${reader.homeDir()}/.junie`;
}

function usableSessions(entry: unknown): Session[] {
  const id = fieldOf(entry, 'sessionId');
  const updatedAt = fieldOf(entry, 'updatedAt');
  return typeof id === 'string' && Number.isFinite(updatedAt) ? [{ id, updatedAt: Number(updatedAt) }] : [];
}

function sessionsOn(line: string): Session[] {
  return matchesOnJsonLine(line, usableSessions);
}

async function sessionsNewestFirst(reader: FileReader, home: string): Promise<Session[]> {
  const index = await reader.read(`${home}/sessions/index.jsonl`);
  return index === undefined ? [] : index.split('\n').flatMap(sessionsOn).sort((a, b) => b.updatedAt - a.updatedAt);
}

function isInstant(ms: unknown): ms is number {
  return typeof ms === 'number' && !Number.isNaN(new Date(ms).getTime());
}

function usableSnapshots(completion: unknown): Snapshot[] {
  const quota = fieldOf(completion, 'quota');
  const balance = fieldOf(quota, 'balanceLeft');
  const endedAtMs = fieldOf(completion, 'endedAtMs');
  const jetBrains = String(fieldOf(quota, 'type')).endsWith(SNAPSHOT_TYPE);
  return jetBrains && isCount(balance) && isInstant(endedAtMs) ? [{ balance, endedAtMs }] : [];
}

function snapshotsOn(line: string): Snapshot[] {
  return matchesOnJsonLine(line, (parsed) => usableSnapshots(fieldOf(parsed, 'completion')));
}

async function newestSessionSnapshot(reader: FileReader, home: string): Promise<Snapshot | undefined> {
  for (const { id } of await sessionsNewestFirst(reader, home)) {
    const log = await reader.read(`${home}/sessions/${id}/events.jsonl`);
    const snapshot = log === undefined ? undefined : newestLineMatch(log, SNAPSHOT_TYPE, snapshotsOn);
    if (snapshot !== undefined) return snapshot;
  }
  return undefined;
}

function referenceOf(raw: string | undefined): number | undefined {
  if (raw === '') return undefined;
  const reference = Number(raw);
  return isCount(reference) && reference > 0 ? reference : DEFAULT_REFERENCE;
}

function creditsWindows(balance: number, reference: number | undefined, live: boolean): UsageWindow[] {
  if (reference === undefined) return [];
  const usedPct = usedPctFromRemaining(balance, reference);
  return [{ label: 'credits', kind: 'weekly', usedPct: live ? usedPct : Math.round(usedPct) }];
}

function withNote(windows: UsageWindow[]): { note?: string } {
  return windows.length === 0 ? { note: NO_REFERENCE } : {};
}

function staleFix(snapshotAt: string, now: string): { fix?: Fix } {
  return isStale(snapshotAt, now) ? { fix: FIX } : {};
}

function usageFrom(snapshot: Snapshot | undefined, env: Record<string, string | undefined>, now: string, live: boolean): ProviderUsage {
  const usage = { id: 'junie', displayName: 'junie', fetchedAt: now };
  if (snapshot === undefined) return { ...usage, planLabel: 'junie', windows: [], status: 'unavailable', reason: UNAVAILABLE, fix: FIX };
  const windows = creditsWindows(snapshot.balance, referenceOf(env['DANDELION_JUNIE_REFERENCE']), live);
  const planLabel = `${Math.round(snapshot.balance)} credits`;
  const snapshotAt = new Date(snapshot.endedAtMs).toISOString();
  return { ...usage, planLabel, windows, status: 'ok', snapshotAt, ...withNote(windows), ...staleFix(snapshotAt, now) };
}

export async function probeJunie(io: JunieIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage> {
  const home = junieHome(io.reader, env);
  try {
    const balance = await liveJunieQuota(io, home, env);
    const snapshot = balance === undefined ? await newestSessionSnapshot(io.reader, home) : { balance, endedAtMs: Date.parse(now) };
    return usageFrom(snapshot, env, now, balance !== undefined);
  } catch (error) {
    return { id: 'junie', displayName: 'junie', planLabel: 'junie', fetchedAt: now, windows: [], status: 'unavailable', reason: unavailableReason(error), fix: FIX };
  }
}

const TOKEN_URL = 'https://oauth.account.jetbrains.com/oauth2/token';
const QUOTA_URL = 'https://ingrazzio-cloud-prod.labs.jb.gg/auth/test';
const REQUEST_TIMEOUT_MS = 15000;
const LOGIN_FAILURE = 'junie login cannot be read — run junie';

function accountSecret(value: unknown): unknown {
  const secrets = fieldOf(value, 'secrets');
  if (!Array.isArray(secrets)) return undefined;
  return fieldOf(secrets.find((entry) => fieldOf(entry, 'key') === 'jb-account-stored'), 'secret');
}

function refreshToken(secret: unknown): string {
  if (!isFilled(secret)) throw new ProbeUnavailable(LOGIN_FAILURE);
  const token = fieldOf(fieldOf(parseJson(secret), 'jbAccount'), 'refresh_token');
  if (!isFilled(token)) throw new ProbeUnavailable(LOGIN_FAILURE);
  return token;
}

async function storedRefreshToken(reader: FileReader, home: string): Promise<string | undefined> {
  const text = await reader.read(`${home}/secure_credentials.json`);
  if (text === undefined) return undefined;
  const secret = accountSecret(parseJson(text));
  return secret === undefined ? undefined : refreshToken(secret);
}

async function accessToken(fetcher: Fetcher, token: string, url: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: 'junie-cli' }).toString();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const outcome = await fetcher.post(url, headers, body, REQUEST_TIMEOUT_MS);
  const access = fieldOf(parseJson(successBody(outcome, 'junie login refresh', REQUEST_TIMEOUT_MS)), 'access_token');
  if (!isFilled(access)) throw new ProbeUnavailable(LOGIN_FAILURE);
  return access;
}

function balanceOf(body: string): number {
  const account = parseJson(body);
  if (fieldOf(account, 'active') === false) throw new ProbeUnavailable('junie account is inactive — run junie');
  const balance = fieldOf(account, 'balanceLeft');
  if (fieldOf(account, 'balanceUnit') !== 'CREDITS' || !isCount(balance)) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return balance;
}

async function liveJunieQuota(io: JunieIo, home: string, env: Record<string, string | undefined>): Promise<number | undefined> {
  if (io.fetcher === undefined) return undefined;
  const refresh = await storedRefreshToken(io.reader, home);
  if (refresh === undefined) return undefined;
  const token = await accessToken(io.fetcher, refresh, tokenUrl(env));
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-Accept-EAP-License': 'false', 'X-Accept-Release-License': 'true' };
  const outcome = await io.fetcher.get(quotaUrl(env), headers, REQUEST_TIMEOUT_MS);
  return balanceOf(successBody(outcome, 'junie quota request', REQUEST_TIMEOUT_MS));
}

function tokenUrl(env: Record<string, string | undefined>): string {
  return env['DANDELION_JUNIE_TOKEN_URL'] || TOKEN_URL;
}

function quotaUrl(env: Record<string, string | undefined>): string {
  return env['DANDELION_JUNIE_QUOTA_URL'] || QUOTA_URL;
}
