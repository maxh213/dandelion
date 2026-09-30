import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchOutcome, FileReader } from '../domain/index.ts';
import { probeKimi, type KimiIo, type LaunchedProcess, type Launcher } from './kimi.ts';

const NOW = '2026-09-13T10:00:00Z';
const WEEKLY_RESET = '2026-09-18T10:00:00Z';
const ROLLING_RESET = '2026-09-13T15:00:00Z';
const HAPPY_USAGES = {
  limit5h: { usedRatio: 0.42, resetAt: ROLLING_RESET },
  limit7d: { usedRatio: 0.59, resetAt: WEEKLY_RESET }
};
const LIVE = {
  code: 0,
  msg: 'success',
  data: {
    kind: 'ok',
    quota: {
      usages: {
        limit5h: { usedRatio: 0, resetAt: '2026-09-19T14:58:50Z' },
        limit7d: { usedRatio: 0, resetAt: '2026-09-25T12:58:50Z' }
      },
      extraUsage: null
    }
  },
  request_id: '01M2WR59QVZ5WJFMF4A6TWESJB'
};

function envelope(usages: unknown = HAPPY_USAGES): Record<string, unknown> {
  return {
    code: 0,
    msg: 'success',
    data: { kind: 'ok', quota: { usages, extraUsage: null } },
    request_id: '01M2WR59QVZ5WJFMF4A6TWESJB'
  };
}

const BODY = JSON.stringify(envelope());
const WEEKLY_59 = { label: 'weekly', kind: 'weekly', usedPct: 59, resetsAt: WEEKLY_RESET };
const ROLLING_42_BARE = { label: '5h', kind: 'rolling', usedPct: 42 };
const ROLLING_42 = { ...ROLLING_42_BARE, resetsAt: ROLLING_RESET };
const OK_WINDOWS = [WEEKLY_59, ROLLING_42];

type FakeChild = LaunchedProcess & { log: string; exited: boolean; stops: number };

function fakeChild(log = 'kimi web ready: http://127.0.0.1:48123/?token=test-token', exited = false): FakeChild {
  const child: FakeChild = {
    log,
    exited,
    stops: 0,
    output: async () => child.log,
    hasExited: () => child.exited,
    stop: async () => {
      child.stops += 1;
    }
  };
  return child;
}

function readerOf(files: Record<string, string> = {}): FileReader {
  return { homeDir: () => '/home/tester', read: async (path) => files[path], isDirectory: async () => false };
}

function ioWith(child: FakeChild | undefined, outcome: FetchOutcome = { status: 200, body: BODY }, files: Record<string, string> = {}) {
  const launches: [string, string[]][] = [];
  const requests: [string, Record<string, string>, number][] = [];
  const launcher: Launcher = {
    launch: async (command, args) => {
      launches.push([command, args]);
      if (args[0] !== 'web' || args[1] !== '--no-open') return undefined;
      return child;
    }
  };
  const fetcher: KimiIo['fetcher'] = {
    get: async (url, headers, timeoutMs) => {
      requests.push([url, headers, timeoutMs]);
      return outcome;
    }
  };
  const io: KimiIo = { launcher, fetcher, reader: readerOf(files) };
  return { io, launches, requests };
}

function bodyOf(value: unknown): FetchOutcome {
  return { status: 200, body: typeof value === 'string' ? value : JSON.stringify(value) };
}

const PORT = { DANDELION_KIMI_PORT: '48123' };
const PARSE_FAILURE = 'Could not parse usage from response';

afterEach(() => {
  vi.useRealTimers();
});

