import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { runSeats } from './index.ts';
import { parseSeatsArgs } from './seats.ts';
import type { ProbeIo } from '../probes/index.ts';

const NOW = '2026-10-29T10:00:00.000Z';
const CLOCK = { now: NOW, zone: 'UTC' };
const ROUTES_FILE = fileURLToPath(new URL('../routes.fixture.json', import.meta.url));
const IDS = ['claude', 'claude-work', 'claude-animus', 'claude-deepseek', 'claude-ollama', 'agy', 'kimi', 'grok', 'codex', 'codex-animus', 'cursor', 'junie', 'hermes', 'kilo'];
const COMMANDS = ['claude', 'codex', 'cursor-agent', 'agy', 'kimi', 'grok', 'junie', 'hermes', 'kilo'];

const DEFAULTS = { mode: 'pack', requested: 3, json: false, why: false, held: {}, cap: {}, include: [], exclude: [], trip: undefined, maxAge: undefined };

describe('parseSeatsArgs', () => {
  it('reads N alone as a plain pack request', () => {
    expect(parseSeatsArgs(['3'])).toEqual({ args: DEFAULTS });
  });

  it('reads every option, in any order', () => {
    const args = ['--spread', '--held', 'codex=2,agy=1', '12', '--json', '--why', '--include', 'claude-work', '--exclude', 'grok,kimi', '--trip', '85', '--cap', 'codex=3', '--max-age', '600'];
    expect(parseSeatsArgs(args)).toEqual({
      args: { mode: 'spread', requested: 12, json: true, why: true, held: { codex: 2, agy: 1 }, cap: { codex: 3 }, include: ['claude-work'], exclude: ['grok', 'kimi'], trip: 85, maxAge: 600 }
    });
  });

  it('takes --pack as the default mode, and lets repeated lists add up with the later value winning', () => {
    const parsed = parseSeatsArgs(['5', '--pack', '--held', 'codex=1', '--held', 'codex=2,agy=0', '--cap', 'kilo=0', '--trip', '60', '--trip', '70', '--exclude', 'grok', '--exclude', 'kimi']);
    expect(parsed.args).toMatchObject({ mode: 'pack', held: { codex: 2, agy: 0 }, cap: { kilo: 0 }, trip: 70, exclude: ['grok', 'kimi'] });
  });

  it.each<[string[], number | undefined]>([
    [['3', '--max-age', '0'], undefined],
    [['3', '--max-age', '-5'], undefined],
    [['3', '--max-age', '1.5'], undefined],
    [['3', '--max-age'], undefined],
    [['3', '--max-age', '--json'], undefined],
    [['--max-age', '30', '3'], 30]
  ])('treats %j like route --max-age: maxAge %s', (args, maxAge) => {
    expect(parseSeatsArgs(args).args?.maxAge).toBe(maxAge);
  });

  it('keeps a flag after a --max-age without a number as a flag', () => {
    expect(parseSeatsArgs(['3', '--max-age', '--json']).args?.json).toBe(true);
  });

  it.each<[string[], string]>([
    [[], 'missing N, a whole number from 1 to 200'],
    [['0'], 'N must be a whole number from 1 to 200, not 0'],
    [['201'], 'N must be a whole number from 1 to 200, not 201'],
    [['-5'], 'N must be a whole number from 1 to 200, not -5'],
    [['1.5'], 'N must be a whole number from 1 to 200, not 1.5'],
    [['three'], 'N must be a whole number from 1 to 200, not three'],
    [['3', '4'], 'unexpected argument 4'],
    [['3', '--pack', '--spread'], '--pack and --spread cannot be combined'],
    [['3', '--bogus'], 'unknown option --bogus'],
    [['3', '-x', '--bogus'], 'unknown option -x'],
    [['3', '--held'], '--held needs a value'],
    [['3', '--trip'], '--trip needs a value'],
    [['3', '--held', 'claude-wrok=1'], 'unknown account claude-wrok'],
    [['3', '--held', 'codex=201'], '--held codex=201: n must be a whole number from 0 to 200'],
    [['3', '--held', 'codex=-1'], '--held codex=-1: n must be a whole number from 0 to 200'],
    [['3', '--held', 'codex'], '--held needs <id>=<n>[,<id>=<n>...], not codex'],
    [['3', '--held', 'codex=1,'], '--held needs <id>=<n>[,<id>=<n>...], not '],
    [['3', '--cap', 'codex=21'], '--cap codex=21: n must be a whole number from 0 to 20'],
    [['3', '--cap', 'codex=x'], '--cap codex=x: n must be a whole number from 0 to 20'],
    [['3', '--trip', '91'], '--trip must be a whole percent from 50 to 90, not 91'],
    [['3', '--trip', '49'], '--trip must be a whole percent from 50 to 90, not 49'],
    [['3', '--trip', '80.5'], '--trip must be a whole percent from 50 to 90, not 80.5'],
    [['3', '--include', 'nobody'], 'unknown account nobody'],
    [['3', '--exclude', 'codex,nobody'], 'unknown account nobody'],
    [['3', '--include', ''], 'unknown account '],
    [['0', '--bogus'], 'unknown option --bogus'],
    [['0', '--pack', '--spread'], 'N must be a whole number from 1 to 200, not 0']
  ])('rejects %j: %s', (args, problem) => {
    expect(parseSeatsArgs(args)).toEqual({ problem });
  });
});

