import { describe, expect, it } from 'vitest';
import { routeLine, type FetchOutcome, type Fetcher, type RouteLines } from '../domain/index.ts';
import { probeJunie, type JunieIo } from './junie.ts';

const NOW = '2026-10-25T12:00:00.000Z';
const TOKEN_URL = 'https://oauth.account.jetbrains.com/oauth2/token';
const QUOTA_URL = 'https://ingrazzio-cloud-prod.labs.jb.gg/auth/test';
const ENV = { DANDELION_JUNIE_HOME: '/junie' };
const REFRESH = 'refresh-secret & never-log';
const ACCESS = 'access-secret-never-log';
const AUTH = JSON.stringify({ secrets: [
  { key: 'other', secret: 'ignored' },
  { key: 'jb-account-stored', secret: JSON.stringify({ jbAccount: { refresh_token: REFRESH, access_token: 'expired' } }) }
] });
const OLD = JSON.stringify({ completion: { endedAtMs: Date.parse(NOW) - 60000, quota: { type: 'TaskQuotaSnapshot.JetBrains', balanceLeft: 25549 } } });
const LINES: RouteLines = { route: { junie: { standard: 'junie-model high', max: 'junie-model high' } }, high: {} };

function response(body: unknown): FetchOutcome {
  return { status: 200, body: JSON.stringify(body) };
}

type Overrides = { auth?: string; omitAuth?: boolean; token?: FetchOutcome; quota?: FetchOutcome; throws?: boolean };

function fixture(overrides: Overrides = {}) {
  const reads: string[] = [];
  const requests: { method: string; url: string; headers: Record<string, string>; body?: string; timeout: number }[] = [];
  const files: Record<string, string> = {
    '/junie/secure_credentials.json': overrides.auth ?? AUTH,
    '/junie/sessions/index.jsonl': '{"sessionId":"old","updatedAt":1}',
    '/junie/sessions/old/events.jsonl': OLD
  };
  if (overrides.omitAuth) delete files['/junie/secure_credentials.json'];
  const fetcher: Fetcher = {
    post: async (url, headers, body, timeout) => {
      requests.push({ method: 'POST', url, headers, body, timeout });
      if (overrides.throws) throw new Error(`sensitive diagnostic ${REFRESH}`);
      return overrides.token ?? response({ access_token: ACCESS, expires_in: 3600 });
    },
    get: async (url, headers, timeout) => {
      requests.push({ method: 'GET', url, headers, timeout });
      return overrides.quota ?? response({ active: true, balanceLeft: 0, balanceUnit: 'CREDITS', licenseType: 'AIP' });
    }
  };
  const io: JunieIo = { reader: {
    homeDir: () => '/home/tester',
    read: async (path) => { reads.push(path); return files[path]; },
    isDirectory: async () => false
  }, fetcher };
  return { io, reads, requests };
}

