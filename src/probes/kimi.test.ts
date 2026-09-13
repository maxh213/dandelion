import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeKimi, type FetchOutcome, type Fetcher, type KimiIo, type LaunchedProcess, type Launcher } from './kimi.ts';

const NOW = '2026-09-13T10:00:00Z';
const BODY = JSON.stringify({
  data: {
    summary: { used: 590, limit: 1000, reset_at: '2026-09-18T10:00:00Z' },
    limits: [{ used: 42, limit: 100, window: { unit: 'hour', value: 5 } }]
  }
});

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

function ioWith(child: FakeChild | undefined, outcome: FetchOutcome = { status: 200, body: BODY }) {
  const launches: [string, string[]][] = [];
  const requests: [string, Record<string, string>, number][] = [];
  const launcher: Launcher = {
    launch: async (command, args) => {
      launches.push([command, args]);
      return child;
    }
  };
  const fetcher: Fetcher = {
    get: async (url, headers, timeoutMs) => {
      requests.push([url, headers, timeoutMs]);
      return outcome;
    }
  };
  const io: KimiIo = { launcher, fetcher };
  return { io, launches, requests };
}

function bodyOf(value: unknown): FetchOutcome {
  return { status: 200, body: typeof value === 'string' ? value : JSON.stringify(value) };
}

