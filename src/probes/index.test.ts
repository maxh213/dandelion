import { describe, it, expect } from 'vitest';
import { providerProbes, type ProbeIo } from './index.ts';

const IDLE_IO: ProbeIo = {
  runner: { run: async () => ({ stdout: '', stderr: '', failure: 'missing' }) },
  launcher: { launch: async () => undefined },
  fetcher: { get: async () => ({ failure: 'network' }), post: async () => ({ failure: 'network' }) },
  reader: { homeDir: () => '/home/tester', read: async () => undefined },
  spawner: { spawn: () => ({ lines: noLines(), send: () => undefined, stop: async () => undefined }) }
};

async function* noLines(): AsyncIterable<string> {
  yield* [];
}

describe('providerProbes', () => {
  it('lists the seven probes in panel order', () => {
    expect(providerProbes(IDLE_IO, {}).map(({ id }) => id)).toEqual(['claude', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo']);
  });
});