describe('live Junie quota', () => {
  it('reads the live exhausted balance instead of an older successful session and does not route it', async () => {
    const { io, reads, requests } = fixture();
    const usage = await probeJunie(io, ENV, NOW);
    expect(usage).toStrictEqual({
      id: 'junie', displayName: 'junie', planLabel: '0 credits', fetchedAt: NOW,
      windows: [{ label: 'credits', kind: 'weekly', usedPct: 100 }], status: 'ok', snapshotAt: NOW
    });
    expect(reads).toEqual(['/junie/secure_credentials.json']);
    expect(requests).toEqual([
      { method: 'POST', url: TOKEN_URL, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH, client_id: 'junie-cli' }).toString(), timeout: 15000 },
      { method: 'GET', url: QUOTA_URL, headers: { Authorization: `Bearer ${ACCESS}`, Accept: 'application/json',
        'X-Accept-EAP-License': 'false', 'X-Accept-Release-License': 'true' }, timeout: 15000 }
    ]);
    expect(routeLine(LINES, [usage], NOW, '2026-10-26T00:00:00Z', [])).toBe('none');
    expect(JSON.stringify(usage)).not.toContain(REFRESH);
    expect(JSON.stringify(usage)).not.toContain(ACCESS);
  });

  it('automatically routes again after the live balance is replenished', async () => {
    const answers: Overrides = {};
    const { io, requests } = fixture(answers);
    const exhausted = await probeJunie(io, ENV, NOW);
    expect(routeLine(LINES, [exhausted], NOW, '2026-10-26T00:00:00Z', [])).toBe('none');
    answers.quota = response({ active: true, balanceLeft: 500000, balanceUnit: 'CREDITS' });
    const usage = await probeJunie(io, ENV, NOW);
    expect(usage).toMatchObject({ status: 'ok', planLabel: '500000 credits', windows: [{ usedPct: 50 }], snapshotAt: NOW });
    expect(routeLine(LINES, [usage], NOW, '2026-10-26T00:00:00Z', [])).toBe('junie-model high junie');
    expect(requests).toHaveLength(4);
  });

  it('keeps a small positive balance routable when the displayed percentage rounds to 100', async () => {
    const { io } = fixture({ quota: response({ active: true, balanceLeft: 1, balanceUnit: 'CREDITS' }) });
    const usage = await probeJunie(io, ENV, NOW);
    expect(usage).toMatchObject({ planLabel: '1 credits', windows: [{ usedPct: expect.closeTo(99.9999, 8) }] });
    expect(routeLine(LINES, [usage], NOW, '2026-10-26T00:00:00Z', [])).toBe('junie-model high junie');
  });

  it.each([
    [{}, TOKEN_URL, QUOTA_URL],
    [{ DANDELION_JUNIE_TOKEN_URL: '', DANDELION_JUNIE_QUOTA_URL: '' }, TOKEN_URL, QUOTA_URL],
    [{ DANDELION_JUNIE_TOKEN_URL: 'http://local/token', DANDELION_JUNIE_QUOTA_URL: 'http://local/quota' }, 'http://local/token', 'http://local/quota']
  ])('supports configured endpoint URLs %j', async (env, token, quota) => {
    const { io, requests } = fixture();
    await probeJunie(io, { ...ENV, ...env }, NOW);
    expect(requests.map(({ url }) => url)).toEqual([token, quota]);
  });

  it.each([
    ['missing credential file', { omitAuth: true }],
    ['missing secrets', { auth: '{}' }],
    ['non-array secrets', { auth: '{"secrets":{}}' }],
    ['another credential only', { auth: '{"secrets":[{"key":"other","secret":"ignored"}]}' }]
  ])('keeps legacy session support with %s', async (_case, overrides) => {
    const { io, requests } = fixture(overrides);
    expect(await probeJunie(io, ENV, NOW)).toMatchObject({ status: 'ok', planLabel: '25549 credits', snapshotAt: '2026-10-25T11:59:00.000Z' });
    expect(requests).toEqual([]);
  });

  it.each<[string, Overrides, string]>([
    ['a corrupt credential file', { auth: '{' }, 'Could not parse usage from response'],
    ['an empty account secret', { auth: '{"secrets":[{"key":"jb-account-stored","secret":""}]}' }, 'junie login cannot be read — run junie'],
    ['a corrupt account secret', { auth: '{"secrets":[{"key":"jb-account-stored","secret":"{"}]}' }, 'Could not parse usage from response'],
    ['a missing refresh token', { auth: JSON.stringify({ secrets: [{ key: 'jb-account-stored', secret: '{}' }] }) }, 'junie login cannot be read — run junie'],
    ['an expired login', { token: { status: 401, body: REFRESH } }, 'junie login refresh failed: HTTP 401'],
    ['a refresh timeout', { token: { failure: 'timeout' } }, 'junie login refresh timed out after 15s'],
    ['a refresh network failure', { token: { failure: 'network' } }, 'junie login refresh failed'],
    ['an empty access token', { token: response({ access_token: '' }) }, 'junie login cannot be read — run junie'],
    ['a missing access token', { token: response({}) }, 'junie login cannot be read — run junie'],
    ['a corrupt token response', { token: { status: 200, body: '{' } }, 'Could not parse usage from response'],
    ['an HTTP quota failure', { quota: { status: 503, body: ACCESS } }, 'junie quota request failed: HTTP 503'],
    ['a quota timeout', { quota: { failure: 'timeout' } }, 'junie quota request timed out after 15s'],
    ['a quota network failure', { quota: { failure: 'network' } }, 'junie quota request failed'],
    ['an inactive account', { quota: response({ active: false, balanceLeft: 900000, balanceUnit: 'CREDITS' }) }, 'junie account is inactive — run junie'],
    ['a corrupt quota response', { quota: { status: 200, body: '{' } }, 'Could not parse usage from response'],
    ['a negative balance', { quota: response({ active: true, balanceLeft: -1, balanceUnit: 'CREDITS' }) }, 'Could not parse usage from response'],
    ['a string balance', { quota: response({ active: true, balanceLeft: '100', balanceUnit: 'CREDITS' }) }, 'Could not parse usage from response'],
    ['a different balance unit', { quota: response({ active: true, balanceLeft: 100, balanceUnit: 'USD' }) }, 'Could not parse usage from response'],
    ['a thrown request', { throws: true }, 'Could not parse usage from response']
  ])('refuses stale session fallback after %s', async (_case, overrides, reason) => {
    const { io, reads } = fixture(overrides);
    const usage = await probeJunie(io, ENV, NOW);
    expect(usage).toStrictEqual({ id: 'junie', displayName: 'junie', planLabel: 'junie', fetchedAt: NOW,
      windows: [], status: 'unavailable', reason, fix: { command: 'junie', args: [] } });
    expect(reads).not.toContain('/junie/sessions/index.jsonl');
    expect(routeLine(LINES, [usage], NOW, '2026-10-26T00:00:00Z', [])).toBe('none');
    expect(JSON.stringify(usage)).not.toContain(REFRESH);
    expect(JSON.stringify(usage)).not.toContain(ACCESS);
  });
});
