import {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  successBody,
  unavailableReason,
  validInstant,
  withReset,
  type Fetcher,
  type FileReader,
  type ProviderUsage,
  type UsageWindow
} from '../domain/index.ts';

export type OllamaIo = { reader: FileReader; fetcher: Pick<Fetcher, 'get'> };

type Env = Record<string, string | undefined>;

type Meter = { name: string; label: string; kind: UsageWindow['kind'] };

const ID = 'claude-ollama';
const PLAN = 'claude · ollama';
const NO_CONFIG = 'no ollama config — CLAUDE_CONFIG_DIR=~/.claude-ollama claude';
const NO_SESSION = 'no ollama.com session — save __Secure-session in ollama-session';
const SIGNED_OUT = 'ollama.com session expired — replace ollama-session';
const SESSION_FILE = 'ollama-session';
const COOKIE_NAME = '__Secure-session';
const SETTINGS_URL = 'https://ollama.com/settings';
const TIMEOUT_MS = 10000;
const REQUEST = 'ollama.com settings request';
const SIGN_IN_TITLE = '<title>Sign in</title>';
const RESET = /data-time="([^"]+)"/;
const METERS: readonly Meter[] = [
  { name: 'Session', label: 'session', kind: 'rolling' },
  { name: 'Weekly', label: 'weekly', kind: 'weekly' }
];

function configDir(env: Env, homeDir: string): string {
  return env['DANDELION_CLAUDE_OLLAMA_CONFIG_DIR'] || `${homeDir}/.claude-ollama`;
}

function cookieOf(text: string | undefined): string {
  return (text ?? '').trim().replace(`${COOKIE_NAME}=`, '');
}

async function readCookie(reader: FileReader, dir: string): Promise<string> {
  if (!(await reader.isDirectory(dir))) throw new ProbeUnavailable(NO_CONFIG);
  const cookie = cookieOf(await reader.read(`${dir}/${SESSION_FILE}`));
  if (cookie === '') throw new ProbeUnavailable(NO_SESSION);
  return cookie;
}

function resetAfter(html: string, from: number): string | undefined {
  const instant = validInstant(RESET.exec(html.slice(from))?.[1]);
  return instant === undefined ? undefined : new Date(instant).toISOString();
}

function meterOf(html: string, meter: Meter): UsageWindow {
  const match = new RegExp(`aria-label="${meter.name} usage (\\d+(?:\\.\\d+)?)% used"`).exec(html);
  if (match === null) throw new ProbeUnavailable(USAGE_PARSE_FAILURE);
  return withReset({ label: meter.label, kind: meter.kind, usedPct: Number(match[1]) }, resetAfter(html, match.index));
}

function windowsOf(html: string): UsageWindow[] {
  if (html.includes(SIGN_IN_TITLE)) throw new ProbeUnavailable(SIGNED_OUT);
  return METERS.map((meter) => meterOf(html, meter));
}

async function readWindows(io: OllamaIo, env: Env): Promise<UsageWindow[]> {
  const cookie = await readCookie(io.reader, configDir(env, io.reader.homeDir()));
  const headers = { Cookie: `${COOKIE_NAME}=${cookie}`, Accept: 'text/html', 'User-Agent': 'dandelion' };
  return windowsOf(successBody(await io.fetcher.get(SETTINGS_URL, headers, TIMEOUT_MS), REQUEST, TIMEOUT_MS));
}

export async function probeClaudeOllama(io: OllamaIo, env: Env, now: string): Promise<ProviderUsage> {
  const usage = { id: ID, displayName: ID, planLabel: PLAN, fetchedAt: now };
  try {
    return { ...usage, windows: await readWindows(io, env), status: 'ok' };
  } catch (error) {
    return { ...usage, windows: [], status: 'unavailable', reason: unavailableReason(error) };
  }
}
