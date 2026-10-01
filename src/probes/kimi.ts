import {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  fieldOf,
  isCount,
  isFilled,
  isRecord,
  parseJson,
  successBody,
  unavailableFix,
  unavailableReason,
  validInstant,
  withReset,
  type Fetcher,
  type FileReader,
  type ProviderUsage,
  type UsageWindow
} from '../domain/index.ts';

export type LaunchedProcess = {
  output(): Promise<string>;
  hasExited(): boolean;
  stop(): Promise<void>;
};

export interface Launcher {
  launch(command: string, args: string[]): Promise<LaunchedProcess | undefined>;
}

export type KimiIo = { launcher: Launcher; fetcher: Pick<Fetcher, 'get'>; reader: FileReader };

type Env = Record<string, string | undefined>;

type Auth = { base: string; token: string };

const DEFAULT_PORT = 59177;
const MAX_PORT = 65535;
const POLL_MS = 500;
const TOKEN_WAIT_MS = 20000;
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_BASE = 'https://api.kimi.com/coding/v1';
const USER_AGENT = 'kimi-code-cli/2.1.1';
const NO_AUTH = 'no kimi auth — run kimi login';
const EXPIRED = 'kimi token expired — run kimi once';
const KIMI_FIX = { command: 'kimi', args: [] };
const NOT_REFRESHED = 'kimi token expired and kimi web did not refresh it — run kimi once';
const TOKEN = /token=([A-Za-z0-9._-]+)|Bearer ([A-Za-z0-9._-]+)/;
const WEEKLY = { label: 'weekly', kind: 'weekly' } as const;
const ROLLING = { label: '5h', kind: 'rolling' } as const;

function isDefaultPort(raw: string | undefined): raw is undefined | '' {
  return raw === undefined || raw === '';
}

function isValidPort(raw: string): boolean {
  return /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= MAX_PORT;
}

function parsePort(raw: string | undefined): number {
  if (isDefaultPort(raw)) return DEFAULT_PORT;
  if (!isValidPort(raw)) throw new ProbeUnavailable(`DANDELION_KIMI_PORT must be an integer from 1 to ${MAX_PORT}`);
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
  if (failure !== undefined) throw new ProbeUnavailable(failure);
  await sleep(POLL_MS);
  return waitForToken(child, waitedMs + POLL_MS);
}

async function requestUsage(fetcher: KimiIo['fetcher'], url: string, headers: Record<string, string>): Promise<string> {
  const outcome = await fetcher.get(url, headers, REQUEST_TIMEOUT_MS);
  return successBody(outcome, 'kimi usage request', REQUEST_TIMEOUT_MS);
}

function requestFailed(msg: unknown): string {
  return isFilled(msg) ? `kimi usage request failed: ${msg}` : 'kimi usage request failed';
}

function envelopeFailure(body: unknown): string | undefined {
  const code = fieldOf(body, 'code');
  return code === undefined || code === 0 ? undefined : requestFailed(fieldOf(body, 'msg'));
}

