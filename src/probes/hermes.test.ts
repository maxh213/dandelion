import { describe, expect, it } from 'vitest';
import type { FetchOutcome } from '../domain/index.ts';
import { probeHermes, type HermesIo } from './hermes.ts';

const NOW = '2026-09-18T19:00:00Z';
const AGENT = 'qa-dummy-hermes-agent-key-016';
const ACCESS = 'qa-dummy-hermes-access-016';
const RESET = '2026-09-21T19:00:00.000Z';
const BASE = 'http://127.0.0.1:48016';
const ENV = { DANDELION_HERMES_AUTH_FILE: '/auth.json', DANDELION_HERMES_PORTAL_BASE: BASE };
const NO_AUTH = 'no hermes auth — run hermes portal login';
const EXPIRED = 'hermes token expired — run hermes once';
const PARSE_FAILURE = 'Could not parse usage from response';
const WINDOW_75 = { label: 'credits', kind: 'weekly', usedPct: 75, resetsAt: RESET };

type Outcome = FetchOutcome;
type Answer = Outcome | Promise<Outcome>;

function answer(value: unknown, status = 200): Outcome {
  return { status, body: typeof value === 'string' ? value : JSON.stringify(value) };
}

function account(
  overrides: { subscription?: Record<string, unknown>; paid_service_access?: Record<string, unknown> } = {}
) {
  return {
    user: { email: 'qa@example.com', privy_did: 'did' },
    organisation: { id: 'o', slug: 'o', name: 'O' },
    subscription: {
      plan: 'Plus',
      tier: 2,
      monthly_charge: 20,
      monthly_credits: 22,
      current_period_end: RESET,
      credits_remaining: 5.5,
      rollover_credits: 6.591792646666667,
      ...overrides.subscription
    },
    purchased_credits_remaining: 0,
    tool_access: { enabled: false, coverage: { firecrawl: true, fal: true } },
    managed_tools: false,
    paid_service_access: {
      allowed: true,
      paid_access: true,
      reason: 'usable_credits',
      ...overrides.paid_service_access
    }
  };
}

function authJson(nous: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1,
    providers: { nous: { refresh_token: 'r', client_id: 'hermes-cli', portal_base_url: 'https://ignored.example', ...nous } },
    active_provider: 'openai'
  });
}

const AUTH = authJson({
  access_token: ACCESS,
  agent_key: AGENT,
  agent_key_expires_at: '2026-09-19T19:00:00+00:00',
  expires_at: '2026-09-19T19:00:00+00:00'
});

function ioOf(files: Record<string, string>, accountAnswer: Answer = answer(account())) {
  const requests: [string, Record<string, string>, number][] = [];
  const reads: string[] = [];
  const io: HermesIo = {
    reader: {
      homeDir: () => '/home/tester',
      read: async (path) => {
        reads.push(path);
        return files[path];
      },
      isDirectory: async () => false
    },
    fetcher: {
      get: async (url, headers, timeoutMs) => {
        requests.push([url, headers, timeoutMs]);
        return accountAnswer;
      }
    }
  };
  return { io, requests, reads };
}

function withAuth(nous?: Record<string, unknown>, accountAnswer?: Answer) {
  return ioOf({ '/auth.json': nous === undefined ? AUTH : authJson(nous) }, accountAnswer);
}

function unavailable(reason: string, fix?: { command: string; args: string[] }) {
  return { id: 'hermes', displayName: 'hermes', planLabel: 'hermes', fetchedAt: NOW, windows: [], status: 'unavailable', reason, ...(fix ? { fix } : {}) };
}

function okUsage(windows: unknown[], planLabel: string, extra: Record<string, unknown> = {}) {
  return { id: 'hermes', displayName: 'hermes', fetchedAt: NOW, planLabel, windows, status: 'ok', ...extra };
}