const PORT = { ALLOWANCE_KIMI_PORT: '48123' };
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
        { label: 'weekly', usedPct: 59, resetsAt: '2026-09-18T10:00:00Z' },
        { label: '5h', usedPct: 42 }
      ]
    });
    expect(child.stops).toBe(1);
  });

  it('stops the child before resolving', async () => {
    let stopped = false;
    const child = fakeChild();
    child.stop = () => new Promise((resolve) => setTimeout(() => { stopped = true; resolve(); }, 5));
    await probeKimi(ioWith(child).io, PORT, NOW);
    expect(stopped).toBe(true);
  });

  it.each([
    ['open http://127.0.0.1:48123/?token=abc.D-9_z'],
    ['Authorization: Bearer abc.D-9_z']
  ])('finds the token in "%s"', async (log) => {
    const { io, requests } = ioWith(fakeChild(log));
    const usage = await probeKimi(io, PORT, NOW);
    expect(requests[0][1]).toEqual({ Authorization: 'Bearer abc.D-9_z' });
    expect(usage.status).toBe('ok');
  });

  it.each<[unknown, unknown[]]>([
    [{ data: { summary: { used: 500, limit: 1000 } } }, [{ label: 'weekly', usedPct: 50 }]],
    [{ data: { summary: { used: 1, limit: 3 }, limits: [] } }, [{ label: 'weekly', usedPct: 33 }]],
    [{ data: { summary: { used: 2, limit: 3 }, limits: [{ used: 9, limit: 10, window: { unit: 'day', value: 1 } }] } }, [{ label: 'weekly', usedPct: 67 }]],
    [{ data: { summary: { used: 125, limit: 1000 } } }, [{ label: 'weekly', usedPct: 13 }]],
    [{ data: { summary: { used: 0, limit: 1000 } } }, [{ label: 'weekly', usedPct: 0 }]],
    [{ data: { summary: { used: 1200, limit: 1000 } } }, [{ label: 'weekly', usedPct: 120 }]],
    [{ data: { summary: { used: 590, limit: 1000, reset_at: 'soon' } } }, [{ label: 'weekly', usedPct: 59 }]],
    [{ data: { summary: { used: 590, limit: 1000, reset_at: 42 } } }, [{ label: 'weekly', usedPct: 59 }]],
    [{ data: { summary: { used: 590, limit: 1000, reset_at: ['2026-09-18T10:00:00Z'] } } }, [{ label: 'weekly', usedPct: 59 }]],
    [{ data: { summary: { used: 590, limit: 1000, reset_at: '2026-02-30T99:00:00Z' } } }, [{ label: 'weekly', usedPct: 59 }]],
    [{ data: { summary: { used: 590, limit: 1000 }, limits: 'x' } }, [{ label: 'weekly', usedPct: 59 }]],
    [{ data: { summary: { used: 590, limit: 1000 }, limits: {} } }, [{ label: 'weekly', usedPct: 59 }]],
    [{ data: { summary: { used: 590, limit: 1000 }, limits: [null] } }, [{ label: 'weekly', usedPct: 59 }]],
    [{ data: { summary: { used: 590, limit: 1000 }, limits: [{ used: 42, limit: 100 }] } }, [{ label: 'weekly', usedPct: 59 }]],
    [{ data: { summary: { used: 590, limit: 1000 }, limits: [{ used: 42, limit: 100, window: null }] } }, [{ label: 'weekly', usedPct: 59 }]]
  ])('reads summary variation %j', async (body, windows) => {
    const usage = await probeKimi(ioWith(fakeChild(), bodyOf(body)).io, PORT, NOW);
    expect(usage).toMatchObject({ status: 'ok' });
    expect(usage.windows).toStrictEqual(windows);
  });

  it('labels every hour entry 5h in response order and skips bad ones', async () => {
    const hour = { unit: 'hour', value: 5 };
    const body = {
      data: {
        summary: { used: 590, limit: 1000 },
        limits: [
          { used: 42, limit: 100, window: hour },
          { used: 1, limit: 0, window: hour },
          { used: 'x', limit: 100, window: hour },
          { used: 3, window: hour },
          { used: -1, limit: 100, window: hour },
          { used: 7, limit: 10, window: { unit: 'hour', value: 1 } },
          { used: 9, limit: 10, window: { unit: 'day', value: 7 } }
        ]
      }
    };
    const usage = await probeKimi(ioWith(fakeChild(), bodyOf(body)).io, PORT, NOW);
    expect(usage.windows).toStrictEqual([
      { label: 'weekly', usedPct: 59 },
      { label: '5h', usedPct: 42 },
      { label: '5h', usedPct: 70 }
    ]);
  });

  it.each<[string, FetchOutcome, string]>([
    ['no HTTP on the port', { failure: 'network' }, 'kimi usage request failed'],
    ['a hanging request', { failure: 'timeout' }, 'kimi usage request timed out after 10s'],
    ['HTTP 500', { status: 500, body: '{}' }, 'kimi usage request failed: HTTP 500'],
    ['HTTP 199', { status: 199, body: BODY }, 'kimi usage request failed: HTTP 199'],
    ['HTTP 300', { status: 300, body: BODY }, 'kimi usage request failed: HTTP 300'],
    ['a string used count', bodyOf({ data: { summary: { used: '590', limit: 1000 } } }), PARSE_FAILURE],
    ['truncated JSON', bodyOf('{"data":'), PARSE_FAILURE],
    ['no summary', bodyOf({ data: { limits: [] } }), PARSE_FAILURE],
    ['null', bodyOf('null'), PARSE_FAILURE],
    ['an array', bodyOf('[]'), PARSE_FAILURE],
    ['null data', bodyOf({ data: null }), PARSE_FAILURE],
    ['null summary', bodyOf({ data: { summary: null } }), PARSE_FAILURE],
    ['a string summary', bodyOf({ data: { summary: 'x' } }), PARSE_FAILURE],
    ['a limitless summary', bodyOf({ data: { summary: { used: 1 } } }), PARSE_FAILURE],
    ['a zero limit', bodyOf({ data: { summary: { used: 1, limit: 0 } } }), PARSE_FAILURE],
    ['a negative used', bodyOf({ data: { summary: { used: -1, limit: 1000 } } }), PARSE_FAILURE],
    ['a string used', bodyOf({ data: { summary: { used: '590', limit: 1000 } } }), PARSE_FAILURE],
    ['a string limit', bodyOf({ data: { summary: { used: 590, limit: '1000' } } }), PARSE_FAILURE]
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
    [{ ALLOWANCE_KIMI_PORT: '' }, '59177'],
    [{ ALLOWANCE_KIMI_PORT: '65535' }, '65535'],
    [{ ALLOWANCE_KIMI_PORT: '1' }, '1']
  ])('launches on the port from %j', async (env, port) => {
    const { io, launches, requests } = ioWith(fakeChild());
    await probeKimi(io, env, NOW);
    expect(launches[0][1]).toEqual(['web', '--no-open', '--port', port]);
    expect(requests[0][0]).toBe(`http://127.0.0.1:${port}/api/v1/oauth/usage`);
  });

  it.each(['abc', '0', '70000', '65536', '48123.5', '1e3', ' 80', '+80', '-1'])(
    'never launches kimi for ALLOWANCE_KIMI_PORT "%s"',
    async (value) => {
      const { io, launches } = ioWith(fakeChild());
      const usage = await probeKimi(io, { ALLOWANCE_KIMI_PORT: value }, NOW);
      expect(usage).toMatchObject({
        status: 'unavailable',
        reason: 'ALLOWANCE_KIMI_PORT must be an integer from 1 to 65535'
      });
      expect(launches).toEqual([]);
    }
  );
});
