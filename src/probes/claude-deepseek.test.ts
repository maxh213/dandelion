import { describe, expect, it } from 'vitest';
import type { FetchOutcome } from '../domain/index.ts';
import { probeClaudeDeepseek, type DeepseekIo } from './claude-deepseek.ts';

const NOW = '2026-10-01T15:00:00.000Z';
const MONDAY = '2026-10-05T00:00:00.000Z';
const TOKEN = 'sk-or-v1-test-token';
const DIR = '/cfg';
const ENV = { DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR: DIR };
const NO_CONFIG = 'no deepseek config — CLAUDE_CONFIG_DIR=~/.claude-deepseek claude';
const NO_LIMIT = 'openrouter key has no spending limit';
const PARSE_FAILURE = 'Could not parse usage from response';
const KEY_URL = 'https://openrouter.ai/api/v1/key';

type Answer = FetchOutcome | Promise<FetchOutcome>;

function answer(value: unknown, status = 200): FetchOutcome {
  return { status, body: typeof value === 'string' ? value : JSON.stringify(value) };
}

function keyBody(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      limit: 20,
      limit_reset: 'monthly',
      limit_remaining: 10,
      usage: 99,
      usage_monthly: 99,
      include_byok_in_limit: true,
      ...overrides
    }
  };
}

function settings(token: unknown = TOKEN): string {
  return JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', ANTHROPIC_AUTH_TOKEN: token, ANTHROPIC_API_KEY: '' } });
}

function ioOf(files: Record<string, string>, dirs: string[] = [DIR], keyAnswer: Answer = answer(keyBody())) {
  const requests: [string, Record<string, string>, number][] = [];
  const reads: string[] = [];
  const io: DeepseekIo = {
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
        return keyAnswer;
      }
    }
  };
  return { io, requests, reads };
}

function unavailable(reason: string) {
  return { id: 'claude-deepseek', displayName: 'claude-deepseek', planLabel: 'claude · deepseek', fetchedAt: NOW, windows: [], status: 'unavailable', reason };
}

function okUsage(windows: unknown[], planLabel: string, now = NOW) {
  return { id: 'claude-deepseek', displayName: 'claude-deepseek', fetchedAt: now, planLabel, windows, status: 'ok' };
}

