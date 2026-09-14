import { describe, expect, it } from 'vitest';
import { probeCursor, type CursorIo, type PostFetcher } from './cursor.ts';

const NOW = '2026-09-13T10:00:00Z';
const TOKEN = 'unit-dummy-cursor-token';
const AUTH = JSON.stringify({ accessToken: TOKEN, refreshToken: 'unit-dummy-refresh' });
const RESET = '2026-09-30T16:45:06.000Z';
const USAGE = {
  billingCycleStart: '1788108306000',
  billingCycleEnd: '1790786706000',
  planUsage: { totalSpend: 101050, includedSpend: 40000, limit: 40000, autoPercentUsed: 32.36, apiPercentUsed: 15.81, totalPercentUsed: 31.09 }
};
const PLAN = { planInfo: { planName: 'Ultra', includedAmountCents: 40000, price: '$200/mo', billingCycleEnd: '1790786706000' } };
const BASE = 'http://127.0.0.1:48006/aiserver.v1.DashboardService';
const ENV = { ALLOWANCE_CURSOR_AUTH_FILE: '/auth.json', ALLOWANCE_CURSOR_API_BASE: 'http://127.0.0.1:48006' };
const NO_AUTH = 'no cursor auth — run cursor-agent login';
const PARSE_FAILURE = 'Could not parse usage from response';
const WINDOWS = [
  { label: 'total', usedPct: 31, resetsAt: RESET },
  { label: 'auto', usedPct: 32, resetsAt: RESET },
  { label: 'api', usedPct: 16, resetsAt: RESET }
];

type Outcome = Awaited<ReturnType<PostFetcher['post']>>;
type Answer = Outcome | Promise<Outcome>;

function answer(value: unknown, status = 200): Outcome {
  return { status, body: typeof value === 'string' ? value : JSON.stringify(value) };
}

function ioOf(files: Record<string, string>, usage: Answer = answer(USAGE), plan: Answer = answer(PLAN)) {
  const requests: [string, Record<string, string>, string, number][] = [];
  const reads: string[] = [];
  const io: CursorIo = {
    reader: {
      homeDir: () => '/home/tester',
      read: async (path) => {
        reads.push(path);
        return files[path];
      }
    },
    fetcher: {
      post: async (url, headers, body, timeoutMs) => {
        requests.push([url, headers, body, timeoutMs]);
        return url.endsWith('/GetPlanInfo') ? plan : usage;
      }
    }
  };
  return { io, requests, reads };
}

function withAuth(usage?: Answer, plan?: Answer) {
  return ioOf({ '/auth.json': AUTH }, usage, plan);
}

function unavailable(reason: string) {
  return { id: 'cursor', displayName: 'cursor', planLabel: 'cursor', fetchedAt: NOW, windows: [], status: 'unavailable', reason };
}

