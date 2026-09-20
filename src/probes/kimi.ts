import {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  fieldOf,
  isCount,
  isFilled,
  isRecord,
  parseJson,
  successBody,
  unavailableReason,
  validInstant,
  withReset,
  type Fetcher,
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

export type KimiIo = { launcher: Launcher; fetcher: Pick<Fetcher, 'get'> };

const DEFAULT_PORT = 59177;
const MAX_PORT = 65535;
const POLL_MS = 500;
const TOKEN_WAIT_MS = 20000;
const REQUEST_TIMEOUT_MS = 10000;
const FULL_PCT = 100;
const USAGE_REQUEST = 'kimi usage request';
const REQUEST_FAILED = `${USAGE_REQUEST} failed`;
const TOKEN = /token=([A-Za-z0-9._-]+)|Bearer ([A-Za-z0-9._-]+)/;
const DIGITS = /^\d+$/;

function isDefaultPort(raw: string | undefined): raw is undefined | '' {
  return raw === undefined || raw === '';
}

function isValidPort(raw: string): boolean {
  return DIGITS.test(raw) && Number(raw) >= 1 && Number(raw) <= MAX_PORT;
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

async function requestUsage(fetcher: KimiIo['fetcher'], port: number, token: string): Promise<string> {
  const url = `http://127.0.0.1:${port}/api/v1/oauth/usage`;
  const outcome = await fetcher.get(url, { Authorization: `Bearer ${token}` }, REQUEST_TIMEOUT_MS);
  return successBody(outcome, USAGE_REQUEST, REQUEST_TIMEOUT_MS);
}

function requestFailed(msg: unknown): string {
  return isFilled(msg) ? `${REQUEST_FAILED}: ${msg}` : REQUEST_FAILED;
}

function envelopeFailure(body: unknown): string | undefined {
  const code = fieldOf(body, 'code');
  if (code === undefined || code === 0) return undefined;
  return requestFailed(fieldOf(body, 'msg'));
}

function quotaUsages(body: unknown): Record<string, unknown> {
  const data = fieldOf(body, 'data');
  if (fieldOf(data, 'kind') !== 'ok') throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  const usages = fieldOf(fieldOf(data, 'quota'), 'usages');
  if (!isRecord(usages)) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return usages;
}

function usedPctOf(ratio: unknown): number | undefined {
  return isCount(ratio) ? Math.min(FULL_PCT, Math.round(FULL_PCT * ratio)) : undefined;
}

function windowFrom(entry: unknown, identity: Pick<UsageWindow, 'label' | 'kind'>, resetsAt?: string): UsageWindow[] {
  const usedPct = usedPctOf(fieldOf(entry, 'usedRatio'));
  return usedPct === undefined ? [] : [withReset({ ...identity, usedPct }, resetsAt)];
}

function weeklyFrom(entry: unknown): UsageWindow[] {
  return windowFrom(entry, { label: 'weekly', kind: 'weekly' }, validInstant(fieldOf(entry, 'resetAt')));
}

function rollingFrom(entry: unknown): UsageWindow[] {
  return windowFrom(entry, { label: '5h', kind: 'rolling' });
}

function windowsOf(usages: Record<string, unknown>): UsageWindow[] {
  const windows = [...weeklyFrom(fieldOf(usages, 'limit7d')), ...rollingFrom(fieldOf(usages, 'limit5h'))];
  if (windows.length === 0) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return windows;
}

function parseUsage(body: string): UsageWindow[] {
  const parsed = parseJson(body);
  const failure = envelopeFailure(parsed);
  if (failure !== undefined) throw new ProbeUnavailable(failure);
  return windowsOf(quotaUsages(parsed));
}

async function readKimi(io: KimiIo, env: Record<string, string | undefined>): Promise<UsageWindow[]> {
  const port = parsePort(env['DANDELION_KIMI_PORT']);
  const child = await io.launcher.launch('kimi', ['web', '--no-open', '--port', String(port)]);
  if (child === undefined) throw new ProbeUnavailable('kimi CLI not found in PATH');
  try {
    return parseUsage(await requestUsage(io.fetcher, port, await waitForToken(child, 0)));
  } finally {
    await child.stop();
  }
}

export async function probeKimi(io: KimiIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage> {
  const usage = { id: 'kimi', displayName: 'kimi', planLabel: 'kimi code', fetchedAt: now };
  try {
    return { ...usage, windows: await readKimi(io, env), status: 'ok' };
  } catch (error) {
    return { ...usage, windows: [], status: 'unavailable', reason: unavailableReason(error) };
  }
}
