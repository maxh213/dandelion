import {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  fieldOf,
  isFilled,
  parseJson,
  successBody,
  unavailableFix,
  unavailableReason,
  usedPctFromRemaining,
  withReset,
  type Fetcher,
  type FileReader,
  type ProviderUsage,
  type UsageWindow
} from '../domain/index.ts';

export type DeepseekIo = { reader: FileReader; fetcher: Pick<Fetcher, 'get'> };

type Env = Record<string, string | undefined>;

type AccountUsage = { planLabel: string; windows: UsageWindow[] };

const ID = 'claude-deepseek';
const PLAN = 'claude · deepseek';
const NO_CONFIG = 'no deepseek config — CLAUDE_CONFIG_DIR=~/.claude-deepseek claude';
const NO_LIMIT = 'openrouter key has no spending limit';
const KEY_URL = 'https://openrouter.ai/api/v1/key';
const TIMEOUT_MS = 10000;
const REQUEST = 'openrouter key request';
const PERIODS = new Set(['daily', 'weekly', 'monthly']);

function configDir(env: Env, homeDir: string): string {
  return env['DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR'] || `${homeDir}/.claude-deepseek`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function noConfig(dir: string): ProbeUnavailable {
  return new ProbeUnavailable(NO_CONFIG, { command: 'claude', args: [], env: { CLAUDE_CONFIG_DIR: dir } });
}

function tokenOf(settings: unknown, dir: string): string {
  const token = fieldOf(fieldOf(settings, 'env'), 'ANTHROPIC_AUTH_TOKEN');
  if (!isFilled(token)) throw noConfig(dir);
  return token;
}

async function readToken(reader: FileReader, dir: string): Promise<string> {
  if (!(await reader.isDirectory(dir))) throw noConfig(dir);
  const text = await reader.read(`${dir}/settings.json`);
  try {
    return tokenOf(parseJson(String(text)), dir);
  } catch (error) {
    if (error instanceof ProbeUnavailable) throw error;
    throw noConfig(dir);
  }
}

function limitOf(value: unknown): number | null {
  if (value === null) return null;
  const limit = finiteNumber(value);
  if (limit === undefined || limit <= 0) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return limit;
}

function remainingOf(value: unknown): number {
  const remaining = finiteNumber(value);
  if (remaining === undefined) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return Math.max(0, remaining);
}

function periodOf(reset: unknown): string {
  return typeof reset === 'string' && PERIODS.has(reset) ? reset : 'limit';
}

function utcMidnight(now: Date, dayOffset: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset)).toISOString();
}

function weeklyReset(now: Date): string {
  const add = (8 - now.getUTCDay()) % 7 || 7;
  return utcMidnight(now, add);
}

function monthlyReset(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function resetsAt(reset: unknown, now: string): string | undefined {
  const instant = new Date(now);
  if (reset === 'daily') return utcMidnight(instant, 1);
  if (reset === 'weekly') return weeklyReset(instant);
  return reset === 'monthly' ? monthlyReset(instant) : undefined;
}

function money(period: string, remaining: number, limit: number): string {
  return `${period} · $${remaining.toFixed(2)} of $${limit.toFixed(2)}`;
}

function windowOf(period: string, remaining: number, limit: number, reset: string | undefined): UsageWindow {
  return withReset({ label: period, kind: 'weekly', usedPct: usedPctFromRemaining(remaining, limit) }, reset);
}

function usageFrom(data: unknown, now: string): AccountUsage {
  const limit = limitOf(fieldOf(data, 'limit'));
  if (limit === null) throw new ProbeUnavailable(NO_LIMIT);
  const remaining = remainingOf(fieldOf(data, 'limit_remaining'));
  const reset = fieldOf(data, 'limit_reset');
  const period = periodOf(reset);
  return { planLabel: money(period, remaining, limit), windows: [windowOf(period, remaining, limit, resetsAt(reset, now))] };
}

function accountOf(body: string, now: string): AccountUsage {
  return usageFrom(fieldOf(parseJson(body), 'data'), now);
}

async function readAccount(io: DeepseekIo, env: Env, now: string): Promise<AccountUsage> {
  const token = await readToken(io.reader, configDir(env, io.reader.homeDir()));
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'dandelion' };
  const outcome = await io.fetcher.get(KEY_URL, headers, TIMEOUT_MS);
  return accountOf(successBody(outcome, REQUEST, TIMEOUT_MS), now);
}

export async function probeClaudeDeepseek(io: DeepseekIo, env: Env, now: string): Promise<ProviderUsage> {
  const usage = { id: ID, displayName: ID, fetchedAt: now };
  try {
    return { ...usage, ...(await readAccount(io, env, now)), status: 'ok' };
  } catch (error) {
    return { ...usage, planLabel: PLAN, windows: [], status: 'unavailable', reason: unavailableReason(error), ...unavailableFix(error) };
  }
}