describe('probeKimi', () => {
  it('launches kimi web on the port and requests usage with the bearer token', async () => {
    const child = fakeChild();
    const { io, launches, requests } = ioWith(child);
    const usage = await probeKimi(io, PORT, NOW);
    expect(launches).toEqual([['kimi', ['web', '--no-open', '--port', '48123']]]);
    expect(requests).toEqual([
      ['http://127.0.0.1:48123/api/v1/oauth/usage', { Authorization: 'Bearer test-token' }, 10000]
    ]);
    expect(usage).toStrictEqual({
      id: 'kimi',
      displayName: 'kimi',
      planLabel: 'kimi code',
      fetchedAt: NOW,
      status: 'ok',
      windows: [
        { label: 'weekly', kind: 'weekly', usedPct: 59, resetsAt: '2026-09-18T10:00:00Z' },
        { label: '5h', kind: 'rolling', usedPct: 42, resetsAt: '2026-09-13T15:00:00Z' }
      ]
    });
    expect(child.stops).toBe(1);
  });

  it('fails immediately instead of waiting for a token when launch argv is empty', async () => {
    const child = fakeChild('');
    const launcher: Launcher = {
      launch: async (command, args) => {
        if (command !== 'kimi' || args[0] !== 'web' || args[1] !== '--no-open') {
          child.exited = true;
          return child;
        }
        child.log = 'token=test-token';
        return child;
      }
    };
    const fetcher: KimiIo['fetcher'] = { get: async () => ({ status: 200, body: BODY }) };
    const usage = await probeKimi({ launcher, fetcher, reader: readerOf() }, PORT, NOW);
    expect(usage.status).toBe('ok');
    expect(usage.windows).toStrictEqual(OK_WINDOWS);
    expect(child.exited).toBe(false);
  });

  it('stops the child before resolving', async () => {
    let stopped = false;
    const child = fakeChild();
    child.stop = () => new Promise((resolve) => setTimeout(() => { stopped = true; resolve(); }, 5));
    await probeKimi(ioWith(child).io, PORT, NOW);
    expect(stopped).toBe(true);
  });

  it.each([
    ['Local: http://127.0.0.1:48123/#token=abc.D-9_z'],
    ['open http://127.0.0.1:48123/?token=abc.D-9_z'],
    ['Authorization: Bearer abc.D-9_z']
  ])('finds the token in "%s"', async (log) => {
    const { io, requests } = ioWith(fakeChild(log));
    const usage = await probeKimi(io, PORT, NOW);
    expect(requests[0][1]).toEqual({ Authorization: 'Bearer abc.D-9_z' });
    expect(usage.status).toBe('ok');
    expect(JSON.stringify(usage)).not.toContain('abc.D-9_z');
  });

  it('parses the verified live 2.0 body as 0% on both windows', async () => {
    const child = fakeChild();
    const usage = await probeKimi(ioWith(child, bodyOf(LIVE)).io, PORT, NOW);
    expect(usage).toStrictEqual({
      id: 'kimi',
      displayName: 'kimi',
      planLabel: 'kimi code',
      fetchedAt: NOW,
      status: 'ok',
      windows: [
        { label: 'weekly', kind: 'weekly', usedPct: 0, resetsAt: '2026-09-25T12:58:50Z' },
        { label: '5h', kind: 'rolling', usedPct: 0, resetsAt: '2026-09-19T14:58:50Z' }
      ]
    });
    expect(child.stops).toBe(1);
  });

  it('rounds limit7d 0.595 to 60% and keeps limit5h 0.42 at 42%', async () => {
    const usages = {
      limit5h: { usedRatio: 0.42, resetAt: ROLLING_RESET },
      limit7d: { usedRatio: 0.595, resetAt: WEEKLY_RESET }
    };
    const usage = await probeKimi(ioWith(fakeChild(), bodyOf(envelope(usages))).io, PORT, NOW);
    expect(usage.windows).toStrictEqual([
      { label: 'weekly', kind: 'weekly', usedPct: 60, resetsAt: WEEKLY_RESET },
      ROLLING_42
    ]);
  });

  it.each<[unknown, unknown[]]>([
    [envelope({ limit5h: { usedRatio: 0, resetAt: ROLLING_RESET }, limit7d: { usedRatio: 0, resetAt: WEEKLY_RESET } }), [{ label: 'weekly', kind: 'weekly', usedPct: 0, resetsAt: WEEKLY_RESET }, { label: '5h', kind: 'rolling', usedPct: 0, resetsAt: ROLLING_RESET }]],
    [envelope(), OK_WINDOWS],
    [envelope({ limit5h: { usedRatio: 1, resetAt: ROLLING_RESET }, limit7d: { usedRatio: 1, resetAt: WEEKLY_RESET } }), [{ label: 'weekly', kind: 'weekly', usedPct: 100, resetsAt: WEEKLY_RESET }, { label: '5h', kind: 'rolling', usedPct: 100, resetsAt: ROLLING_RESET }]],
    [envelope({ limit5h: { usedRatio: 0, resetAt: ROLLING_RESET }, limit7d: { usedRatio: 1.2, resetAt: WEEKLY_RESET } }), [{ label: 'weekly', kind: 'weekly', usedPct: 100, resetsAt: WEEKLY_RESET }, { label: '5h', kind: 'rolling', usedPct: 0, resetsAt: ROLLING_RESET }]],
    [envelope({ limit7d: { usedRatio: 0.59, resetAt: WEEKLY_RESET } }), [WEEKLY_59]],
    [envelope({ limit5h: { usedRatio: 0.42, resetAt: ROLLING_RESET } }), [ROLLING_42]],
    [envelope({ limit7d: { usedRatio: 0.59, resetAt: WEEKLY_RESET }, limit5h: { usedRatio: 'x', resetAt: ROLLING_RESET } }), [WEEKLY_59]],
    [envelope({ limit7d: { usedRatio: -1, resetAt: WEEKLY_RESET }, limit5h: { usedRatio: 0.42, resetAt: ROLLING_RESET } }), [ROLLING_42]],
    [envelope({ limit5h: { usedRatio: 0.42, resetAt: 'soon' } }), [ROLLING_42_BARE]],
    [envelope({ limit5h: { usedRatio: 0.42, resetAt: 42 } }), [ROLLING_42_BARE]],
    [envelope({ limit5h: { usedRatio: 0.42, resetAt: [ROLLING_RESET] } }), [ROLLING_42_BARE]],
    [envelope({ limit7d: { usedRatio: 0.59, resetAt: 'soon' } }), [{ label: 'weekly', kind: 'weekly', usedPct: 59 }]],
    [envelope({ limit7d: { usedRatio: 0.59, resetAt: 42 } }), [{ label: 'weekly', kind: 'weekly', usedPct: 59 }]],
    [envelope({ limit7d: { usedRatio: 0.59, resetAt: [WEEKLY_RESET] } }), [{ label: 'weekly', kind: 'weekly', usedPct: 59 }]],
    [envelope({ limit7d: { usedRatio: Number.POSITIVE_INFINITY, resetAt: WEEKLY_RESET }, limit5h: { usedRatio: 0.42 } }), [ROLLING_42_BARE]],
    [envelope({ limit7d: { usedRatio: Number.NaN }, limit5h: { usedRatio: 0.42 } }), [ROLLING_42_BARE]],
    [{ ...envelope(), extraUsage: { usedRatio: 0.99 } }, OK_WINDOWS],
    [{ data: { kind: 'ok', quota: { usages: HAPPY_USAGES, extraUsage: { usedRatio: 1 } } } }, OK_WINDOWS],
    [envelope({ ...HAPPY_USAGES, limit1d: { usedRatio: 0.99, resetAt: WEEKLY_RESET } }), OK_WINDOWS]
  ])('reads 2.0 variation %j', async (body, windows) => {
    const usage = await probeKimi(ioWith(fakeChild(), bodyOf(body)).io, PORT, NOW);
    expect(usage).toMatchObject({ status: 'ok' });
    expect(usage.windows).toStrictEqual(windows);
  });

  it('emits weekly then 5h even when the JSON lists limit5h first, and copies limit5h.resetAt', async () => {
    const usage = await probeKimi(ioWith(fakeChild(), bodyOf(envelope())).io, PORT, NOW);
    expect(usage.windows).toStrictEqual(OK_WINDOWS);
    expect(usage.windows[1]).toHaveProperty('resetsAt', ROLLING_RESET);
  });

  it.each<[string, FetchOutcome, string]>([
    ['no HTTP on the port', { failure: 'network' }, 'kimi usage request failed'],
    ['a hanging request', { failure: 'timeout' }, 'kimi usage request timed out after 10s'],
    ['HTTP 500', { status: 500, body: '{}' }, 'kimi usage request failed: HTTP 500'],
    ['HTTP 199', { status: 199, body: BODY }, 'kimi usage request failed: HTTP 199'],
    ['HTTP 300', { status: 300, body: BODY }, 'kimi usage request failed: HTTP 300'],
    ['code 1 with msg', bodyOf({ ...envelope(), code: 1, msg: 'quota denied' }), 'kimi usage request failed: quota denied'],
    ['code 1 with empty msg', bodyOf({ ...envelope(), code: 1, msg: '' }), 'kimi usage request failed'],
    ['code 1 without msg', bodyOf({ code: 1, data: envelope().data }), 'kimi usage request failed'],
    ['a string code 0', bodyOf({ code: '0', data: envelope().data }), 'kimi usage request failed'],
    ['a null code', bodyOf({ code: null, data: envelope().data }), 'kimi usage request failed'],
    ['truncated JSON', bodyOf('{"data":'), PARSE_FAILURE],
    ['kind error', bodyOf({ ...envelope(), data: { kind: 'error', quota: { usages: HAPPY_USAGES } } }), PARSE_FAILURE],
    ['no quota.usages', bodyOf({ ...envelope(), data: { kind: 'ok', quota: {} } }), PARSE_FAILURE],
    ['usages as an array', bodyOf({ ...envelope(), data: { kind: 'ok', quota: { usages: [] } } }), PARSE_FAILURE],
    ['the 003 summary/limits body', bodyOf({ data: { summary: { used: 590, limit: 1000 }, limits: [{ used: 42, limit: 100, window: { unit: 'hour' } }] } }), PARSE_FAILURE],
    ['both usedRatio strings', bodyOf(envelope({ limit5h: { usedRatio: '0.42' }, limit7d: { usedRatio: '0.59' } })), PARSE_FAILURE],
    ['null', bodyOf('null'), PARSE_FAILURE],
    ['an array', bodyOf('[]'), PARSE_FAILURE],
    ['null data', bodyOf({ data: null }), PARSE_FAILURE],
    ['a missing kind', bodyOf({ data: { quota: { usages: HAPPY_USAGES } } }), PARSE_FAILURE]
  ])('is unavailable and stops the child on %s', async (_case, outcome, reason) => {
    const child = fakeChild();
    const usage = await probeKimi(ioWith(child, outcome).io, PORT, NOW);
    expect(usage).toStrictEqual({
      id: 'kimi',
      displayName: 'kimi',
      planLabel: 'kimi code',
      fetchedAt: NOW,
      windows: [],
      status: 'unavailable',
      reason
    });
    expect(child.stops).toBe(1);
  });

  it('is unavailable when kimi is not on the PATH', async () => {
    const usage = await probeKimi(ioWith(undefined).io, PORT, NOW);
    expect(usage).toMatchObject({ status: 'unavailable', reason: 'kimi CLI not found in PATH' });
  });

  it('reports an early exit at once after a last read of the log', async () => {
    const child = fakeChild('', true);
    const { io, requests } = ioWith(child);
    const usage = await probeKimi(io, PORT, NOW);
    expect(usage).toMatchObject({ status: 'unavailable', reason: 'kimi web exited without printing a token' });
    expect(requests).toEqual([]);
    expect(child.stops).toBe(1);
  });

  it('uses a token printed just before the child exited', async () => {
    const usage = await probeKimi(ioWith(fakeChild('token=late', true)).io, PORT, NOW);
    expect(usage.status).toBe('ok');
  });

  it('polls the log every 500ms and gives up after 20s', async () => {
    vi.useFakeTimers();
    const child = fakeChild('');
    const reads = vi.fn(async () => child.log);
    child.output = reads;
    let settled = false;
    const probe = probeKimi(ioWith(child).io, PORT, NOW).then((usage) => {
      settled = true;
      return usage;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(reads).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(19000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(await probe).toMatchObject({ status: 'unavailable', reason: 'kimi web printed no token within 20s' });
    expect(reads).toHaveBeenCalledTimes(41);
    expect(child.stops).toBe(1);
  });

  it('stops polling once a later read finds the token', async () => {
    vi.useFakeTimers();
    const child = fakeChild('starting');
    const probe = probeKimi(ioWith(child).io, PORT, NOW);
    await vi.advanceTimersByTimeAsync(1000);
    child.log = 'starting\ntoken=test-token';
    await vi.advanceTimersByTimeAsync(500);
    expect(await probe).toMatchObject({ status: 'ok' });
  });

  it('stops polling as soon as the child exits', async () => {
    vi.useFakeTimers();
    const child = fakeChild('');
    const probe = probeKimi(ioWith(child).io, PORT, NOW);
    await vi.advanceTimersByTimeAsync(1000);
    child.exited = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(await probe).toMatchObject({ reason: 'kimi web exited without printing a token' });
  });

  it.each([
    [{}, '59177'],
    [{ DANDELION_KIMI_PORT: '' }, '59177'],
    [{ DANDELION_KIMI_PORT: '65535' }, '65535'],
    [{ DANDELION_KIMI_PORT: '1' }, '1']
  ])('launches on the port from %j', async (env, port) => {
    const { io, launches, requests } = ioWith(fakeChild());
    await probeKimi(io, env, NOW);
    expect(launches[0][1]).toEqual(['web', '--no-open', '--port', port]);
    expect(requests[0][0]).toBe(`http://127.0.0.1:${port}/api/v1/oauth/usage`);
  });

  it.each(['abc', '0', '70000', '65536', '48123.5', '1e3', ' 80', '+80', '-1'])(
    'never launches kimi for DANDELION_KIMI_PORT "%s"',
    async (value) => {
      const { io, launches } = ioWith(fakeChild());
      const usage = await probeKimi(io, { DANDELION_KIMI_PORT: value }, NOW);
      expect(usage).toMatchObject({
        status: 'unavailable',
        reason: 'DANDELION_KIMI_PORT must be an integer from 1 to 65535'
      });
      expect(launches).toEqual([]);
    }
  );
});

const LEGACY = {
  usage: { limit: '100', used: '29', remaining: '71', resetTime: '2026-10-02T12:58:51.471957Z' },
  limits: [{
    window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
    detail: { limit: '100', used: '88', remaining: '12', resetTime: '2026-10-01T01:58:51.471957Z' }
  }],
  usages: {
    limit_5h: { used_ratio: 0, reset_time: '2026-10-01T01:58:50Z' },
    limit_7d: { used_ratio: 0, reset_time: '2026-10-02T12:58:50Z' }
  }
};
const FUTURE = 4070908800;
const CONFIG = [
  '[providers."managed:kimi-code"]',
  'base_url = "https://api.kimi.ai/coding/v1/"',
  'key = "oauth/scoped-key"'
].join('\n');
const HOME = '/home/tester/.kimi-code';

function credential(expiresAt: number = FUTURE, token = 'access-token'): string {
  return JSON.stringify({ access_token: token, expires_at: expiresAt });
}

function filesFor(body: string, name: string, config: string): Record<string, string> {
  return { [`${HOME}/config.toml`]: config, [`${HOME}/credentials/${name}.json`]: body };
}

function scoped(body: string = credential()): Record<string, string> {
  return filesFor(body, 'scoped-key', CONFIG);
}

describe('probeKimi coding API', () => {
  it('reads legacy counters and ignores zeroed used_ratio', async () => {
    const { io, launches, requests } = ioWith(fakeChild(), bodyOf(LEGACY), scoped());
    const usage = await probeKimi(io, PORT, NOW);
    expect(launches).toEqual([]);
    expect(requests).toEqual([[
      'https://api.kimi.ai/coding/v1/usages',
      { Authorization: 'Bearer access-token', Accept: 'application/json', 'User-Agent': 'kimi-code-cli/2.1.1' },
      10000
    ]]);
    expect(usage).toMatchObject({
      status: 'ok',
      windows: [
        { label: 'weekly', kind: 'weekly', usedPct: 29, resetsAt: '2026-10-02T12:58:51.471957Z' },
        { label: '5h', kind: 'rolling', usedPct: 88, resetsAt: '2026-10-01T01:58:51.471957Z' }
      ]
    });
    expect(JSON.stringify(usage)).not.toContain('access-token');
  });

  it('lets a present counter win over a nonzero ratio, including a real zero', async () => {
    const body = {
      usage: { limit: 100, used: 0, resetTime: WEEKLY_RESET },
      limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: 3, used: 1, resetTime: 'soon' } }],
      usages: { limit_7d: { used_ratio: 0.59, reset_time: WEEKLY_RESET }, limit_5h: { used_ratio: 0.42, reset_time: ROLLING_RESET } }
    };
    const usage = await probeKimi(ioWith(fakeChild(), bodyOf(body), scoped()).io, PORT, NOW);
    expect(usage.windows).toStrictEqual([
      { label: 'weekly', kind: 'weekly', usedPct: 0, resetsAt: WEEKLY_RESET },
      { label: '5h', kind: 'rolling', usedPct: 33 }
    ]);
  });

  it('falls back to snake_case ratios when the counters are absent', async () => {
    const body = { usages: { limit_5h: { used_ratio: 0.42, reset_time: ROLLING_RESET }, limit_7d: { used_ratio: 0.595, reset_time: WEEKLY_RESET } } };
    const usage = await probeKimi(ioWith(fakeChild(), bodyOf(body), scoped()).io, PORT, NOW);
    expect(usage.windows).toStrictEqual([
      { label: 'weekly', kind: 'weekly', usedPct: 60, resetsAt: WEEKLY_RESET },
      ROLLING_42
    ]);
  });

  it('uses the default host and kimi-code credential when config.toml is missing', async () => {
    const files = { [`${HOME}/credentials/kimi-code.json`]: credential() };
    const { io, requests } = ioWith(undefined, bodyOf(LEGACY), files);
    const usage = await probeKimi(io, PORT, NOW);
    expect(requests[0][0]).toBe('https://api.kimi.com/coding/v1/usages');
    expect(usage.status).toBe('ok');
  });

  it('keeps a credential key that is not under oauth/', async () => {
    const config = 'base_url = "https://api.kimi.com/coding/v1"\nkey = "plain-key"';
    const { io, requests } = ioWith(undefined, bodyOf(LEGACY), filesFor(credential(), 'plain-key', config));
    await probeKimi(io, {}, NOW);
    expect(requests[0][0]).toBe('https://api.kimi.com/coding/v1/usages');
  });

  it.each([
    ['an empty base and key', 'base_url = ""\nkey = ""', 'kimi-code', 'https://api.kimi.com/coding/v1/usages'],
    ['a blank oauth key', 'key = "oauth/"', 'kimi-code', 'https://api.kimi.com/coding/v1/usages']
  ])('accepts %s', async (_label, config, name, url) => {
    const { io, requests } = ioWith(undefined, bodyOf(LEGACY), filesFor(credential(), name, config));
    expect((await probeKimi(io, {}, NOW)).status).toBe('ok');
    expect(requests[0][0]).toBe(url);
  });

  it('reads DANDELION_KIMI_HOME and ignores an invalid port', async () => {
    const home = '/kimi-home';
    const files = { [`${home}/config.toml`]: CONFIG, [`${home}/credentials/scoped-key.json`]: credential() };
    const { io, launches } = ioWith(undefined, bodyOf(LEGACY), files);
    const usage = await probeKimi(io, { DANDELION_KIMI_HOME: home, DANDELION_KIMI_PORT: 'abc' }, NOW);
    expect(usage.status).toBe('ok');
    expect(launches).toEqual([]);
  });

  it('treats an empty DANDELION_KIMI_HOME as the default home', async () => {
    const { io, requests } = ioWith(undefined, bodyOf(LEGACY), scoped());
    await probeKimi(io, { DANDELION_KIMI_HOME: '' }, NOW);
    expect(requests[0][0]).toBe('https://api.kimi.ai/coding/v1/usages');
  });

  it.each([
    ['expires_at 0', credential(0)],
    ['a millisecond expiry', credential(Date.parse('2099-01-01T00:00:00Z'))],
    ['no expires_at', JSON.stringify({ access_token: 'access-token' })],
    ['a string expiry', JSON.stringify({ access_token: 'access-token', expires_at: 'soon' })]
  ])('accepts %s', async (_label, body) => {
    const usage = await probeKimi(ioWith(undefined, bodyOf(LEGACY), scoped(body)).io, {}, NOW);
    expect(usage.status).toBe('ok');
  });

  it('clamps a counter above the limit and drops a bad reset', async () => {
    const body = {
      usage: { limit: '100', used: '140', resetTime: 'soon' },
      limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '0', used: '1', resetTime: ROLLING_RESET } }],
      usages: { limit_5h: { used_ratio: 0.42, reset_time: 42 } }
    };
    const usage = await probeKimi(ioWith(undefined, bodyOf(body), scoped()).io, {}, NOW);
    expect(usage.windows).toStrictEqual([
      { label: 'weekly', kind: 'weekly', usedPct: 100 },
      ROLLING_42_BARE
    ]);
  });

  it('ignores a counter too large to be a finite number', async () => {
    const body = {
      usage: { limit: '100', used: '9'.repeat(400), resetTime: WEEKLY_RESET },
      limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: 'n/a' } }],
      usages: { limit_7d: { used_ratio: 0.59, reset_time: WEEKLY_RESET } }
    };
    const usage = await probeKimi(ioWith(undefined, bodyOf(body), scoped()).io, {}, NOW);
    expect(usage.windows).toStrictEqual([WEEKLY_59]);
  });

  it('ignores a limit that is not the 300-minute window', async () => {
    const body = {
      limits: [{ window: { duration: 60, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '9' } }],
      usages: { limit_7d: { used_ratio: 0.59, reset_time: WEEKLY_RESET } }
    };
    const usage = await probeKimi(ioWith(undefined, bodyOf(body), scoped()).io, {}, NOW);
    expect(usage.windows).toStrictEqual([WEEKLY_59]);
  });

  it.each<[string, FetchOutcome, string]>([
    ['HTTP 401', { status: 401, body: '{}' }, 'kimi usage request failed: HTTP 401'],
    ['a network failure', { failure: 'network' }, 'kimi usage request failed'],
    ['a timeout', { failure: 'timeout' }, 'kimi usage request timed out after 10s'],
    ['code 1', bodyOf({ code: 1, msg: 'quota denied', ...LEGACY }), 'kimi usage request failed: quota denied'],
    ['an empty object', bodyOf({}), PARSE_FAILURE],
    ['truncated JSON', bodyOf('{"usage":'), PARSE_FAILURE]
  ])('does not launch kimi web on %s', async (_label, outcome, reason) => {
    const { io, launches } = ioWith(fakeChild(), outcome, scoped());
    const usage = await probeKimi(io, PORT, NOW);
    expect(usage).toMatchObject({ status: 'unavailable', reason });
    expect(launches).toEqual([]);
  });

  it.each([
    ['expired', credential(Math.floor(Date.parse(NOW) / 1000)), 'kimi token expired — run kimi once'],
    ['expired by one millisecond', credential((Date.parse(NOW) - 1) / 1000), 'kimi token expired — run kimi once'],
    ['missing access_token', JSON.stringify({ expires_at: FUTURE }), 'no kimi auth — run kimi login'],
    ['an empty access_token', JSON.stringify({ access_token: '', expires_at: FUTURE }), 'no kimi auth — run kimi login'],
    ['bad JSON', '{', 'no kimi auth — run kimi login'],
    ['null', 'null', 'no kimi auth — run kimi login']
  ])('is unavailable on a %s credential and does not launch', async (_label, body, reason) => {
    const { io, launches, requests } = ioWith(fakeChild(), bodyOf(LEGACY), scoped(body));
    const usage = await probeKimi(io, PORT, NOW);
    expect(usage).toMatchObject({ status: 'unavailable', reason });
    expect(launches).toEqual([]);
    expect(requests).toEqual([]);
    expect(JSON.stringify(usage)).not.toContain('access-token');
  });

  it('accepts a token that expires one second after now', async () => {
    const body = credential(Math.floor(Date.parse(NOW) / 1000) + 1);
    const usage = await probeKimi(ioWith(undefined, bodyOf(LEGACY), scoped(body)).io, {}, NOW);
    expect(usage.status).toBe('ok');
  });
});
