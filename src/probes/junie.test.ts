import { describe, expect, it } from 'vitest';
import type { FileReader } from '../domain/index.ts';
import { probeJunie, type JunieIo } from './junie.ts';

const NOW = '2026-09-18T19:00:00Z';
const JETBRAINS = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.JetBrains';
const UNKNOWN = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.Unknown';
const INDEX = [
  '{"sessionId":"session-old","createdAt":1789735398143,"updatedAt":1789735405438,"projectDir":"/w","taskName":"Old","status":"Sending LLM request"}',
  'not json at all',
  '{"sessionId":"session-new","createdAt":1789735553568,"updatedAt":1789735558242,"projectDir":"/w/d","taskName":"Respond with Pong Only"}'
].join('\n');

function snapshotLine(endedAtMs: unknown, balanceLeft: unknown, type = JETBRAINS): string {
  const agentEvent = { kind: 'ResultBlockUpdatedEvent', result: '### Summary\n- pong', errorCode: 'Submit' };
  const completion = { endedAtMs, taskCostUsd: 0.0334116, quota: { type, balanceUnit: 'CREDITS', balanceLeft } };
  return JSON.stringify({ kind: 'SessionA2uxEvent', event: { state: 'IN_PROGRESS', agentEvent }, completion, timestampMs: 1789735651257 });
}

const NOISE = ['{"kind":"SessionA2uxEvent","event":{"state":"IN_PROGRESS"},"timestampMs":1789735600000}', '{"kind":"UserPromptEvent","prompt":"ping"}'];
const OLD_EVENTS = snapshotLine(1789730000000, 900000);
const NEW_EVENTS = [
  ...NOISE,
  snapshotLine(1789735651253, 704863.73775),
  JSON.stringify({ kind: 'SessionA2uxEvent', completion: { endedAtMs: 1789735700000, quota: { type: UNKNOWN } } }),
  'not json at all',
  snapshotLine(1789736030118, 701512.73275)
].join('\n');

const UNAVAILABLE = {
  id: 'junie',
  displayName: 'junie',
  planLabel: 'junie',
  fetchedAt: NOW,
  windows: [],
  status: 'unavailable',
  reason: 'no junie quota snapshot — run junie once'
};

function readerOf(files: Record<string, string>, home = '/home/tester') {
  const reads: string[] = [];
  const reader: FileReader = {
    homeDir: () => home,
    read: async (path) => {
      reads.push(path);
      return files[path];
    },
    isDirectory: async () => false
  };
  const io: JunieIo = { reader };
  return { io, reads };
}

function homeWith(newEvents: string, root = '/junie'): Record<string, string> {
  return {
    [`${root}/sessions/index.jsonl`]: INDEX,
    [`${root}/sessions/session-old/events.jsonl`]: OLD_EVENTS,
    [`${root}/sessions/session-new/events.jsonl`]: newEvents
  };
}

const HOME = { DANDELION_JUNIE_HOME: '/junie' };