describe('probeHermes', () => {
  it('reads the credits window and the plan label from the portal account', async () => {
    const { io, reads } = withAuth();
    expect(await probeHermes(io, ENV, NOW)).toStrictEqual(okUsage([WINDOW_75], 'Plus · $5.50 of $22'));
    expect(reads).toEqual(['/auth.json']);
  });

  it('GETs the account path with the bearer agent key, JSON accept and a 15s timeout', async () => {
    const { io, requests } = withAuth();
    await probeHermes(io, ENV, NOW);
    expect(requests).toEqual([[`${BASE}/api/oauth/account`, { Authorization: `Bearer ${AGENT}`, Accept: 'application/json' }, 15000]]);
  });

  it.each([[{}], [{ DANDELION_HERMES_AUTH_FILE: '', DANDELION_HERMES_PORTAL_BASE: '' }]])('defaults the auth file and portal base for %j', async (env) => {
    const { io, requests, reads } = ioOf({
      '/home/tester/.hermes/auth.json': authJson({
        access_token: ACCESS,
        agent_key: 'home-hermes-agent-key',
        agent_key_expires_at: '2026-09-19T19:00:00+00:00',
        expires_at: '2026-09-19T19:00:00+00:00'
      })
    });
    const usage = await probeHermes(io, env, NOW);
    expect(reads).toEqual(['/home/tester/.hermes/auth.json']);
    expect(requests).toEqual([
      ['https://portal.nousresearch.com/api/oauth/account', { Authorization: 'Bearer home-hermes-agent-key', Accept: 'application/json' }, 15000]
    ]);
    expect(usage).toMatchObject({ status: 'ok', planLabel: 'Plus · $5.50 of $22' });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['prefers a non-empty agent_key over access_token', { agent_key: AGENT, access_token: ACCESS, agent_key_expires_at: '2026-09-19T19:00:00+00:00', expires_at: '2026-09-19T19:00:00+00:00' }, AGENT],
    ['falls back to access_token when agent_key is missing', { access_token: ACCESS, expires_at: '2026-09-19T19:00:00+00:00' }, ACCESS],
    ['falls back to access_token when agent_key is empty', { agent_key: '', access_token: ACCESS, agent_key_expires_at: '2026-09-19T19:00:00+00:00', expires_at: '2026-09-19T19:00:00+00:00' }, ACCESS]
  ])('selects the token when %s', async (_case, nous, token) => {
    const { io, requests } = withAuth(nous);
    expect(await probeHermes(io, ENV, NOW)).toMatchObject({ status: 'ok' });
    expect(requests[0]?.[1].Authorization).toBe(`Bearer ${token}`);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an expired agent_key does not fall back to a valid access_token', { agent_key: AGENT, access_token: ACCESS, agent_key_expires_at: '2026-09-18T18:00:00+00:00', expires_at: '2026-09-19T19:00:00+00:00' }],
    ['both expiries at now', { agent_key: AGENT, access_token: ACCESS, agent_key_expires_at: '2026-09-18T19:00:00+00:00', expires_at: '2026-09-18T19:00:00+00:00' }],
    ['a missing expiry', { agent_key: AGENT, access_token: ACCESS, expires_at: '2026-09-19T19:00:00+00:00' }],
    ['an unparseable expiry', { agent_key: AGENT, agent_key_expires_at: 'soon' }]
  ])('is expired without a request when %s', async (_case, nous) => {
    const { io, requests } = withAuth(nous);
    expect(await probeHermes(io, ENV, NOW)).toStrictEqual(unavailable(EXPIRED, { command: 'hermes', args: ['once'] }));
    expect(requests).toEqual([]);
  });

  it.each<[string, unknown, unknown[], string, Record<string, unknown>?]>([
    ['credits remaining above the monthly grant', account({ subscription: { credits_remaining: 22.472091793333334 } }), [{ ...WINDOW_75, usedPct: 0 }], 'Plus · $22.47 of $22'],
    ['zero remaining', account({ subscription: { credits_remaining: 0 } }), [{ ...WINDOW_75, usedPct: 100 }], 'Plus · $0.00 of $22'],
    ['half remaining', account({ subscription: { credits_remaining: 11 } }), [{ ...WINDOW_75, usedPct: 50 }], 'Plus · $11.00 of $22'],
    ['0.4 of 100 remaining', account({ subscription: { credits_remaining: 0.4, monthly_credits: 100 } }), [{ ...WINDOW_75, usedPct: 99.6 }], 'Plus · $0.40 of $100'],
    ['3.3 remaining', account({ subscription: { credits_remaining: 3.3 } }), [{ ...WINDOW_75, usedPct: 85 }], 'Plus · $3.30 of $22'],
    ['no plan', account({ subscription: { plan: undefined } }), [WINDOW_75], 'hermes'],
    ['an empty plan', account({ subscription: { plan: '' } }), [WINDOW_75], 'hermes'],
    ['paid_access false', account({ paid_service_access: { paid_access: false } }), [WINDOW_75], 'Plus · $5.50 of $22', { captionSuffix: ' · no paid access' }],
    ['no plan and paid_access false', account({ subscription: { plan: '' }, paid_service_access: { paid_access: false } }), [WINDOW_75], 'hermes', { captionSuffix: ' · no paid access' }],
    ['no current_period_end', account({ subscription: { current_period_end: undefined } }), [{ label: 'credits', kind: 'weekly', usedPct: 75 }], 'Plus · $5.50 of $22'],
    ['an unparseable current_period_end', account({ subscription: { current_period_end: 'soon' } }), [{ label: 'credits', kind: 'weekly', usedPct: 75 }], 'Plus · $5.50 of $22']
  ])('reads a body with %s', async (_case, body, windows, planLabel, extra = {}) => {
    expect(await probeHermes(withAuth(undefined, answer(body)).io, ENV, NOW)).toStrictEqual(okUsage(windows, planLabel, extra));
  });

  it.each<[string, Record<string, string>]>([
    ['a missing file', {}],
    ['an empty file', { '/auth.json': '' }],
    ['a non-JSON file', { '/auth.json': 'not json' }],
    ['no nous provider', { '/auth.json': '{"providers":{}}' }],
    ['an empty nous provider', { '/auth.json': '{"providers":{"nous":{}}}' }],
    ['both tokens empty', { '/auth.json': authJson({ agent_key: '', access_token: '', agent_key_expires_at: '2026-09-19T19:00:00+00:00', expires_at: '2026-09-19T19:00:00+00:00' }) }],
    ['both tokens missing', { '/auth.json': authJson({ agent_key_expires_at: '2026-09-19T19:00:00+00:00', expires_at: '2026-09-19T19:00:00+00:00' }) }],
    ['a JSON array', { '/auth.json': '["qa-dummy-hermes-agent-key-016"]' }]
  ])('is unavailable without a request for %s', async (_case, files) => {
    const { io, requests } = ioOf(files);
    expect(await probeHermes(io, ENV, NOW)).toStrictEqual(unavailable(NO_AUTH, { command: 'hermes', args: ['portal', 'login'] }));
    expect(requests).toEqual([]);
  });

  it.each<[string, Outcome, string]>([
    ['HTTP 401 echoing the token', answer({ error: `bad token ${AGENT}` }, 401), 'hermes account request failed: HTTP 401'],
    ['HTTP 500', answer('', 500), 'hermes account request failed: HTTP 500'],
    ['a redirect', answer('', 302), 'hermes account request failed: HTTP 302'],
    ['a network failure', { failure: 'network' }, 'hermes account request failed'],
    ['a timeout', { failure: 'timeout' }, 'hermes account request timed out after 15s'],
    ['a non-JSON body', answer(`not json ${AGENT}`), PARSE_FAILURE],
    ['an empty object', answer({}), PARSE_FAILURE],
    ['subscription without remaining', answer({ subscription: { monthly_credits: 22 } }), PARSE_FAILURE],
    ['monthly_credits 0', answer(account({ subscription: { monthly_credits: 0 } })), PARSE_FAILURE],
    ['credits_remaining -1', answer(account({ subscription: { credits_remaining: -1 } })), PARSE_FAILURE],
    ['credits_remaining as a string', answer(account({ subscription: { credits_remaining: '5.5' } })), PARSE_FAILURE]
  ])('is unavailable when the account request gives %s', async (_case, accountAnswer, reason) => {
    const result = await probeHermes(withAuth(undefined, accountAnswer).io, ENV, NOW);
    expect(result).toStrictEqual(unavailable(reason));
    expect(JSON.stringify(result)).not.toContain(AGENT);
    expect(JSON.stringify(result)).not.toContain(ACCESS);
  });
});