function parsedCount(value: string): number | undefined {
  if (!/^\d+(\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return isCount(parsed) ? parsed : undefined;
}

function countOf(value: unknown): number | undefined {
  if (isCount(value)) return value;
  return typeof value === 'string' ? parsedCount(value) : undefined;
}

function usedPctOf(ratio: unknown): number | undefined {
  return isCount(ratio) ? Math.min(100, Math.round(100 * ratio)) : undefined;
}

function counterPct(entry: unknown): number | undefined {
  const used = countOf(fieldOf(entry, 'used'));
  const limit = countOf(fieldOf(entry, 'limit'));
  if (used === undefined || limit === undefined || limit === 0) return undefined;
  return Math.min(100, Math.round((100 * used) / limit));
}

function windowFrom(usedPct: number | undefined, identity: Pick<UsageWindow, 'label' | 'kind'>, resetsAt?: string): UsageWindow[] {
  return usedPct === undefined ? [] : [withReset({ ...identity, usedPct }, resetsAt)];
}

function ratioEntry(usages: unknown, camel: string, snake: string): unknown {
  return fieldOf(usages, camel) ?? fieldOf(usages, snake);
}

function ratioReset(entry: unknown): string | undefined {
  return validInstant(fieldOf(entry, 'resetAt') ?? fieldOf(entry, 'reset_time'));
}

function ratioWindow(entry: unknown, identity: Pick<UsageWindow, 'label' | 'kind'>): UsageWindow[] {
  const ratio = fieldOf(entry, 'usedRatio') ?? fieldOf(entry, 'used_ratio');
  return windowFrom(usedPctOf(ratio), identity, ratioReset(entry));
}

function counterWindow(entry: unknown, identity: Pick<UsageWindow, 'label' | 'kind'>): UsageWindow[] {
  return windowFrom(counterPct(entry), identity, validInstant(fieldOf(entry, 'resetTime')));
}

function isFiveHour(entry: unknown): boolean {
  const window = fieldOf(entry, 'window');
  return fieldOf(window, 'duration') === 300 && fieldOf(window, 'timeUnit') === 'TIME_UNIT_MINUTE';
}

function fiveHourDetail(limits: unknown): unknown {
  if (!Array.isArray(limits)) return undefined;
  const entry: unknown = limits.find(isFiveHour);
  return fieldOf(entry, 'detail');
}

function ratioUsages(parsed: unknown): unknown {
  const direct = fieldOf(parsed, 'usages');
  if (isRecord(direct)) return direct;
  const data = fieldOf(parsed, 'data');
  return fieldOf(data, 'kind') === 'ok' ? fieldOf(fieldOf(data, 'quota'), 'usages') : undefined;
}

function prefer(counter: UsageWindow[], ratio: UsageWindow[]): UsageWindow[] {
  return counter.length > 0 ? counter : ratio;
}

function windowsOf(parsed: unknown): UsageWindow[] {
  const ratios = ratioUsages(parsed);
  const windows = [
    ...prefer(counterWindow(fieldOf(parsed, 'usage'), WEEKLY), ratioWindow(ratioEntry(ratios, 'limit7d', 'limit_7d'), WEEKLY)),
    ...prefer(counterWindow(fiveHourDetail(fieldOf(parsed, 'limits')), ROLLING), ratioWindow(ratioEntry(ratios, 'limit5h', 'limit_5h'), ROLLING))
  ];
  if (windows.length === 0) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return windows;
}

function parseUsage(body: string): UsageWindow[] {
  const parsed = parseJson(body);
  const failure = envelopeFailure(parsed);
  if (failure !== undefined) throw new ProbeUnavailable(failure);
  return windowsOf(parsed);
}

function kimiHome(reader: FileReader, env: Env): string {
  const home = env['DANDELION_KIMI_HOME'];
  return home === undefined || home === '' ? `${reader.homeDir()}/.kimi-code` : home;
}

const KIMI_TABLE = '[providers."managed:kimi-code"]';
const KIMI_OAUTH_TABLE = '[providers."managed:kimi-code".oauth]';

function tablesOf(config: string): string[] {
  return config.split(/^(?=\[)/m);
}

function tableBody(config: string, header: string): string | undefined {
  return tablesOf(config).find((table) => table.split('\n', 1)[0].trim() === header);
}

function topLevel(config: string): string {
  const [first] = tablesOf(config);
  return first.startsWith('[') ? '' : first;
}

function tomlValue(text: string | undefined, key: string): string | undefined {
  if (text === undefined) return undefined;
  return new RegExp(`^${key} = "([^"]*)"`, 'm').exec(text)?.[1];
}

function kimiValue(config: string | undefined, key: string, tables: string[]): string | undefined {
  if (config === undefined) return undefined;
  const scopes = tableBody(config, KIMI_TABLE) === undefined ? [topLevel(config)] : tables.map((header) => tableBody(config, header));
  return scopes.map((scope) => tomlValue(scope, key)).find((value) => value !== undefined);
}

function credentialName(config: string | undefined): string {
  const key = kimiValue(config, 'key', [KIMI_OAUTH_TABLE, KIMI_TABLE]) ?? '';
  const name = key.startsWith('oauth/') ? key.slice('oauth/'.length) : key;
  return name === '' ? 'kimi-code' : name;
}

function apiBase(config: string | undefined): string {
  const base = kimiValue(config, 'base_url', [KIMI_TABLE]);
  return (base === undefined || base === '' ? DEFAULT_BASE : base).replace(/\/+$/, '');
}

function expiryMs(value: unknown): number | undefined {
  if (value === 0) return Number.POSITIVE_INFINITY;
  if (!isCount(value)) return undefined;
  return value < 1e12 ? value * 1000 : value;
}

type Credential = { base: string; parsed: unknown };

function isExpired(parsed: unknown, now: string): boolean {
  const expiry = expiryMs(fieldOf(parsed, 'expires_at'));
  return expiry !== undefined && expiry <= Date.parse(now);
}

function authOf(credential: Credential): Auth {
  const token = fieldOf(credential.parsed, 'access_token');
  if (!isFilled(token)) throw new ProbeUnavailable(NO_AUTH);
  return { base: credential.base, token };
}

function parseCredential(text: string): unknown {
  try {
    return parseJson(text);
  } catch {
    throw new ProbeUnavailable(NO_AUTH);
  }
}

async function loadCredential(io: KimiIo, env: Env): Promise<Credential | undefined> {
  const home = kimiHome(io.reader, env);
  const config = await io.reader.read(`${home}/config.toml`);
  const text = await io.reader.read(`${home}/credentials/${credentialName(config)}.json`);
  if (text === undefined) return undefined;
  return { base: apiBase(config), parsed: parseCredential(text) };
}

function isFresh(credential: Credential | undefined, now: string): credential is Credential {
  return credential !== undefined && !isExpired(credential.parsed, now);
}

async function loadCredentialOrUndefined(io: KimiIo, env: Env): Promise<Credential | undefined> {
  try {
    return await loadCredential(io, env);
  } catch {
    return undefined;
  }
}

async function waitForFresh(io: KimiIo, env: Env, child: LaunchedProcess, now: string, waitedMs: number): Promise<Auth> {
  const exited = child.hasExited();
  const credential = await loadCredentialOrUndefined(io, env);
  if (isFresh(credential, now)) return authOf(credential);
  if (exited || waitedMs >= TOKEN_WAIT_MS) throw new ProbeUnavailable(NOT_REFRESHED, KIMI_FIX);
  await sleep(POLL_MS);
  return waitForFresh(io, env, child, now, waitedMs + POLL_MS);
}

async function refreshViaKimi(io: KimiIo, env: Env, now: string): Promise<Auth> {
  const port = parsePort(env['DANDELION_KIMI_PORT']);
  const child = await io.launcher.launch('kimi', ['web', '--no-open', '--port', String(port)]);
  if (child === undefined) throw new ProbeUnavailable(EXPIRED, KIMI_FIX);
  try {
    return await waitForFresh(io, env, child, now, 0);
  } finally {
    await child.stop();
  }
}

async function authFor(io: KimiIo, env: Env, credential: Credential, now: string): Promise<Auth> {
  const auth = authOf(credential);
  if (!isExpired(credential.parsed, now)) return auth;
  if (!isFilled(fieldOf(credential.parsed, 'refresh_token'))) throw new ProbeUnavailable(EXPIRED, KIMI_FIX);
  return refreshViaKimi(io, env, now);
}

async function readLocal(io: KimiIo, env: Env): Promise<UsageWindow[]> {
  const port = parsePort(env['DANDELION_KIMI_PORT']);
  const child = await io.launcher.launch('kimi', ['web', '--no-open', '--port', String(port)]);
  if (child === undefined) throw new ProbeUnavailable('kimi CLI not found in PATH');
  try {
    const token = await waitForToken(child, 0);
    return parseUsage(await requestUsage(io.fetcher, `http://127.0.0.1:${port}/api/v1/oauth/usage`, { Authorization: `Bearer ${token}` }));
  } finally {
    await child.stop();
  }
}

async function readApi(io: KimiIo, auth: Auth): Promise<UsageWindow[]> {
  const headers = { Authorization: `Bearer ${auth.token}`, Accept: 'application/json', 'User-Agent': USER_AGENT };
  return parseUsage(await requestUsage(io.fetcher, `${auth.base}/usages`, headers));
}

async function readKimi(io: KimiIo, env: Env, now: string): Promise<UsageWindow[]> {
  const credential = await loadCredential(io, env);
  return credential === undefined ? readLocal(io, env) : readApi(io, await authFor(io, env, credential, now));
}

export async function probeKimi(io: KimiIo, env: Env, now: string): Promise<ProviderUsage> {
  const usage = { id: 'kimi', displayName: 'kimi', planLabel: 'kimi code', fetchedAt: now };
  try {
    return { ...usage, windows: await readKimi(io, env, now), status: 'ok' };
  } catch (error) {
    return { ...usage, windows: [], status: 'unavailable', reason: unavailableReason(error), ...unavailableFix(error) };
  }
}
