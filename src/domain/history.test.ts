import { describe, expect, it, vi } from 'vitest';
import { openHistory } from './history.ts';

const NOW = '2026-09-30T12:00:00.000Z';
const OK = { id: 'claude', status: 'ok', windows: [{ label: 'weekly', usedPct: 40, resetsAt: '2026-10-01T00:00:00.000Z' }, { label: 'session', usedPct: 5 }] };
const FAILED = { id: 'kimi', status: 'error', windows: [{ label: 'weekly', usedPct: 1 }] };

function opened(text: string | Error, env: Record<string, string | undefined> = {}, ok = true) {
  const replace = vi.fn<(path: string, text: string) => boolean>(() => ok);
  const read = () => {
    if (text instanceof Error) throw text;
    return text;
  };
  return { history: openHistory(env, '/home/u', { read, replace }), replace };
}

describe('usage history', () => {
  it('records one sample per window of each ok provider and skips failed ones', () => {
    const { history, replace } = opened('[]');
    expect(history.record([OK, FAILED], NOW)).toBe(true);
    expect(history.samples('claude')).toEqual([
      { id: 'claude', label: 'weekly', usedPct: 40, resetsAt: '2026-10-01T00:00:00.000Z', at: NOW },
      { id: 'claude', label: 'session', usedPct: 5, at: NOW }
    ]);
    expect(history.samples('kimi')).toEqual([]);
    expect(replace.mock.calls[0][0]).toBe('/home/u/.local/state/dandelion/history.json');
    expect(JSON.parse(replace.mock.calls[0][1])).toHaveLength(2);
  });

  it.each([
    ['XDG_STATE_HOME', { XDG_STATE_HOME: '/x' }, '/x/dandelion/history.json'],
    ['DANDELION_STATE_FILE', { DANDELION_STATE_FILE: '/s/el.json' }, '/s/history.json'],
    ['DANDELION_HISTORY_FILE', { DANDELION_STATE_FILE: '/s/el.json', DANDELION_HISTORY_FILE: '/h/h.json' }, '/h/h.json']
  ])('finds the file through %s', (_name, env, path) => {
    const { history, replace } = opened('[]', env);
    history.record([OK], NOW);
    expect(replace.mock.calls[0][0]).toBe(path);
  });

  it.each([['missing', new Error('ENOENT')], ['corrupt', '{nope'], ['not a list', '{"a":1}']])('starts empty when the file is %s', (_name, text) => {
    const { history } = opened(text);
    expect(history.samples('claude')).toEqual([]);
    expect(history.record([OK], NOW)).toBe(true);
    expect(history.samples('claude')).toHaveLength(2);
  });

  it('drops malformed entries, samples older than 30 days and all but the newest 20000', () => {
    const good = { id: 'a', label: 'w', usedPct: 1, at: '2026-09-29T00:00:00.000Z' };
    const old = { ...good, at: '2026-08-01T00:00:00.000Z' };
    const stored = [good, old, null, { ...good, usedPct: 'x' }, { ...good, at: 'nope' }, { ...good, id: 3 }, { ...good, label: 3 }, { ...good, at: 3 }, { ...good, resetsAt: 3 }];
    const { history } = opened(JSON.stringify(stored));
    history.record([], NOW);
    expect(history.samples('a')).toEqual([good]);
    const many = opened(JSON.stringify(Array.from({ length: 20005 }, (_, index) => ({ ...good, usedPct: index }))));
    many.history.record([], NOW);
    const kept = many.history.samples('a');
    expect(kept).toHaveLength(20000);
    expect(kept[0].usedPct).toBe(5);
  });

  it('keeps its samples in memory and reports false when the write fails', () => {
    const { history } = opened('[]', {}, false);
    expect(history.record([OK], NOW)).toBe(false);
    expect(history.samples('claude')).toEqual([]);
  });
});
