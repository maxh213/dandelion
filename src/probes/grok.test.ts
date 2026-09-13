import { describe, expect, it } from 'vitest';
import type { UsageWindow } from '../domain/index.ts';
import { probeGrok, type FileReader, type GrokIo } from './grok.ts';

const NOW = '2026-09-13T10:00:00Z';
const PERIOD = { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T21:15:36.133376+00:00', end: '2026-09-13T21:15:36.133376+00:00' };
const EVENT_60 = { ts: '2026-09-11T09:00:00.000Z', msg: 'billing: fetched credits config', ctx: { config: { creditUsagePercent: 60.0, currentPeriod: PERIOD }, subscriptionTier: 'SuperGrok' } };
const EVENT_75 = { ts: '2026-09-12T16:00:00.000Z', msg: 'billing: fetched credits config', ctx: { config: { creditUsagePercent: 75.0, currentPeriod: PERIOD }, subscriptionTier: 'SuperGrok Heavy' } };
const BACKGROUND = [
  '{"ts":"2026-09-11T08:00:00.000Z","msg":"session started","ctx":{}}',
  JSON.stringify(EVENT_60),
  'not json at all',
  JSON.stringify(EVENT_75),
  '{"ts":"2026-09-12T16:00:01.000Z","msg":"tool call finished","ctx":{"tool":"bash"}}'
].join('\n');
const UNUSABLE = [
  '{"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":"90"}}}',
  '{"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":-5}}}',
  '{"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":null}}',
  '{"ts":"later","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":95}}}',
  '{"msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":95}}}',
  '{"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config"',
  '[1,2,3]',
  'null',
  ''
].join('\n');
const LONG_UNUSABLE = Array.from({ length: 50000 }, () => '{"msg":"billing: fetched credits config","ts":"x"}').join('\n');
const UNAVAILABLE = {
  id: 'grok',
  displayName: 'grok',
  planLabel: 'grok',
  fetchedAt: NOW,
  windows: [],
  status: 'unavailable',
  reason: 'no grok billing snapshot — run grok once'
};

function readerOf(files: Record<string, string>, home = '/home/tester') {
  const reads: string[] = [];
  const reader: FileReader = {
    homeDir: () => home,
    read: async (path) => {
      reads.push(path);
      return files[path];
    }
  };
  const io: GrokIo = { reader };
  return { io, reads };
}

function ioWithLog(log: string): GrokIo {
  return readerOf({ '/grok/logs/unified.jsonl': log }).io;
}

const HOME = { ALLOWANCE_GROK_HOME: '/grok' };

describe('probeGrok', () => {
  it('reads the newest billing snapshot from the grok home log', async () => {
    const { io, reads } = readerOf({ '/grok/logs/unified.jsonl': BACKGROUND });
    expect(await probeGrok(io, HOME, NOW)).toStrictEqual({
      id: 'grok',
      displayName: 'grok',
      planLabel: 'SuperGrok Heavy',
      fetchedAt: NOW,
      windows: [{ label: 'credits', usedPct: 75, resetsAt: '2026-09-13T21:15:36.133376+00:00' }],
      status: 'ok',
      snapshotAt: '2026-09-12T16:00:00.000Z'
    });
    expect(reads).toEqual(['/grok/logs/unified.jsonl']);
  });

  it.each([[{}], [{ ALLOWANCE_GROK_HOME: '' }]])('defaults grok home to ~/.grok for %j', async (env) => {
    const { io, reads } = readerOf({ '/home/tester/.grok/logs/unified.jsonl': BACKGROUND });
    const usage = await probeGrok(io, env, NOW);
    expect(reads).toEqual(['/home/tester/.grok/logs/unified.jsonl']);
    expect(usage).toMatchObject({ status: 'ok', planLabel: 'SuperGrok Heavy', windows: [{ usedPct: 75 }] });
  });

  it('finds a snapshot on the first line behind a leading newline and trailing blank lines', async () => {
    const usage = await probeGrok(ioWithLog(`\n${JSON.stringify(EVENT_60)}\n${'{"msg":"noise"}\n'.repeat(3)}\n`), HOME, NOW);
    expect(usage).toMatchObject({ status: 'ok', planLabel: 'SuperGrok', snapshotAt: '2026-09-11T09:00:00.000Z', windows: [{ usedPct: 60 }] });
  });

  it('skips unusable billing events in favour of an older usable one', async () => {
    const usage = await probeGrok(ioWithLog(`${BACKGROUND}\n${UNUSABLE}`), HOME, NOW);
    expect(usage).toMatchObject({ status: 'ok', planLabel: 'SuperGrok Heavy', snapshotAt: '2026-09-12T16:00:00.000Z', windows: [{ usedPct: 75 }] });
  });

  it('finds an older usable snapshot behind 50,000 unusable billing lines', async () => {
    const usage = await probeGrok(ioWithLog(`${JSON.stringify(EVENT_60)}\n${LONG_UNUSABLE}`), HOME, NOW);
    expect(usage).toMatchObject({ status: 'ok', planLabel: 'SuperGrok', snapshotAt: '2026-09-11T09:00:00.000Z', windows: [{ usedPct: 60 }] });
  });

  it('finds a snapshot whose line is longer than the first scan chunk', async () => {
    const event = { ...EVENT_60, ctx: { ...EVENT_60.ctx, padding: 'x'.repeat(70000) } };
    const usage = await probeGrok(ioWithLog(`${JSON.stringify(EVENT_75)}\n${JSON.stringify(event)}\n${'{"msg":"noise"}\n'.repeat(2)}`), HOME, NOW);
    expect(usage).toMatchObject({ status: 'ok', planLabel: 'SuperGrok', snapshotAt: '2026-09-11T09:00:00.000Z' });
  });

  it.each<[string, unknown, { planLabel: string; windows: UsageWindow[] }]>([
    ['no tier or period', { creditUsagePercent: 75 }, { planLabel: 'grok', windows: [{ label: 'credits', usedPct: 75 }] }],
    ['an empty tier and a half percent', { creditUsagePercent: 33.5 }, { planLabel: 'grok', windows: [{ label: 'credits', usedPct: 34 }] }],
    ['a zero percent', { creditUsagePercent: 0 }, { planLabel: 'grok', windows: [{ label: 'credits', usedPct: 0 }] }],
    ['a bad period end', { creditUsagePercent: 130, currentPeriod: { end: 'soon' } }, { planLabel: 'SuperGrok', windows: [{ label: 'credits', usedPct: 130 }] }],
    ['a null period', { creditUsagePercent: 75, currentPeriod: null }, { planLabel: 'grok', windows: [{ label: 'credits', usedPct: 75 }] }]
  ])('reads an event with %s', async (name, config, expected) => {
    const tiers: Record<string, unknown> = { 'an empty tier and a half percent': '', 'a zero percent': 7, 'a bad period end': 'SuperGrok' };
    const event = { ts: '2026-09-13T09:00:00Z', msg: 'billing: fetched credits config', ctx: { config, subscriptionTier: tiers[name] } };
    const usage = await probeGrok(ioWithLog(JSON.stringify(event)), HOME, NOW);
    expect(usage).toMatchObject({ status: 'ok', snapshotAt: '2026-09-13T09:00:00Z', ...expected });
    expect(usage.windows).toStrictEqual(expected.windows);
  });

  it.each<[string, Record<string, string>]>([
    ['a missing log', {}],
    ['an empty log', { '/grok/logs/unified.jsonl': '' }],
    ['only non-billing lines', { '/grok/logs/unified.jsonl': BACKGROUND.split('\n').filter((line) => !line.includes('billing')).join('\n') }],
    ['only unusable billing events', { '/grok/logs/unified.jsonl': UNUSABLE }],
    ['50,000 unusable billing lines', { '/grok/logs/unified.jsonl': LONG_UNUSABLE }],
    ['the billing message outside msg', { '/grok/logs/unified.jsonl': '\n{"ts":"2026-09-13T09:00:00Z","msg":"echo","ctx":{"text":"billing: fetched credits config","config":{"creditUsagePercent":5}}}\n\n' }],
    ['a date-like but invalid ts',{ '/grok/logs/unified.jsonl': '{"ts":"2026-02-30T99:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":5}}}' }]
  ])('is unavailable with %s', async (_case, files) => {
    expect(await probeGrok(readerOf(files).io, HOME, NOW)).toStrictEqual(UNAVAILABLE);
  });
});