describe('probeClaudeDeepseek', () => {
  it('keeps the missing-config reason on one dashboard line', () => {
    expect([...NO_CONFIG].length).toBeLessThanOrEqual(72);
  });

  it('reads the spending window from limit and limit_remaining, ignoring usage', async () => {
    const { io, reads } = ioOf({ [`${DIR}/settings.json`]: settings() });
    const window = { label: 'monthly', kind: 'weekly', usedPct: 50, resetsAt: '2026-11-01T00:00:00.000Z' };
    expect(await probeClaudeDeepseek(io, ENV, NOW)).toStrictEqual(okUsage([window], 'monthly · $10.00 of $20.00'));
    expect(reads).toEqual([`${DIR}/settings.json`]);
  });

  it('GETs the key with the bearer token, JSON accept, a dandelion user agent and a 10s timeout', async () => {
    const { io, requests } = ioOf({ [`${DIR}/settings.json`]: settings() });
    await probeClaudeDeepseek(io, ENV, NOW);
    expect(requests).toEqual([[KEY_URL, { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', 'User-Agent': 'dandelion' }, 10000]]);
  });

  it.each([[{}], [{ DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR: '' }]])('defaults the config dir for %j', async (env) => {
    const dir = '/home/tester/.claude-deepseek';
    const { io, reads, requests } = ioOf({ [`${dir}/settings.json`]: settings('home-token') }, [dir]);
    const usage = await probeClaudeDeepseek(io, env, NOW);
    expect(reads).toEqual([`${dir}/settings.json`]);
    expect(requests[0]?.[1].Authorization).toBe('Bearer home-token');
    expect(usage).toMatchObject({ status: 'ok', planLabel: 'monthly · $10.00 of $20.00' });
  });

  it.each<[string, unknown, unknown, string | null, Record<string, unknown>]>([
    ['half of an odd limit', 10.25, 20.5, 'monthly', { label: 'monthly', kind: 'weekly', usedPct: 50, resetsAt: '2026-11-01T00:00:00.000Z' }],
    ['nothing remaining', 0, 20, 'monthly', { label: 'monthly', kind: 'weekly', usedPct: 100, resetsAt: '2026-11-01T00:00:00.000Z' }],
    ['remaining above the limit', 20.004, 20, 'monthly', { label: 'monthly', kind: 'weekly', usedPct: 0, resetsAt: '2026-11-01T00:00:00.000Z' }],
    ['a negative remaining clamped to zero', -1.2, 20, 'monthly', { label: 'monthly', kind: 'weekly', usedPct: 100, resetsAt: '2026-11-01T00:00:00.000Z' }],
    ['a daily reset', 10, 20, 'daily', { label: 'daily', kind: 'weekly', usedPct: 50, resetsAt: '2026-10-02T00:00:00.000Z' }],
    ['a weekly reset', 10, 20, 'weekly', { label: 'weekly', kind: 'weekly', usedPct: 50, resetsAt: '2026-10-05T00:00:00.000Z' }],
    ['a null reset', 10, 20, null, { label: 'limit', kind: 'weekly', usedPct: 50 }],
    ['an unknown reset', 10, 20, 'yearly', { label: 'limit', kind: 'weekly', usedPct: 50 }]
  ])('reads a key with %s', async (_case, remaining, limit, reset, window) => {
    const body = keyBody({ limit_remaining: remaining, limit, limit_reset: reset });
    const { io } = ioOf({ [`${DIR}/settings.json`]: settings() }, [DIR], answer(body));
    const period = window.label;
    expect(await probeClaudeDeepseek(io, ENV, NOW)).toStrictEqual(okUsage([window], `${period} · $${Number(remaining) < 0 ? '0.00' : Number(remaining).toFixed(2)} of $${Number(limit).toFixed(2)}`));
  });

  it.each<[string, string, string]>([
    ['the following Monday when now is exactly Monday midnight', MONDAY, '2026-10-12T00:00:00.000Z'],
    ['the following Monday after Monday has started', '2026-10-05T15:00:00.000Z', '2026-10-12T00:00:00.000Z'],
    ['the next Monday from Sunday', '2026-10-04T23:00:00.000Z', '2026-10-05T00:00:00.000Z'],
    ['the next month from December', '2026-12-15T00:00:00.000Z', '2027-01-01T00:00:00.000Z']
  ])('resets %s', async (_case, now, resetsAt) => {
    const reset = now.startsWith('2026-12') ? 'monthly' : 'weekly';
    const { io } = ioOf({ [`${DIR}/settings.json`]: settings() }, [DIR], answer(keyBody({ limit_reset: reset })));
    expect(await probeClaudeDeepseek(io, ENV, now)).toMatchObject({ windows: [{ resetsAt }] });
  });

  it('is unavailable with no window when the key has a null limit', async () => {
    const { io } = ioOf({ [`${DIR}/settings.json`]: settings() }, [DIR], answer(keyBody({ limit: null })));
    expect(await probeClaudeDeepseek(io, ENV, NOW)).toStrictEqual(unavailable(NO_LIMIT));
  });

  it.each<[string, unknown]>([
    ['a missing limit', keyBody({ limit: undefined })],
    ['a zero limit', keyBody({ limit: 0 })],
    ['a negative limit', keyBody({ limit: -5 })],
    ['a string limit', keyBody({ limit: '20' })],
    ['an infinite limit', '{"data":{"limit":1e309,"limit_reset":"monthly","limit_remaining":10}}'],
    ['a missing remaining', keyBody({ limit_remaining: undefined })],
    ['a string remaining', keyBody({ limit_remaining: '10' })],
    ['a non-finite remaining', keyBody({ limit_remaining: Number.NaN })],
    ['no data object', { data: null }],
    ['a data array', { data: [] }],
    ['not JSON', 'nope'],
    ['an empty body', '']
  ])('cannot parse %s', async (_case, body) => {
    const { io } = ioOf({ [`${DIR}/settings.json`]: settings() }, [DIR], answer(body));
    expect(await probeClaudeDeepseek(io, ENV, NOW)).toStrictEqual(unavailable(PARSE_FAILURE));
  });

  it.each<[string, FetchOutcome, string]>([
    ['an HTTP error', { status: 403, body: `secret ${TOKEN}` }, 'openrouter key request failed: HTTP 403'],
    ['a network error', { failure: 'network' }, 'openrouter key request failed'],
    ['a timeout', { failure: 'timeout' }, 'openrouter key request timed out after 10s']
  ])('reports %s without the response body', async (_case, outcome, reason) => {
    const { io } = ioOf({ [`${DIR}/settings.json`]: settings() }, [DIR], outcome);
    const usage = await probeClaudeDeepseek(io, ENV, NOW);
    expect(usage).toStrictEqual(unavailable(reason));
    expect(JSON.stringify(usage)).not.toContain(TOKEN);
  });

  it.each<[string, Record<string, string>, string[]]>([
    ['a missing directory', {}, []],
    ['a missing settings file', {}, [DIR]],
    ['settings that are not JSON', { [`${DIR}/settings.json`]: '{' }, [DIR]],
    ['settings with no env', { [`${DIR}/settings.json`]: '{}' }, [DIR]],
    ['an empty token', { [`${DIR}/settings.json`]: settings('') }, [DIR]],
    ['a missing token', { [`${DIR}/settings.json`]: JSON.stringify({ env: { ANTHROPIC_API_KEY: '' } }) }, [DIR]],
    ['a JSON array', { [`${DIR}/settings.json`]: '["token"]' }, [DIR]]
  ])('is unavailable without a request for %s', async (_case, files, dirs) => {
    const { io, requests } = ioOf(files, dirs);
    expect(await probeClaudeDeepseek(io, ENV, NOW)).toStrictEqual({ ...unavailable(NO_CONFIG), fix: { command: 'claude', args: [], env: { CLAUDE_CONFIG_DIR: DIR } } });
    expect(requests).toEqual([]);
  });

  it('offers the fix for the default config dir', async () => {
    const { io } = ioOf({}, []);
    expect(await probeClaudeDeepseek(io, {}, NOW)).toMatchObject({ fix: { command: 'claude', args: [], env: { CLAUDE_CONFIG_DIR: '/home/tester/.claude-deepseek' } } });
  });

  it('has no fix when ok or when the key has no limit', async () => {
    const ok = ioOf({ [`${DIR}/settings.json`]: settings() });
    expect(await probeClaudeDeepseek(ok.io, ENV, NOW)).not.toHaveProperty('fix');
    const noLimit = ioOf({ [`${DIR}/settings.json`]: settings() }, [DIR], answer(keyBody({ limit: null })));
    expect(await probeClaudeDeepseek(noLimit.io, ENV, NOW)).not.toHaveProperty('fix');
  });

  it('reports a thrown request as a parse failure and does not print the token', async () => {
    const io = ioOf({ [`${DIR}/settings.json`]: settings() }).io;
    io.fetcher.get = async () => {
      throw new Error(`boom ${TOKEN}`);
    };
    const usage = await probeClaudeDeepseek(io, ENV, NOW);
    expect(usage).toStrictEqual(unavailable(PARSE_FAILURE));
    expect(JSON.stringify(usage)).not.toContain(TOKEN);
  });
});
