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
  return successBody(outcome, 'kimi usage request', REQUEST_TIMEOUT_MS);
}

function percentOf(entry: unknown): number | undefined {
  const used = fieldOf(entry, 'used');
  const limit = fieldOf(entry, 'limit');
  if (!isCount(used) || !isCount(limit) || limit === 0) return undefined;
  return Math.round((used * 100) / limit);
}

function weeklyWindow(summary: unknown): UsageWindow {
  const usedPct = percentOf(summary);
  if (usedPct === undefined) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  const resetsAt = validInstant(fieldOf(summary, 'reset_at'));
  return withReset({ label: 'weekly', kind: 'weekly', usedPct }, resetsAt);
}

function hourWindow(entry: unknown): UsageWindow[] {
  const hourly = fieldOf(fieldOf(entry, 'window'), 'unit') === 'hour';
  const usedPct = hourly ? percentOf(entry) : undefined;
  return usedPct === undefined ? [] : [{ label: '5h', kind: 'rolling', usedPct }];
}

function hourWindows(limits: unknown): UsageWindow[] {
  return Array.isArray(limits) ? limits.flatMap(hourWindow) : [];
}

function parseUsage(body: string): UsageWindow[] {
  const data = fieldOf(JSON.parse(body), 'data');
  return [weeklyWindow(fieldOf(data, 'summary')), ...hourWindows(fieldOf(data, 'limits'))];
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
