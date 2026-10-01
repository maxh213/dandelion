import { describe, expect, it } from 'vitest';
import type { FetchOutcome } from '../domain/index.ts';
import { probeClaudeStatus, probeCursorStatus, probeOpenAiStatus } from './status.ts';

const DEFAULT_URL = 'https://status.claude.com/api/v2/status.json';

function bodyOf(indicator: unknown, description: unknown = 'Partial System Outage'): string {
  return JSON.stringify({ status: { indicator, description } });
}

function probeWith(outcome: FetchOutcome, env: Record<string, string | undefined> = {}) {
  const requests: [string, Record<string, string>, number][] = [];
  const fetcher = {
    get: async (url: string, headers: Record<string, string>, timeoutMs: number) => {
      requests.push([url, headers, timeoutMs]);
      return outcome;
    }
  };
  return { result: probeClaudeStatus({ fetcher }, env), requests };
}

describe('probeClaudeStatus', () => {
  it('fetches the default url with no headers and a 10s timeout', async () => {
    const { result, requests } = probeWith({ status: 200, body: bodyOf('none', 'All Systems Operational') });
    await result;
    expect(requests).toEqual([[DEFAULT_URL, {}, 10000]]);
  });

  it('uses DANDELION_CLAUDE_STATUS_URL when non-empty and the default when empty', async () => {
    const custom = probeWith({ status: 200, body: bodyOf('none') }, { DANDELION_CLAUDE_STATUS_URL: 'http://127.0.0.1:1/s.json' });
    await custom.result;
    expect(custom.requests[0][0]).toBe('http://127.0.0.1:1/s.json');
    const empty = probeWith({ status: 200, body: bodyOf('none') }, { DANDELION_CLAUDE_STATUS_URL: '' });
    await empty.result;
    expect(empty.requests[0][0]).toBe(DEFAULT_URL);
  });

  it('is warm for minor', async () => {
    expect(await probeWith({ status: 200, body: bodyOf('minor', 'Degraded') }).result).toEqual({ severity: 'warm', description: 'Degraded' });
  });

  it.each(['major', 'critical'])('is hot for %s', async (indicator) => {
    expect(await probeWith({ status: 200, body: bodyOf(indicator) }).result).toEqual({ severity: 'hot', description: 'Partial System Outage' });
  });

  it.each([
    ['none', { status: 200, body: bodyOf('none', 'All Systems Operational') }],
    ['a missing indicator', { status: 200, body: bodyOf(undefined) }],
    ['a numeric indicator', { status: 200, body: bodyOf(2) }],
    ['a missing description', { status: 200, body: bodyOf('major', null) }],
    ['an empty description', { status: 200, body: bodyOf('major', '') }],
    ['a body without status', { status: 200, body: '{}' }],
    ['invalid json', { status: 200, body: 'not json' }],
    ['a 500', { status: 500, body: bodyOf('major') }],
    ['a 404', { status: 404, body: bodyOf('major') }],
    ['a timeout', { failure: 'timeout' }],
    ['a network failure', { failure: 'network' }]
  ] as [string, FetchOutcome][])('shows nothing for %s', async (_name, outcome) => {
    expect(await probeWith(outcome).result).toBeUndefined();
  });

  it('strips control characters from the description', async () => {
    const dirty = '\u001b[2J\u001b]0;x\u0007\r\nPartial outage\r\n\u007f\u0085';
    const result = await probeWith({ status: 200, body: bodyOf('major', dirty) }).result;
    expect(result?.description).toContain('Partial outage');
    expect(result?.description).not.toMatch(/\p{Cc}/u);
  });

  it('shows nothing when only control characters remain', async () => {
    expect(await probeWith({ status: 200, body: bodyOf('major', '\u001b[2J\u0007\r\n\u007f') }).result).toBeUndefined();
  });
});

describe.each([
  ['probeOpenAiStatus', probeOpenAiStatus, 'DANDELION_OPENAI_STATUS_URL', 'https://status.openai.com/api/v2/status.json'],
  ['probeCursorStatus', probeCursorStatus, 'DANDELION_CURSOR_STATUS_URL', 'https://status.cursor.com/api/v2/status.json']
])('%s', (_name, probe, variable, defaultUrl) => {
  function run(outcome: FetchOutcome, env: Record<string, string | undefined> = {}) {
    const requests: [string, Record<string, string>, number][] = [];
    const fetcher = {
      get: async (url: string, headers: Record<string, string>, timeoutMs: number) => {
        requests.push([url, headers, timeoutMs]);
        return outcome;
      }
    };
    return { result: probe({ fetcher }, env), requests };
  }

  it('fetches the default url with no headers and a 10s timeout', async () => {
    const { result, requests } = run({ status: 200, body: bodyOf('none') });
    await result;
    expect(requests).toEqual([[defaultUrl, {}, 10000]]);
  });

  it('uses the env url when non-empty and the default when empty', async () => {
    const custom = run({ status: 200, body: bodyOf('none') }, { [variable]: 'http://127.0.0.1:1/s.json' });
    await custom.result;
    expect(custom.requests[0][0]).toBe('http://127.0.0.1:1/s.json');
    const empty = run({ status: 200, body: bodyOf('none') }, { [variable]: '' });
    await empty.result;
    expect(empty.requests[0][0]).toBe(defaultUrl);
  });

  it('maps minor to warm, major to hot, none to nothing', async () => {
    expect(await run({ status: 200, body: bodyOf('minor', 'Partial System Degradation') }).result).toEqual({ severity: 'warm', description: 'Partial System Degradation' });
    expect(await run({ status: 200, body: bodyOf('major') }).result).toEqual({ severity: 'hot', description: 'Partial System Outage' });
    expect(await run({ status: 200, body: bodyOf('none') }).result).toBeUndefined();
  });

  it.each([
    ['a timeout', { failure: 'timeout' }],
    ['a 503', { status: 503, body: bodyOf('major') }],
    ['invalid json', { status: 200, body: '<html>' }]
  ] as [string, FetchOutcome][])('shows nothing for %s', async (_n, outcome) => {
    expect(await run(outcome).result).toBeUndefined();
  });
});