describe('probeCursor', () => {
  it('reads the three plan windows and the plan label from the dashboard API', async () => {
    const { io, reads } = withAuth();
    expect(await probeCursor(io, ENV, NOW)).toStrictEqual({
      id: 'cursor',
      displayName: 'cursor',
      fetchedAt: NOW,
      planLabel: 'Ultra · $200/mo',
      windows: WINDOWS,
      status: 'ok'
    });
    expect(reads).toEqual(['/auth.json']);
  });

  it('POSTs {} with the bearer token and JSON content type to both methods with a 15s timeout', async () => {
    const { io, requests } = withAuth();
    await probeCursor(io, ENV, NOW);
    const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
    expect(requests).toEqual([
      [`${BASE}/GetCurrentPeriodUsage`, headers, '{}', 15000],
      [`${BASE}/GetPlanInfo`, headers, '{}', 15000]
    ]);
  });

  it.each([[{}], [{ ALLOWANCE_CURSOR_AUTH_FILE: '', ALLOWANCE_CURSOR_API_BASE: '' }]])('defaults the auth file and API base for %j', async (env) => {
    const { io, requests, reads } = ioOf({ '/home/tester/.config/cursor/auth.json': '{"accessToken":"home-token"}' });
    const usage = await probeCursor(io, env, NOW);
    expect(reads).toEqual(['/home/tester/.config/cursor/auth.json']);
    expect(requests.map(([url, headers]) => [url, headers.Authorization])).toEqual([
      ['https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage', 'Bearer home-token'],
      ['https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo', 'Bearer home-token']
    ]);
    expect(usage).toMatchObject({ status: 'ok', planLabel: 'Ultra · $200/mo' });
  });

  it.each<[string, unknown, unknown[]]>([
    ['no auto window', { billingCycleEnd: '1790786706000', planUsage: { totalPercentUsed: 31.09, apiPercentUsed: 15.81 } }, [WINDOWS[0], WINDOWS[2]]],
    ['a zero, a string and a negative', { planUsage: { totalPercentUsed: 0, autoPercentUsed: '32', apiPercentUsed: -1 } }, [{ label: 'total', usedPct: 0 }]],
    ['a numeric cycle end and an uncapped percent', { billingCycleEnd: 1790786706000, planUsage: { totalPercentUsed: 130 } }, [{ label: 'total', usedPct: 130 }]],
    ['a word cycle end and a half percent', { billingCycleEnd: 'soon', planUsage: { autoPercentUsed: 32.5 } }, [{ label: 'auto', usedPct: 33 }]],
    ['an out-of-range cycle end', { billingCycleEnd: '99999999999999999999', planUsage: { apiPercentUsed: 1 } }, [{ label: 'api', usedPct: 1 }]]
  ])('reads a usage body with %s', async (_case, body, windows) => {
    const usage = await probeCursor(withAuth(answer(body)).io, ENV, NOW);
    expect(usage).toMatchObject({ status: 'ok', planLabel: 'Ultra · $200/mo' });
    expect(usage.windows).toStrictEqual(windows);
  });

  it.each<[string, Answer, string]>([
    ['a name without a price', answer({ planInfo: { planName: 'Pro' } }), 'Pro'],
    ['an empty price', answer({ planInfo: { planName: 'Pro', price: '' } }), 'Pro'],
    ['a price without a name', answer({ planInfo: { price: '$200/mo' } }), 'cursor'],
    ['no plan info', answer({}), 'cursor'],
    ['a non-JSON body', answer('not json'), 'cursor'],
    ['HTTP 500', answer(PLAN, 500), 'cursor'],
    ['a timeout', { failure: 'timeout' }, 'cursor'],
    ['a network failure', { failure: 'network' }, 'cursor']
  ])('labels the plan from GetPlanInfo with %s', async (_case, plan, planLabel) => {
    const usage = await probeCursor(withAuth(answer(USAGE), plan).io, ENV, NOW);
    expect(usage).toStrictEqual({ id: 'cursor', displayName: 'cursor', fetchedAt: NOW, planLabel, windows: WINDOWS, status: 'ok' });
  });

  it.each<[string, Record<string, string>]>([
    ['a missing file', {}],
    ['an empty file', { '/auth.json': '' }],
    ['a non-JSON file', { '/auth.json': 'not json' }],
    ['no access token', { '/auth.json': '{"refreshToken":"r"}' }],
    ['an empty access token', { '/auth.json': '{"accessToken":""}' }],
    ['a numeric access token', { '/auth.json': '{"accessToken":42}' }],
    ['a JSON array', { '/auth.json': '["unit-dummy-cursor-token"]' }]
  ])('is unavailable without a request for %s', async (_case, files) => {
    const { io, requests } = ioOf(files);
    expect(await probeCursor(io, ENV, NOW)).toStrictEqual(unavailable(NO_AUTH));
    expect(requests).toEqual([]);
  });

  it.each<[string, Outcome, string]>([
    ['HTTP 401 echoing the token', answer({ error: `bad token ${TOKEN}` }, 401), 'cursor usage request failed: HTTP 401'],
    ['HTTP 500', answer('', 500), 'cursor usage request failed: HTTP 500'],
    ['a redirect', answer('', 302), 'cursor usage request failed: HTTP 302'],
    ['a network failure', { failure: 'network' }, 'cursor usage request failed'],
    ['a timeout', { failure: 'timeout' }, 'cursor usage request timed out after 15s'],
    ['a non-JSON body', answer(`not json ${TOKEN}`), PARSE_FAILURE],
    ['a null plan usage', answer({ planUsage: null }), PARSE_FAILURE],
    ['no usable window', answer({ planUsage: { totalPercentUsed: '31' } }), PARSE_FAILURE]
  ])('is unavailable when GetCurrentPeriodUsage gives %s', async (_case, usage, reason) => {
    const result = await probeCursor(withAuth(usage).io, ENV, NOW);
    expect(result).toStrictEqual(unavailable(reason));
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('does not wait for GetPlanInfo when GetCurrentPeriodUsage fails', async () => {
    const never = new Promise<Outcome>(() => undefined);
    expect(await probeCursor(withAuth(answer('', 500), never).io, ENV, NOW)).toStrictEqual(unavailable('cursor usage request failed: HTTP 500'));
  });
});
