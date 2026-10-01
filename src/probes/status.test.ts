import { describe, expect, it } from 'vitest';
import type { FetchOutcome } from '../domain/index.ts';
import { probeClaudeStatus } from './status.ts';

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
});
