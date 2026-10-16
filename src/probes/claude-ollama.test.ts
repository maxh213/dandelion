import { describe, expect, it } from 'vitest';
import type { FetchOutcome } from '../domain/index.ts';
import { probeClaudeOllama, type OllamaIo } from './claude-ollama.ts';

const NOW = '2026-10-16T15:00:00.000Z';
const COOKIE = 'cookie-secret-value';
const DIR = '/cfg';
const SESSION_FILE = `${DIR}/ollama-session`;
const ENV = { DANDELION_CLAUDE_OLLAMA_CONFIG_DIR: DIR };
const NO_CONFIG = 'no ollama config — CLAUDE_CONFIG_DIR=~/.claude-ollama claude';
const NO_SESSION = 'no ollama.com session — save __Secure-session in ollama-session';
const SIGNED_OUT = 'ollama.com session expired — replace ollama-session';
const PARSE_FAILURE = 'Could not parse usage from response';
const SETTINGS_URL = 'https://ollama.com/settings';

type Answer = FetchOutcome | Promise<FetchOutcome>;

function meter(name: string, used: string, reset?: string): string {
  const time = reset === undefined ? '' : `<div class="text-xs local-time" data-time="${reset}">Resets soon.</div>`;
  return `<div><span>${name} usage</span><span>${used}% used</span><div data-usage-track aria-label="${name} usage ${used}% used"></div>${time}</div>`;
}

function page(...meters: string[]): string {
  return `<html><head><title>Usage · Settings</title></head><body>${meters.join('')}</body></html>`;
}

const SETTINGS = page(meter('Session', '10.5', '2026-10-16T17:00:00Z'), meter('Weekly', '83.3', '2026-10-19T00:00:00Z'));

function answer(body: string, status = 200): FetchOutcome {
  return { status, body };
}

function ioOf(files: Record<string, string>, dirs: string[] = [DIR], settingsAnswer: Answer = answer(SETTINGS)) {
  const requests: [string, Record<string, string>, number][] = [];
  const reads: string[] = [];
  const io: OllamaIo = {
    reader: {
      homeDir: () => '/home/tester',
      read: async (path) => {
        reads.push(path);
        return files[path];
      },
      isDirectory: async (path) => dirs.includes(path)
    },
    fetcher: {
      get: async (url, headers, timeoutMs) => {
        requests.push([url, headers, timeoutMs]);
        return settingsAnswer;
      }
    }
  };
  return { io, requests, reads };
}

function unavailable(reason: string) {
  return { id: 'claude-ollama', displayName: 'claude-ollama', planLabel: 'claude · ollama', fetchedAt: NOW, windows: [], status: 'unavailable', reason };
}

function okUsage(windows: unknown[]) {
  return { id: 'claude-ollama', displayName: 'claude-ollama', planLabel: 'claude · ollama', fetchedAt: NOW, windows, status: 'ok' };
}

const SESSION = { label: 'session', kind: 'rolling', usedPct: 10.5, resetsAt: '2026-10-16T17:00:00.000Z' };
const WEEKLY = { label: 'weekly', kind: 'weekly', usedPct: 83.3, resetsAt: '2026-10-19T00:00:00.000Z' };