describe('probeJunie', () => {
  it('reads the newest snapshot of the newest session with a credits window against the default reference', async () => {
    const { io, reads } = readerOf(homeWith(NEW_EVENTS));
    expect(await probeJunie(io, HOME, NOW)).toStrictEqual({
      id: 'junie',
      displayName: 'junie',
      fetchedAt: NOW,
      planLabel: '701513 credits',
      windows: [{ label: 'credits', kind: 'weekly', usedPct: 30 }],
      status: 'ok',
      snapshotAt: '2026-09-18T12:53:50.118Z'
    });
    expect(reads).toEqual(['/junie/sessions/index.jsonl', '/junie/sessions/session-new/events.jsonl']);
  });

  it.each([[{}], [{ DANDELION_JUNIE_HOME: '' }]])('defaults junie home to ~/.junie for %j', async (env) => {
    const { io, reads } = readerOf(homeWith(NEW_EVENTS, '/home/tester/.junie'));
    expect(await probeJunie(io, env, NOW)).toMatchObject({ status: 'ok', planLabel: '701513 credits', windows: [{ usedPct: 30 }] });
    expect(reads[0]).toBe('/home/tester/.junie/sessions/index.jsonl');
  });

  it.each<[string, number]>([
    ['2000000', 65],
    ['500000', 0],
    ['abc', 30],
    ['0', 30],
    ['-5', 30],
    ['Infinity', 30]
  ])('uses the reference %s for %i%% used', async (reference, usedPct) => {
    const usage = await probeJunie(readerOf(homeWith(NEW_EVENTS)).io, { ...HOME, DANDELION_JUNIE_REFERENCE: reference }, NOW);
    expect(usage.windows).toStrictEqual([{ label: 'credits', kind: 'weekly', usedPct }]);
  });

  it('shows the balance with a note and no windows when the reference is empty', async () => {
    const usage = await probeJunie(readerOf(homeWith(NEW_EVENTS)).io, { ...HOME, DANDELION_JUNIE_REFERENCE: '' }, NOW);
    expect(usage).toStrictEqual({
      id: 'junie',
      displayName: 'junie',
      fetchedAt: NOW,
      planLabel: '701513 credits',
      windows: [],
      status: 'ok',
      snapshotAt: '2026-09-18T12:53:50.118Z',
      note: 'balance without a reference'
    });
  });

  it.each<[unknown, number, string]>([
    [1000000.4, 0, '1000000 credits'],
    [2000000, 0, '2000000 credits'],
    [0, 100, '0 credits']
  ])('clamps a balance of %j to %i%% used', async (balance, usedPct, planLabel) => {
    const usage = await probeJunie(readerOf(homeWith(`${NEW_EVENTS}\n${snapshotLine(1789736100000, balance)}`)).io, HOME, NOW);
    expect(usage).toMatchObject({ planLabel, windows: [{ usedPct }], snapshotAt: '2026-09-18T12:55:00.000Z' });
  });

  it.each<[string, unknown, unknown]>([
    ['a negative balance', 1789736100000, -1],
    ['a string balance', 1789736100000, '701512'],
    ['a missing balance', 1789736100000, undefined],
    ['a string endedAtMs', '1789736100000', 5],
    ['an endedAtMs out of range', 1e300, 5],
    ['a missing endedAtMs', undefined, 5]
  ])('skips a JetBrains line with %s for an earlier one in the same file', async (_case, endedAtMs, balance) => {
    const events = [...NOISE, snapshotLine(1789735651253, 704863.73775), snapshotLine(endedAtMs, balance)].join('\n');
    const usage = await probeJunie(readerOf(homeWith(events)).io, HOME, NOW);
    expect(usage).toMatchObject({ planLabel: '704864 credits', windows: [{ usedPct: 30 }], snapshotAt: '2026-09-18T12:47:31.253Z' });
  });

  it('skips a line that only names the JetBrains type outside the quota', async () => {
    const echo = JSON.stringify({ kind: 'UserPromptEvent', prompt: JETBRAINS, completion: { endedAtMs: 1789736100000, quota: { type: 'x', balanceLeft: 1 } } });
    const usage = await probeJunie(readerOf(homeWith(`${OLD_EVENTS}\n${echo}`)).io, HOME, NOW);
    expect(usage).toMatchObject({ planLabel: '900000 credits', windows: [{ usedPct: 10 }] });
  });

  it('falls back to an older session when the newest holds only Unknown lines and noise', async () => {
    const events = [...NOISE, snapshotLine(1789735700000, undefined, UNKNOWN), 'not json at all'].join('\n');
    const { io, reads } = readerOf(homeWith(events));
    expect(await probeJunie(io, HOME, NOW)).toMatchObject({ status: 'ok', planLabel: '900000 credits', windows: [{ usedPct: 10 }], snapshotAt: '2026-09-18T11:13:20.000Z' });
    expect(reads).toEqual(['/junie/sessions/index.jsonl', '/junie/sessions/session-new/events.jsonl', '/junie/sessions/session-old/events.jsonl']);
  });

  it('skips index lines without a string sessionId or a finite updatedAt', async () => {
    const index = ['{"sessionId":7,"updatedAt":1}', '{"sessionId":"session-new","updatedAt":"9"}', '{"sessionId":"session-new"}', '[]', 'null', INDEX.split('\n')[0]].join('\n');
    const { io, reads } = readerOf({ ...homeWith(NEW_EVENTS), '/junie/sessions/index.jsonl': index });
    expect(await probeJunie(io, HOME, NOW)).toMatchObject({ planLabel: '900000 credits' });
    expect(reads).toEqual(['/junie/sessions/index.jsonl', '/junie/sessions/session-old/events.jsonl']);
  });

  it.each<[string, Record<string, string>]>([
    ['a missing home', {}],
    ['an empty index', { '/junie/sessions/index.jsonl': '' }],
    ['an index of only bad lines', { '/junie/sessions/index.jsonl': 'not json at all' }],
    ['sessions whose events files are missing', { '/junie/sessions/index.jsonl': INDEX }],
    ['only Unknown lines, noise and bad lines', homeWith([...NOISE, snapshotLine(1789735700000, undefined, UNKNOWN), 'not json at all', snapshotLine(1789735700000, -1)].join('\n'))]
  ])('is unavailable with %s', async (_case, files) => {
    const withoutOld = { ...files };
    delete withoutOld['/junie/sessions/session-old/events.jsonl'];
    expect(await probeJunie(readerOf(withoutOld).io, HOME, NOW)).toStrictEqual(UNAVAILABLE);
  });
});
