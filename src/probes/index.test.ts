import { describe, it, expect, vi } from 'vitest';
import { providerProbes, type ProbeIo } from './index.ts';

const IDLE_IO: ProbeIo = {
  runner: { run: async () => ({ stdout: '', stderr: '', failure: 'missing' }) },
  launcher: { launch: async () => undefined },
  fetcher: { get: async () => ({ failure: 'network' }), post: async () => ({ failure: 'network' }) },
  reader: { homeDir: () => '/home/tester', read: async () => undefined, isDirectory: async () => false },
  spawner: { spawn: () => ({ lines: noLines(), send: () => undefined, stop: async () => undefined }) }
};

async function* noLines(): AsyncIterable<string> {
  yield* [];
}

describe('providerProbes', () => {
  it('lists the nine probes in panel order', () => {
    expect(providerProbes(IDLE_IO, {}).map(({ id }) => id)).toEqual(['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'kilo']);
  });

  it('probes junie from the junie home in env', async () => {
    const read = vi.fn(IDLE_IO.reader.read);
    const junie = providerProbes({ ...IDLE_IO, reader: { ...IDLE_IO.reader, read } }, { DANDELION_JUNIE_HOME: '/j' }).find(({ id }) => id === 'junie');
    expect(await junie?.probe('now')).toMatchObject({ id: 'junie', status: 'unavailable', reason: 'no junie quota snapshot — run junie once' });
    expect(read).toHaveBeenCalledWith('/j/sessions/index.jsonl');
  });

  it('never runs claude for the work account without its config dir', async () => {
    const run = vi.fn(IDLE_IO.runner.run);
    const [, work] = providerProbes({ ...IDLE_IO, runner: { run } }, { DANDELION_CLAUDE_WORK_CONFIG_DIR: '/work' });
    expect(await work.probe('now')).toMatchObject({ id: 'claude-work', status: 'unavailable', reason: expect.stringMatching(/^no work claude config/) });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs claude for the work account with CLAUDE_CONFIG_DIR once its config dir exists', async () => {
    const run = vi.fn(IDLE_IO.runner.run);
    const io = { ...IDLE_IO, runner: { run }, reader: { ...IDLE_IO.reader, isDirectory: async (path: string) => path === '/work' } };
    const [, work] = providerProbes(io, { DANDELION_CLAUDE_WORK_CONFIG_DIR: '/work' });
    expect(await work.probe('now')).toMatchObject({ id: 'claude-work', status: 'unavailable', reason: 'claude CLI not found in PATH' });
    expect(run).toHaveBeenCalledWith('claude', ['-p', '/usage'], 90000, { CLAUDE_CONFIG_DIR: '/work' });
  });
});