describe('probeClaudeOllama', () => {
  it.each([NO_CONFIG, NO_SESSION, SIGNED_OUT])('keeps %s on one dashboard line', (reason) => {
    expect([...reason].length).toBeLessThanOrEqual(72);
  });

  it('reads the session window as rolling and the weekly window as weekly, each with the reset after it', async () => {
    const { io, reads } = ioOf({ [SESSION_FILE]: COOKIE });
    expect(await probeClaudeOllama(io, ENV, NOW)).toStrictEqual(okUsage([SESSION, WEEKLY]));
    expect(reads).toEqual([SESSION_FILE]);
  });

  it('GETs the settings page with the session cookie, an HTML accept, a dandelion user agent and a 10s timeout', async () => {
    const { io, requests } = ioOf({ [SESSION_FILE]: `  ${COOKIE}\n` });
    await probeClaudeOllama(io, ENV, NOW);
    expect(requests).toEqual([[SETTINGS_URL, { Cookie: `__Secure-session=${COOKIE}`, Accept: 'text/html', 'User-Agent': 'dandelion' }, 10000]]);
  });

  it('accepts a session file that keeps the cookie name', async () => {
    const { io, requests } = ioOf({ [SESSION_FILE]: `__Secure-session=${COOKIE}\n` });
    await probeClaudeOllama(io, ENV, NOW);
    expect(requests[0]?.[1].Cookie).toBe(`__Secure-session=${COOKIE}`);
  });

  it.each([[{}], [{ DANDELION_CLAUDE_OLLAMA_CONFIG_DIR: '' }]])('defaults the config dir for %j', async (env) => {
    const dir = '/home/tester/.claude-ollama';
    const { io, reads } = ioOf({ [`${dir}/ollama-session`]: COOKIE }, [dir]);
    expect(await probeClaudeOllama(io, env, NOW)).toMatchObject({ status: 'ok' });
    expect(reads).toEqual([`${dir}/ollama-session`]);
  });

  it('reads whole-number percents and leaves out a missing or invalid reset', async () => {
    const body = page(meter('Session', '84'), meter('Weekly', '7', 'soon'));
    const { io } = ioOf({ [SESSION_FILE]: COOKIE }, [DIR], answer(body));
    expect(await probeClaudeOllama(io, ENV, NOW)).toStrictEqual(okUsage([{ label: 'session', kind: 'rolling', usedPct: 84 }, { label: 'weekly', kind: 'weekly', usedPct: 7 }]));
  });

  it('ignores a reset that comes before the meter', async () => {
    const body = page('<div data-time="2026-10-16T16:00:00Z"></div>', meter('Session', '1'), meter('Weekly', '2', '2026-10-19T00:00:00Z'));
    const { io } = ioOf({ [SESSION_FILE]: COOKIE }, [DIR], answer(body));
    expect(await probeClaudeOllama(io, ENV, NOW)).toMatchObject({ windows: [{ label: 'session', resetsAt: '2026-10-19T00:00:00.000Z' }, { label: 'weekly' }] });
  });

  it('is unavailable without a read or a request when the config dir is missing', async () => {
    const { io, reads, requests } = ioOf({ [SESSION_FILE]: COOKIE }, []);
    expect(await probeClaudeOllama(io, ENV, NOW)).toStrictEqual(unavailable(NO_CONFIG));
    expect(reads).toEqual([]);
    expect(requests).toEqual([]);
  });

  it.each<[string, Record<string, string>]>([
    ['a missing session file', {}],
    ['an empty session file', { [SESSION_FILE]: ' \n' }],
    ['a session file with only the cookie name', { [SESSION_FILE]: '__Secure-session=' }]
  ])('is unavailable without a request for %s', async (_case, files) => {
    const { io, requests } = ioOf(files);
    expect(await probeClaudeOllama(io, ENV, NOW)).toStrictEqual(unavailable(NO_SESSION));
    expect(requests).toEqual([]);
  });

  it('says the session expired when ollama.com answers with its sign-in page', async () => {
    const { io } = ioOf({ [SESSION_FILE]: COOKIE }, [DIR], answer('<html><head><title>Sign in</title></head></html>'));
    expect(await probeClaudeOllama(io, ENV, NOW)).toStrictEqual(unavailable(SIGNED_OUT));
  });

  it.each<[string, string]>([
    ['no session meter', page(meter('Weekly', '83.3'))],
    ['no weekly meter', page(meter('Session', '10.5'))],
    ['a meter without a number', page(meter('Session', 'ten'), meter('Weekly', '83.3'))],
    ['an empty body', '']
  ])('cannot parse %s', async (_case, body) => {
    const { io } = ioOf({ [SESSION_FILE]: COOKIE }, [DIR], answer(body));
    expect(await probeClaudeOllama(io, ENV, NOW)).toStrictEqual(unavailable(PARSE_FAILURE));
  });

  it.each<[string, FetchOutcome, string]>([
    ['an HTTP error', { status: 403, body: `secret ${COOKIE}` }, 'ollama.com settings request failed: HTTP 403'],
    ['a network error', { failure: 'network' }, 'ollama.com settings request failed'],
    ['a timeout', { failure: 'timeout' }, 'ollama.com settings request timed out after 10s']
  ])('reports %s without the response body or the cookie', async (_case, outcome, reason) => {
    const { io } = ioOf({ [SESSION_FILE]: COOKIE }, [DIR], outcome);
    const usage = await probeClaudeOllama(io, ENV, NOW);
    expect(usage).toStrictEqual(unavailable(reason));
    expect(JSON.stringify(usage)).not.toContain(COOKIE);
  });

  it('reports a thrown request as a parse failure and does not print the cookie', async () => {
    const io = ioOf({ [SESSION_FILE]: COOKIE }).io;
    io.fetcher.get = async () => {
      throw new Error(`boom ${COOKIE}`);
    };
    const usage = await probeClaudeOllama(io, ENV, NOW);
    expect(usage).toStrictEqual(unavailable(PARSE_FAILURE));
    expect(JSON.stringify(usage)).not.toContain(COOKIE);
  });
});
