import { describe, expect, it } from 'vitest';
import type { FileReader } from '../domain/index.ts';
import { probeJunie, type JunieIo } from './junie.ts';

const NOW = '2026-09-18T19:00:00Z';
const JETBRAINS = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.JetBrains';
const UNKNOWN = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.Unknown';
const SNAPSHOT_SUFFIX = 'TaskQuotaSnapshot.JetBrains';
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
  reason: 'no junie quota snapshot — run junie once',
  fix: { command: 'junie', args: [] }
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
  it.each([
    ['older than 48h', '2026-09-20T12:53:50.119Z', { command: 'junie', args: [] }],
    ['exactly 48h old', '2026-09-20T12:53:50.118Z', undefined],
    ['fresh', NOW, undefined]
  ])('suggests running junie for a snapshot %s only when it is stale', async (_case, now, fix) => {
    const usage = await probeJunie(readerOf(homeWith(NEW_EVENTS)).io, HOME, now);
    expect(usage.fix).toEqual(fix);
  });

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
    ['1500000', 53],
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
    ['an ISO string endedAtMs', '2026-09-18T12:55:00.000Z', 5],
    ['a null endedAtMs', null, 5],
    ['an endedAtMs out of range', 1e300, 5],
    ['a missing endedAtMs', undefined, 5]
  ])('skips a JetBrains line with %s for an earlier one in the same file', async (_case, endedAtMs, balance) => {
    const events = [...NOISE, snapshotLine(1789735651253, 704863.73775), snapshotLine(endedAtMs, balance)].join('\n');
    const usage = await probeJunie(readerOf(homeWith(events)).io, HOME, NOW);
    expect(usage).toMatchObject({ planLabel: '704864 credits', windows: [{ usedPct: 30 }], snapshotAt: '2026-09-18T12:47:31.253Z' });
  });

  it.each<[string, string]>([
    ['outside the quota', JSON.stringify({ kind: 'UserPromptEvent', prompt: JETBRAINS, completion: { endedAtMs: 1789736100000, quota: { type: 'x', balanceLeft: 1 } } })],
    ['without a completion', JSON.stringify({ kind: 'UserPromptEvent', prompt: JETBRAINS })],
    ['beside a numeric quota type', JSON.stringify({ prompt: JETBRAINS, completion: { endedAtMs: 1789736100000, quota: { type: 7, balanceLeft: 1 } } })],
    ['at the start of the quota type', JSON.stringify({ completion: { endedAtMs: 1789736100000, quota: { type: `${SNAPSHOT_SUFFIX}.Unknown`, balanceLeft: 1 } } })],
    ['on a line cut short while junie is still appending', snapshotLine(1789736100000, 5).slice(0, -20)]
  ])('skips a line that names the JetBrains type %s for an earlier snapshot', async (_case, line) => {
    const usage = await probeJunie(readerOf(homeWith(`${OLD_EVENTS}\n${line}`)).io, HOME, NOW);
    expect(usage).toMatchObject({ status: 'ok', planLabel: '900000 credits', windows: [{ usedPct: 10 }], snapshotAt: '2026-09-18T11:13:20.000Z' });
  });

  it.each<[string, string]>([
    ['on the only line', OLD_EVENTS],
    ['on the first line behind a leading newline and ahead of trailing blank lines', `\n${OLD_EVENTS}\n${`${NOISE[0]}\n`.repeat(3)}\n`],
    ['on the first line ahead of noise without a trailing newline', [OLD_EVENTS, ...NOISE].join('\n')],
    ['on the last line behind a trailing newline', `${NOISE.join('\n')}\n${OLD_EVENTS}\n`]
  ])('finds a snapshot %s', async (_case, events) => {
    const usage = await probeJunie(readerOf(homeWith(events)).io, HOME, NOW);
    expect(usage).toMatchObject({ status: 'ok', planLabel: '900000 credits', snapshotAt: '2026-09-18T11:13:20.000Z' });
  });

  it('finds an older usable snapshot behind 50,000 unusable JetBrains lines', async () => {
    const unusable = Array.from({ length: 50000 }, () => snapshotLine(1789736100000, -1)).join('\n');
    const usage = await probeJunie(readerOf(homeWith(`${snapshotLine(1789735651253, 704863.73775)}\n${unusable}`)).io, HOME, NOW);
    expect(usage).toMatchObject({ status: 'ok', planLabel: '704864 credits', snapshotAt: '2026-09-18T12:47:31.253Z' });
  });

  it('falls back to an older session when the newest holds only Unknown lines and noise', async () => {
    const events = [...NOISE, snapshotLine(1789735700000, undefined, UNKNOWN), 'not json at all'].join('\n');
    const { io, reads } = readerOf(homeWith(events));
    expect(await probeJunie(io, HOME, NOW)).toMatchObject({ status: 'ok', planLabel: '900000 credits', windows: [{ usedPct: 10 }], snapshotAt: '2026-09-18T11:13:20.000Z' });
    expect(reads).toEqual(['/junie/sessions/index.jsonl', '/junie/sessions/session-new/events.jsonl', '/junie/sessions/session-old/events.jsonl']);
  });

  it('skips index lines without a string sessionId or a finite updatedAt', async () => {
    const index = ['{"sessionId":7,"updatedAt":9999999999999}', '{"sessionId":"session-new","updatedAt":"9999999999999"}', '{"sessionId":"session-new"}', '[]', 'null', INDEX.split('\n')[0]].join('\n');
    const { io, reads } = readerOf({ ...homeWith(NEW_EVENTS), '/junie/sessions/7/events.jsonl': snapshotLine(1789736100000, 5), '/junie/sessions/index.jsonl': index });
    expect(await probeJunie(io, HOME, NOW)).toMatchObject({ planLabel: '900000 credits' });
    expect(reads).toEqual(['/junie/sessions/index.jsonl', '/junie/sessions/session-old/events.jsonl']);
  });

  it('visits a resumed session first when its updatedAt is the newest', async () => {
    const index = ['{"sessionId":"session-old","createdAt":1789735398143,"updatedAt":1789739999999}', '{"sessionId":"session-new","createdAt":1789735553568,"updatedAt":1789735558242}'].join('\n');
    const { io, reads } = readerOf({ ...homeWith(NEW_EVENTS), '/junie/sessions/index.jsonl': index });
    expect(await probeJunie(io, HOME, NOW)).toMatchObject({ planLabel: '900000 credits', snapshotAt: '2026-09-18T11:13:20.000Z' });
    expect(reads).toEqual(['/junie/sessions/index.jsonl', '/junie/sessions/session-old/events.jsonl']);
  });

  it.each<[string, Record<string, string>, string[]]>([
    ['a missing home', {}, []],
    ['an empty index', { '/junie/sessions/index.jsonl': '' }, []],
    ['an index of only bad lines', { '/junie/sessions/index.jsonl': 'not json at all' }, []],
    ['sessions whose events files are missing', { '/junie/sessions/index.jsonl': INDEX }, ['session-new', 'session-old']],
    ['only Unknown lines, noise and bad lines', homeWith([...NOISE, snapshotLine(1789735700000, undefined, UNKNOWN), 'not json at all', snapshotLine(1789735700000, -1)].join('\n')), ['session-new', 'session-old']],
    ['an empty events file', homeWith(''), ['session-new', 'session-old']],
    ['a bad first line and no JetBrains line', homeWith(['not json at all', ...NOISE].join('\n')), ['session-new', 'session-old']]
  ])('is unavailable with %s', async (_case, files, visited) => {
    const withoutOld = { ...files };
    delete withoutOld['/junie/sessions/session-old/events.jsonl'];
    const { io, reads } = readerOf(withoutOld);
    expect(await probeJunie(io, HOME, NOW)).toStrictEqual(UNAVAILABLE);
    expect(reads).toEqual(['/junie/sessions/index.jsonl', ...visited.map((id) => `/junie/sessions/${id}/events.jsonl`)]);
  });
});