function failingIo(): ProbeIo & { run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => ({ stdout: '', stderr: '', failure: 'missing' as const }));
  return {
    run,
    runner: { run },
    launcher: { launch: async () => undefined },
    fetcher: { get: async () => ({ failure: 'network' }), post: async () => ({ failure: 'network' }) },
    reader: { homeDir: () => '/nowhere', read: async () => undefined, isDirectory: async () => false },
    spawner: { spawn: () => { throw new Error('never spawned'); } }
  };
}

function entry(id: string, windows: unknown[] = []) {
  return windows.length === 0 ? { id, displayName: id, status: 'unavailable', reason: 'gone', windows, fetchedAt: NOW } : { id, displayName: id, status: 'ok', windows, fetchedAt: NOW };
}

describe('runSeats', () => {
  let scratch = '';
  let env: Record<string, string> = {};

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'dandelion-seats-'));
    const routes = { ...JSON.parse(readFileSync(ROUTES_FILE, 'utf8')), headless: Object.fromEntries(COMMANDS.map((command) => [command, { before: [], after: ['-p'], stdin: true }])) };
    writeFileSync(join(scratch, 'routes.json'), JSON.stringify(routes));
    const windows = [{ label: 'session', kind: 'rolling', usedPct: 10, resetsAt: '2026-10-29T13:00:00.000Z' }, { label: 'weekly', kind: 'weekly', usedPct: 10, resetsAt: '2026-11-01T10:00:00.000Z' }];
    writeFileSync(join(scratch, 'snapshot.json'), JSON.stringify(IDS.map((id) => entry(id, ['codex', 'agy'].includes(id) ? windows : []))));
    writeFileSync(join(scratch, 'eligibility.json'), JSON.stringify({ agy: false }));
    env = { DANDELION_ROUTES_FILE: join(scratch, 'routes.json'), DANDELION_STATE_FILE: join(scratch, 'eligibility.json') };
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('answers from a fresh snapshot with --max-age, honouring the state file, without probing', async () => {
    const io = failingIo();
    const { out, err, code } = await runSeats(io, env, ['2', '--json', '--max-age', '600'], CLOCK);
    expect([err, code]).toEqual(['', 0]);
    const object = JSON.parse(out);
    expect(object.seats.map((seat: { line: string }) => seat.line)).toEqual(['model-i high codex', 'model-i high codex']);
    expect(object.accounts.find((account: { id: string }) => account.id === 'agy').skip.reason).toBe('ineligible');
    expect(io.run).not.toHaveBeenCalled();
  });

  it('prints plain lines with --why skip lines', async () => {
    const { out, code } = await runSeats(failingIo(), env, ['1', '--why', '--max-age', '600'], CLOCK);
    expect(code).toBe(0);
    expect(out.split('\n').slice(0, 2)).toEqual(['model-i high codex', '# skip claude: unavailable']);
    expect(out).toContain('# skip agy: routing off\n');
  });

  it('probes every provider once without --max-age, and prints none with exit 1 when nothing can take a seat', async () => {
    const io = failingIo();
    expect(await runSeats(io, env, ['3'], CLOCK)).toEqual({ out: 'none\n', err: '', code: 1 });
    expect(io.run).toHaveBeenCalled();
  });

  it('prints a usage error on stderr and exits 2 before reading routes.json or probing', async () => {
    const io = failingIo();
    expect(await runSeats(io, { DANDELION_ROUTES_FILE: join(scratch, 'nope.json') }, ['3', '--pack', '--spread'], CLOCK)).toEqual({ out: '', err: 'dandelion: seats: --pack and --spread cannot be combined\n', code: 2 });
    expect(io.run).not.toHaveBeenCalled();
  });

  it('prints the routes file fault and exits 2 without probing', async () => {
    const io = failingIo();
    const path = join(scratch, 'nope.json');
    expect(await runSeats(io, { ...env, DANDELION_ROUTES_FILE: path }, ['3', '--json'], CLOCK)).toEqual({ out: '', err: `dandelion: routes file ${path}: cannot be read\n`, code: 2 });
    expect(io.run).not.toHaveBeenCalled();
  });
});
