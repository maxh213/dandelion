import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntryFile, routesWarning, runApp, runLive, runRoute, realIo } from './index.ts';
import type { CommandRunner, CommandRunnerResult, Fetcher, FileReader, LaunchedProcess, Launcher, ProbeIo, RpcChild, RpcSpawner } from '../probes/index.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const PROFILE = 'Name: Max\nEmail: yeti213@googlemail.com\nTeam: Personal\nBalance: $14.15\n';
const KIMI_BODY = JSON.stringify({
  code: 0,
  msg: 'success',
  data: {
    kind: 'ok',
    quota: {
      usages: {
        limit5h: { usedRatio: 0.42, resetAt: '2026-09-13T15:00:00Z' },
        limit7d: { usedRatio: 0.59, resetAt: '2026-09-18T10:00:00Z' }
      },
      extraUsage: null
    }
  },
  request_id: '01M2WR59QVZ5WJFMF4A6TWESJB'
});
const KIMI_LIVE_BODY = JSON.stringify({
  code: 0,
  msg: 'success',
  data: {
    kind: 'ok',
    quota: {
      usages: {
        limit5h: { usedRatio: 0, resetAt: '2026-09-19T14:58:50Z' },
        limit7d: { usedRatio: 0, resetAt: '2026-09-25T12:58:50Z' }
      },
      extraUsage: null
    }
  },
  request_id: '01M2WR59QVZ5WJFMF4A6TWESJB'
});
const MISSING_KIMI: Launcher = { launch: async () => undefined };
const KIMI_CHILD: LaunchedProcess = {
  output: async () => 'kimi web ready: http://127.0.0.1:48123/?token=test-token',
  hasExited: () => false,
  stop: async () => undefined
};
const HAPPY_KIMI: Launcher = { launch: async () => KIMI_CHILD };
const KIMI_FETCHER: Fetcher = { get: async () => ({ status: 200, body: KIMI_BODY }), post: async () => ({ failure: 'network' }) };
const PERIOD = { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T21:15:36.133376+00:00', end: '2026-09-13T21:15:36.133376+00:00' };

function billingEvent(ts: string, creditUsagePercent: number, subscriptionTier: string): string {
  return JSON.stringify({ ts, msg: 'billing: fetched credits config', ctx: { config: { creditUsagePercent, currentPeriod: PERIOD }, subscriptionTier } });
}

function grokLog(newestTs = '2026-09-12T16:00:00.000Z'): string {
  return [
    '{"ts":"2026-09-11T08:00:00.000Z","msg":"session started","ctx":{}}',
    billingEvent('2026-09-11T09:00:00.000Z', 60.0, 'SuperGrok'),
    'not json at all',
    billingEvent(newestTs, 75.0, 'SuperGrok Heavy'),
    '{"ts":"2026-09-12T16:00:01.000Z","msg":"tool call finished","ctx":{"tool":"bash"}}'
  ].join('\n');
}

const WORK_CONFIG_DIR = '/home/tester/.claude-work';

async function hasWorkConfig(path: string): Promise<boolean> {
  return path === WORK_CONFIG_DIR;
}

function grokReader(log: string | undefined): FileReader {
  return { homeDir: () => '/home/tester', read: async (path) => (path === '/grok/logs/unified.jsonl' ? log : undefined), isDirectory: hasWorkConfig };
}

const LONG_UNUSABLE = Array.from({ length: 50000 }, () => '{"msg":"billing: fetched credits config","ts":"x"}').join('\n');
const GROK_ENV = { DANDELION_GROK_HOME: '/grok' };
const NO_GROK = grokReader(undefined);

const CODEX_CHATGPT: CommandRunnerResult = { stdout: '', stderr: 'Logged in using ChatGPT\n' };
const CODEX_API_KEY: CommandRunnerResult = { stdout: '', stderr: 'Logged in using an API key - sk-proj-***n5zQA\n' };
const CODEX_LIMITS = {
  limitId: 'codex',
  planType: 'plus',
  primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1789302600 },
  secondary: { usedPercent: 86, windowDurationMins: 10080, resetsAt: 1789552800 }
};

function codexLines(limits: unknown = CODEX_LIMITS): string[] {
  return [
    '{"id":1,"result":{"userAgent":"fixture"}}',
    '{"method":"remoteControl/status/changed","params":{"status":"disabled"}}',
    JSON.stringify({ id: 2, result: { rateLimits: limits }, rateLimitsByLimitId: null })
  ];
}

async function* linesOf(lines: string[]): AsyncIterable<string> {
  yield* lines;
}

function codexSpawner(lines: string[] = codexLines(), spawned: string[][] = []): RpcSpawner {
  return {
    spawn: (command, args) => {
      spawned.push([command, ...args]);
      return { lines: linesOf(lines), send: () => undefined, stop: async () => undefined };
    }
  };
}

const LIVE_CLEAR = '\x1b[H\x1b[2J';
const ROUTES_FILE = fileURLToPath(new URL('../routes.fixture.json', import.meta.url));

async function routeWith(io: ProbeIo, env: Record<string, string | undefined>, request: Parameters<typeof runRoute>[2]) {
  const { out, err, code } = await runRoute(io, { DANDELION_ROUTES_FILE: ROUTES_FILE, ...env }, request);
  expect(err).toBe('');
  return { line: out.slice(0, -1), routed: code === 0 };
}

function startDashboard(io: ProbeIo, env: Record<string, string>, clock?: () => string) {
  const writes: string[] = [];
  const keyboard = Object.assign(new EventEmitter(), { setRawMode: vi.fn(), setEncoding: vi.fn(), pause: vi.fn() });
  const routed = 'DANDELION_ROUTES_FILE' in env ? env : { DANDELION_ROUTES_FILE: ROUTES_FILE, ...env };
  const finished = runLive(io, routed, keyboard, { write: (text: string) => writes.push(text) }, clock);
  const frames = () => writes.filter((text) => text.startsWith(LIVE_CLEAR)).map((text) => text.slice(LIVE_CLEAR.length));
  const press = (key: string) => keyboard.emit('data', key);
  return { writes, finished, frames, press, lastFrame: () => frames().at(-1) ?? '' };
}

function ioOf(runner: CommandRunner, launcher: Launcher = MISSING_KIMI, reader: FileReader = NO_GROK, spawner = codexSpawner()): ProbeIo {
  return { runner, launcher, fetcher: KIMI_FETCHER, reader, spawner };
}

function mockRunner(result: CommandRunnerResult): ProbeIo {
  return ioOf({ run: async () => result });
}

function profileRunner(stdout: string): ProbeIo {
  return mockRunner({ stdout, stderr: '' });
}

function visibleLines(output: string): string[] {
  return ['\x1b[1m', '\x1b[90m', '\x1b[0m']
    .reduce((text, code) => text.replaceAll(code, ''), output)
    .split('\n');
}

const CLAUDE_USAGE = [
  'Current session: 3% used · resets Sep 13, 7:40pm (Europe/London)',
  'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)',
  'Current week (Fable): 100% used · resets Sep 13, 11pm (Europe/London)',
  '',
  "What's contributing to your usage",
  'Current nonsense: 42% used'
].join('\n');
const AGY_USAGE = [
  'Gemini Models\tWeekly Limit Remaining\t100%\t2026-09-20T17:13:45Z',
  'Gemini Models\tFive Hour Limit Remaining\t100%\t2026-09-13T22:13:45Z',
  'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-09-20T17:13:45Z',
  'Claude and GPT models\tFive Hour Limit Remaining\t25%\t2026-09-13T22:13:45Z'
].join('\n');
const WORK_USAGE = [
  'Current session: 0% used · resets Sep 13, 11:10pm (Europe/London)',
  'Current week (all models): 12% used · resets Sep 15, 6pm (Europe/London)',
  'Current week (Fable): 23% used · resets Sep 15, 6pm (Europe/London)'
].join('\n');
const HAPPY: Record<string, CommandRunnerResult> = {
  claude: { stdout: CLAUDE_USAGE, stderr: '' },
  'claude-work': { stdout: WORK_USAGE, stderr: '' },
  agy: { stdout: AGY_USAGE, stderr: '' },
  codex: CODEX_CHATGPT,
  kilo: { stdout: PROFILE, stderr: '' }
};
const DIM = '\x1b[90m';
const CALM = '\x1b[32m';
const RULE = '━'.repeat(72);

function routedRunner(overrides: Record<string, CommandRunnerResult> = {}, launcher = HAPPY_KIMI, reader = grokReader(grokLog())): ProbeIo {
  const results = { ...HAPPY, ...overrides };
  return ioOf({ run: async (command, _args, _timeoutMs, env) => results[env?.CLAUDE_CONFIG_DIR === undefined ? command : 'claude-work'] }, launcher, reader);
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function plain(output: string): string {
  return output.replaceAll(ANSI, '');
}

function panelOf(output: string, name: string): string[] {
  const lines = plain(output).split('\n');
  const start = lines.indexOf(name);
  const end = lines.findIndex((line, index) => index > start && /^[━=]{72}$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end);
}

describe('claude and agy windows', () => {
  it('renders claude, agy, kimi, grok, codex, cursor, junie and kilo panels in fixed order with captions', async () => {
    const output = await runApp(routedRunner(), GROK_ENV, NOW);
    const lines = plain(output).split('\n');
    expect(lines[0]).toMatch(/^DANDELION +10:00:00Z$/);
    expect(lines.filter((line) => line === RULE)).toHaveLength(10);
    expect(['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'].map((name) => lines.indexOf(name))).toEqual([2, 8, 14, 21, 26, 31, 36, 40, 44, 48]);
    expect(lines[1]).toBe(RULE);
    expect(panelOf(output, 'claude').at(-1)).toBe('claude · personal · claude');
    expect(panelOf(output, 'agy').at(-1)).toBe('agy · agy');
    expect(output).toContain(`${DIM}claude · personal · claude\x1b[0m`);
    expect(output).toContain(`${DIM}agy · agy\x1b[0m`);
    expect(panelOf(output, 'kilo')).toEqual(['kilo', `$14.15 ${'█'.repeat(14)}${'░'.repeat(6)}`.padEnd(72), 'api balance · kilo']);
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  it('renders claude windows parsed from /usage', async () => {
    const output = await runApp(routedRunner(), {}, NOW);
    expect(panelOf(output, 'claude')).toEqual([
      'claude',
      `${'session'.padEnd(35)} ${'█'.repeat(1)}${'░'.repeat(19)}   3% ↻ 8h40m`,
      `${'weekly'.padEnd(35)} ${'█'.repeat(17)}${'░'.repeat(3)}  86% ↻ 12h0m`,
      `${'weekly Fable'.padEnd(35)} ${'█'.repeat(20)} 100% ↻ 12h0m`,
      'claude · personal · claude'
    ]);
    const noColor = await runApp(routedRunner(), { NO_COLOR: '1' }, NOW);
    expect(noColor.split('\n')).toContain('weekly                              #################---  86% ↻ 12h0m');
  });

  it('renders agy remaining percent as used percent', async () => {
    const output = await runApp(routedRunner(), {}, NOW);
    expect(panelOf(output, 'agy').slice(1, 5)).toEqual([
      `${'Gemini Models · Weekly Limit'.padEnd(35)} ${'░'.repeat(20)}   0% ↻ 7d7h`,
      `${'Gemini Models · Five Hour Limit'.padEnd(35)} ${'░'.repeat(20)}   0% ↻ 12h13m`,
      `Claude and GPT models · Weekly Lim… ${'░'.repeat(20)}   0% ↻ 7d7h`,
      `Claude and GPT models · Five Hour…  ${'█'.repeat(15)}${'░'.repeat(5)}  75% ↻ 12h13m`
    ]);
    const noColor = (await runApp(routedRunner(), { NO_COLOR: '1' }, NOW)).split('\n');
    expect(noColor).toContain('Claude and GPT models · Weekly Lim… --------------------   0% ↻ 7d7h');
    expect(noColor).toContain('Claude and GPT models · Five Hour…  ###############-----  75% ↻ 12h13m');
  });

  it('keeps window rows ASCII under NO_COLOR except the separator glyphs', async () => {
    const output = await runApp(routedRunner(), { ...GROK_ENV, NO_COLOR: '1' }, NOW);
    expect(output).not.toContain('\x1b');
    expect(output).not.toMatch(/[█░━]/);
    expect(output.split('\n')).toContain('Gemini Models · Weekly Limit        --------------------   0% ↻ 7d7h');
    expect(new Set(output.replaceAll(/[\x20-\x7e\n]/g, ''))).toEqual(new Set(['↻', '·', '…', '—']));
  });

  it('colours only the gauge and percent of each row by its style token', async () => {
    const output = await runApp(routedRunner(), {}, NOW);
    const lines = output.split('\n');
    const rowOf = (label: string) => lines.find((line) => line.startsWith(`${label.padEnd(35)} \x1b`));
    const [calm, hot, critical] = ['\x1b[32m', '\x1b[31m', '\x1b[35m'];
    expect(rowOf('session')).toBe(`${'session'.padEnd(35)} ${calm}█${'░'.repeat(19)}\x1b[0m ${calm}  3%\x1b[0m ↻ 8h40m`);
    expect(rowOf('weekly')).toBe(`${'weekly'.padEnd(35)} ${hot}${'█'.repeat(17)}${'░'.repeat(3)}\x1b[0m ${hot} 86%\x1b[0m ↻ 12h0m`);
    expect(rowOf('weekly Fable')).toBe(`${'weekly Fable'.padEnd(35)} ${critical}${'█'.repeat(20)}\x1b[0m ${critical}100%\x1b[0m ↻ 12h0m`);
  });

  it('renders a claude window without a reset and no session row', async () => {
    const stdout = 'Current week (all models): 50% used\nCurrent week (Fable): 60% used · resets someday\n';
    const output = await runApp(routedRunner({ claude: { stdout, stderr: '' } }), { NO_COLOR: '1' }, NOW);
    expect(panelOf(output, 'claude').slice(1, -1)).toEqual([
      'weekly                              ##########----------  50%',
      'weekly Fable                        ############--------  60%'
    ]);
  });

  it.each<[string, CommandRunnerResult, string]>([
    ['missing', { stdout: '', stderr: '', failure: 'missing' }, 'claude CLI not found in PATH'],
    ['hanging', { stdout: '', stderr: '', failure: 'timeout' }, 'Command timed out after 90s'],
    ['failing', { stdout: '', stderr: '', failure: 'exit' }, 'Command failed or timed out'],
    ['week-less', { stdout: 'Current session: 3% used', stderr: '' }, 'Could not parse usage from output'],
    ['all-models-less', { stdout: 'Current week (Fable): 100% used', stderr: '' }, 'Could not parse usage from output']
  ])('renders a dim unavailable panel for a %s claude', async (_case, result, reason) => {
    const output = await runApp(routedRunner({ claude: result }), {}, NOW);
    expect(output).toContain(`${DIM}${RULE}\nclaude\n${reason}\nclaude · personal · claude\x1b[0m`);
    expect(panelOf(output, 'agy')).toHaveLength(6);
    expect(panelOf(output, 'kilo')[1]).toContain('$14.15');
  });

  it.each<[string, CommandRunnerResult, string]>([
    ['missing', { stdout: '', stderr: '', failure: 'missing' }, 'agy CLI not found in PATH'],
    ['hanging', { stdout: '', stderr: '', failure: 'timeout' }, 'Command timed out after 60s'],
    ['failing', { stdout: '', stderr: '', failure: 'exit' }, 'Command failed or timed out'],
    ['silent', { stdout: '', stderr: '' }, 'Could not parse usage from output'],
    ['greeting', { stdout: 'hello world', stderr: '' }, 'Could not parse usage from output']
  ])('renders a dim unavailable panel for a %s agy', async (_case, result, reason) => {
    const output = await runApp(routedRunner({ agy: result }), {}, NOW);
    expect(output).toContain(`${DIM}${RULE}\nagy\n${reason}\nagy · agy\x1b[0m`);
    expect(panelOf(output, 'claude')).toHaveLength(5);
    expect(panelOf(output, 'kilo')[1]).toContain('$14.15');
  });

  it.each([
    ['Gemini Models\tFive Hour Limit Remaining\t100%', []],
    ['Gemini Models\tFive Hour Limit Remaining\tlots\t2026-09-13T22:13:45Z', []],
    ['Gemini Models\tFive Hour Limit Remaining\t100%\tnot-a-date', [`${'Gemini Models · Five Hour Limit'.padEnd(35)} ${'-'.repeat(20)}   0%`]]
  ])('skips malformed agy row %j and keeps valid ones', async (bad, extraRows) => {
    const stdout = `Gemini Models\tWeekly Limit Remaining\t40%\t2026-09-20T17:13:45Z\n${bad}\n`;
    const output = await runApp(routedRunner({ agy: { stdout, stderr: '' } }), { NO_COLOR: '1' }, NOW);
    const agyLines = output.split('\n');
    const start = agyLines.indexOf('agy');
    expect(agyLines.slice(start + 1, agyLines.indexOf('agy · agy'))).toEqual([
      `${'Gemini Models · Weekly Limit'.padEnd(35)} ${'#'.repeat(12)}${'-'.repeat(8)}  60% ↻ 7d7h`,
      ...extraRows
    ]);
  });

  it('runs the probes in parallel and keeps panel order', async () => {
    const release: (() => void)[] = [];
    const resumeAllOnSixth = () => {
      if (release.length === 6) release.reverse().forEach((resume) => resume());
    };
    const runner: CommandRunner = {
      run: () =>
        new Promise((resolve) => {
          release.push(() => resolve({ stdout: '', stderr: '', failure: 'timeout' }));
          resumeAllOnSixth();
        })
    };
    const silentKimi: LaunchedProcess = { output: async () => '', hasExited: () => true, stop: async () => undefined };
    const launcher: Launcher = {
      launch: () =>
        new Promise((resolve) => {
          release.push(() => resolve(silentKimi));
          resumeAllOnSixth();
        })
    };
    const output = plain(await runApp(ioOf(runner, launcher), {}, NOW));
    expect(output).toContain(
      [
        'claude\nCommand timed out after 90s\nclaude · personal · claude',
        'claude-work\nCommand timed out after 90s\nclaude · work · claude-work',
        'agy\nCommand timed out after 60s\nagy · agy',
        'kimi\nkimi web exited without printing a token\nkimi code · kimi',
        'grok\nno grok billing snapshot — run grok once\ngrok · grok',
        'codex\nCommand timed out after 15s\ncodex · codex',
        'cursor\nno cursor auth — run cursor-agent login\ncursor · cursor',
        'junie\nno junie quota snapshot — run junie once\njunie · junie',
        'hermes\nno hermes auth — run hermes portal login\nhermes · hermes',
        'kilo\nCommand timed out after 20s\napi balance · kilo'
      ].join(`\n${RULE}\n`)
    );
  });

  it('renders ten unavailable panels when no CLI is on the PATH, grok and junie homes are empty and cursor has no auth', async () => {
    const output = await runApp(mockRunner({ stdout: '', stderr: '', failure: 'missing' }), {}, NOW);
    expect(output).toContain(
      [
        `${DIM}${RULE}\nclaude\nclaude CLI not found in PATH\nclaude · personal · claude\x1b[0m`,
        `${DIM}${RULE}\nclaude-work\nclaude CLI not found in PATH\nclaude · work · claude-work\x1b[0m`,
        `${DIM}${RULE}\nagy\nagy CLI not found in PATH\nagy · agy\x1b[0m`,
        `${DIM}${RULE}\nkimi\nkimi CLI not found in PATH\nkimi code · kimi\x1b[0m`,
        `${DIM}${RULE}\ngrok\nno grok billing snapshot — run grok once\ngrok · grok\x1b[0m`,
        `${DIM}${RULE}\ncodex\ncodex CLI not found in PATH\ncodex · codex\x1b[0m`,
        `${DIM}${RULE}\ncursor\nno cursor auth — run cursor-agent login\ncursor · cursor\x1b[0m`,
        `${DIM}${RULE}\njunie\nno junie quota snapshot — run junie once\njunie · junie\x1b[0m`,
        `${DIM}${RULE}\nhermes\nno hermes auth — run hermes portal login\nhermes · hermes\x1b[0m`,
        `${DIM}${RULE}\nkilo\nkilo CLI not found in PATH\napi balance · kilo\x1b[0m`
      ].join('\n')
    );
  });
});

describe('claude-work panel', () => {
  const WORK_ROWS = [
    'session                             --------------------   0% ↻ 12h10m',
    'weekly                              ##------------------  12% ↻ 2d7h',
    'weekly Fable                        #####---------------  23% ↻ 2d7h'
  ];
  const WORK_CAPTION = 'claude · work · claude-work';
  const PERSONAL_CAPTION = 'claude · personal · claude';
  const PERSONAL_ROW = 'weekly                              #################---  86% ↻ 12h0m';
  const NO_WORK_CONFIG = 'no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude';
  const NAMES = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];
  const OTHERS = NAMES.filter((name) => name !== 'claude-work');

  function recordingIo(overrides: Record<string, CommandRunnerResult> = {}, isDirectory: FileReader['isDirectory'] = hasWorkConfig) {
    const io = routedRunner(overrides);
    const configDirs: string[] = [];
    const runner: CommandRunner = {
      run: (command, args, timeoutMs, env) => {
        if (command === 'claude') configDirs.push(env?.CLAUDE_CONFIG_DIR ?? '-');
        return io.runner.run(command, args, timeoutMs, env);
      }
    };
    return { io: { ...io, runner, reader: { ...io.reader, isDirectory } }, configDirs };
  }

  it('renders both claude accounts as separate panels in order', async () => {
    const output = await runApp(routedRunner(), { ...GROK_ENV, NO_COLOR: '1' }, NOW);
    const lines = output.split('\n');
    const indices = NAMES.map((name) => lines.indexOf(name));
    expect(indices.every((index, at) => index > (indices[at - 1] ?? 0))).toBe(true);
    expect(panelOf(output, 'claude')).toContain(PERSONAL_ROW);
    expect(panelOf(output, 'claude').at(-1)).toBe(PERSONAL_CAPTION);
    expect(lines.slice(indices[1] - 1, indices[1] + 5)).toEqual(['='.repeat(72), 'claude-work', ...WORK_ROWS, WORK_CAPTION]);
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  it('runs claude once per account, the work one with its config dir', async () => {
    const { io, configDirs } = recordingIo();
    await runApp(io, { DANDELION_CLAUDE_WORK_CONFIG_DIR: '/work' }, NOW);
    expect(configDirs).toEqual(['-']);
    await runApp({ ...io, reader: { ...io.reader, isDirectory: async (path) => path === '/work' } }, { DANDELION_CLAUDE_WORK_CONFIG_DIR: '/work' }, NOW);
    expect(configDirs.sort()).toEqual(['-', '-', '/work']);
  });

  it('colours the work gauges calm and its caption dim next to the personal ramp', async () => {
    const output = await runApp(routedRunner(), GROK_ENV, NOW);
    const work = output.slice(output.indexOf('\nclaude-work\n'), output.indexOf(`${DIM}${WORK_CAPTION}\x1b[0m\n`));
    expect(work).toContain(`${CALM}${'░'.repeat(20)}\x1b[0m ${CALM}  0%\x1b[0m ↻ 12h10m`);
    expect(work).toContain(`${CALM}${'█'.repeat(2)}${'░'.repeat(18)}\x1b[0m ${CALM} 12%\x1b[0m ↻ 2d7h`);
    expect(work).toContain(`${CALM}${'█'.repeat(5)}${'░'.repeat(15)}\x1b[0m ${CALM} 23%\x1b[0m ↻ 2d7h`);
    expect(output).toContain(`\x1b[31m${'█'.repeat(17)}${'░'.repeat(3)}\x1b[0m \x1b[31m 86%`);
    expect(output).toContain(`\x1b[35m${'█'.repeat(20)}\x1b[0m \x1b[35m100%`);
  });

  it.each<[string, Record<string, string>]>([
    ['names a dir that is not there', { DANDELION_CLAUDE_WORK_CONFIG_DIR: '/no-such-dir' }],
    ['is unset and the home has no .claude-work', {}],
    ['is empty and the home has no .claude-work', { DANDELION_CLAUDE_WORK_CONFIG_DIR: '' }]
  ])('never runs claude for the work account when the config dir %s', async (_case, env) => {
    const happy = await runApp(routedRunner(), { ...GROK_ENV, NO_COLOR: '1' }, NOW);
    const isDirectory = async (path: string) => path === '/elsewhere';
    const { io, configDirs } = recordingIo({}, isDirectory);
    const output = await runApp(io, { ...GROK_ENV, ...env }, NOW);
    expect(output).toContain(`${DIM}${RULE}\nclaude-work\n${NO_WORK_CONFIG}\n${WORK_CAPTION}\x1b[0m\n`);
    expect(configDirs).toEqual(['-']);
    const noColor = await runApp(recordingIo({}, isDirectory).io, { ...GROK_ENV, ...env, NO_COLOR: '1' }, NOW);
    expect(noColor.split('\n').filter((line) => [...line].length > 72)).toEqual([NO_WORK_CONFIG]);
    for (const name of OTHERS) expect(panelOf(noColor, name)).toEqual(panelOf(happy, name));
  });

  it.each<[string, Record<string, string>]>([
    ['unset', {}],
    ['empty', { DANDELION_CLAUDE_WORK_CONFIG_DIR: '' }]
  ])('defaults the work config dir to ~/.claude-work when the env var is %s', async (_case, env) => {
    const { io, configDirs } = recordingIo();
    const output = await runApp(io, { ...env, NO_COLOR: '1' }, NOW);
    expect(panelOf(output, 'claude-work').slice(1, 4)).toEqual(WORK_ROWS);
    expect(configDirs.sort()).toEqual(['-', WORK_CONFIG_DIR]);
  });

  it.each<[string, CommandRunnerResult, string]>([
    ['exits with code 1', { stdout: '', stderr: '', failure: 'exit' }, 'Command failed or timed out'],
    ['hangs', { stdout: '', stderr: '', failure: 'timeout' }, 'Command timed out after 90s'],
    ['prints only a session line', { stdout: 'Current session: 0% used', stderr: '' }, 'Could not parse usage from output']
  ])('keeps the personal panel when the work claude %s', async (_case, result, reason) => {
    const output = await runApp(routedRunner({ 'claude-work': result }), {}, NOW);
    expect(output).toContain(`${DIM}${RULE}\nclaude-work\n${reason}\n${WORK_CAPTION}\x1b[0m\n`);
    expect(plain(output)).toContain(`\nclaude\n${'session'.padEnd(35)} █`);
    expect(panelOf(output, 'claude')).toHaveLength(5);
    expect(panelOf(output, 'claude').at(-1)).toBe(PERSONAL_CAPTION);
  });

  it('keeps the work panel when the personal claude exits with code 1', async () => {
    const output = await runApp(routedRunner({ claude: { stdout: '', stderr: '', failure: 'exit' } }), { NO_COLOR: '1' }, NOW);
    expect(panelOf(output, 'claude')).toEqual(['claude', 'Command failed or timed out', PERSONAL_CAPTION]);
    expect(panelOf(output, 'claude-work')).toEqual(['claude-work', ...WORK_ROWS, WORK_CAPTION]);
  });

  it('reads a real work config dir and treats a regular file or a missing path as no config', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'dandelion-claude-work-'));
    try {
      const file = join(scratch, 'claude-work-file');
      writeFileSync(file, '');
      expect(await Promise.all([scratch, file, join(scratch, 'no-such-dir')].map((path) => realIo.reader.isDirectory(path)))).toEqual([true, false, false]);
      const { io, configDirs } = recordingIo();
      const real = { ...io, reader: realIo.reader };
      const stateFile = join(scratch, 'eligibility.json');
      expect(panelOf(await runApp(real, { DANDELION_CLAUDE_WORK_CONFIG_DIR: scratch, DANDELION_STATE_FILE: stateFile, NO_COLOR: '1', DANDELION_HERMES_AUTH_FILE: join(scratch, 'missing-hermes.json') }, NOW), 'claude-work').slice(1, 4)).toEqual(WORK_ROWS);
      expect(panelOf(await runApp(real, { DANDELION_CLAUDE_WORK_CONFIG_DIR: file, DANDELION_STATE_FILE: stateFile, NO_COLOR: '1', DANDELION_HERMES_AUTH_FILE: join(scratch, 'missing-hermes.json') }, NOW), 'claude-work')[1]).toBe(NO_WORK_CONFIG);
      expect(configDirs.sort()).toEqual(['-', '-', scratch]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('realCommandRunner passes per-spawn env on top of the inherited environment', async () => {
    const script = 'console.log(process.env.CLAUDE_CONFIG_DIR + " " + (process.env.PATH === undefined))';
    expect((await realIo.runner.run('node', ['-e', script], 5000, { CLAUDE_CONFIG_DIR: '/work' })).stdout).toBe('/work false\n');
  });
});

describe('kimi panel', () => {
  it('renders the kimi weekly and 5h rows between agy and kilo', async () => {
    const output = await runApp(routedRunner(), { NO_COLOR: '1' }, NOW);
    const lines = output.split('\n');
    const kimi = lines.indexOf('kimi');
    expect(lines.slice(kimi - 1, kimi + 5)).toEqual([
      '='.repeat(72),
      'kimi',
      'weekly                              ############--------  59% ↻ 5d0h',
      '5h                                  ########------------  42%',
      'kimi code · kimi',
      '='.repeat(72)
    ]);
    expect(lines.indexOf('agy')).toBeLessThan(kimi);
    expect(lines[kimi + 5]).toBe('grok');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
    expect(output).not.toContain('test-token');
    expect(output).not.toContain('Could not parse usage from response');
  });

  it('colours weekly warm, 5h calm, and the caption dim', async () => {
    const output = await runApp(routedRunner(), {}, NOW);
    const WARM = '\x1b[33m';
    expect(output).toContain(
      `\nkimi\n${'weekly'.padEnd(35)} ${WARM}${'█'.repeat(12)}${'░'.repeat(8)}\x1b[0m ${WARM} 59%\x1b[0m ↻ 5d0h\n${'5h'.padEnd(35)} ${CALM}${'█'.repeat(8)}${'░'.repeat(12)}\x1b[0m ${CALM} 42%\x1b[0m\n${DIM}kimi code · kimi\x1b[0m\n`
    );
  });

  it('renders 0% on both rows from the verified live 2.0 body', async () => {
    const fetcher: Fetcher = { get: async () => ({ status: 200, body: KIMI_LIVE_BODY }), post: async () => ({ failure: 'network' }) };
    const io = { ...routedRunner(), fetcher };
    const output = await runApp(io, { NO_COLOR: '1' }, '2026-09-19T12:58:50Z');
    const lines = output.split('\n');
    const kimi = lines.indexOf('kimi');
    expect(lines.slice(kimi - 1, kimi + 5)).toEqual([
      '='.repeat(72),
      'kimi',
      'weekly                              --------------------   0% ↻ 6d0h',
      '5h                                  --------------------   0%',
      'kimi code · kimi',
      '='.repeat(72)
    ]);
    expect(output).not.toContain('Could not parse usage from response');
    expect(output).not.toContain('test-token');
  });

  it('trips on the 2.0 5h window and still binds on weekly', async () => {
    const later = { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T10:00:00Z', end: '2026-09-16T10:00:00Z' };
    const grokAt = (percent: number) =>
      JSON.stringify({
        ts: '2026-09-12T16:00:00.000Z',
        msg: 'billing: fetched credits config',
        ctx: { config: { creditUsagePercent: percent, currentPeriod: later }, subscriptionTier: 'SuperGrok' }
      });
    const kimiAt = (rolling: number, weekly: number) =>
      JSON.stringify({
        code: 0,
        msg: 'success',
        data: {
          kind: 'ok',
          quota: {
            usages: {
              limit5h: { usedRatio: rolling, resetAt: '2026-09-13T15:00:00Z' },
              limit7d: { usedRatio: weekly, resetAt: '2026-09-16T10:00:00Z' }
            },
            extraUsage: null
          }
        }
      });
    const missing = { run: async () => ({ stdout: '', stderr: '', failure: 'missing' as const }) };
    const routeOf = (rolling: number, weekly: number, grokPct: number) =>
      routeWith(
        {
          ...ioOf(missing, HAPPY_KIMI, grokReader(grokAt(grokPct))),
          fetcher: { get: async () => ({ status: 200, body: kimiAt(rolling, weekly) }), post: async () => ({ failure: 'network' as const }) }
        },
        GROK_ENV,
        { mode: 'headroom', now: NOW, zone: 'UTC' }
      );
    expect(await routeOf(0.1, 0.1, 50)).toEqual({ line: 'model-d max kimi', routed: true });
    expect(await routeOf(0.95, 0, 97)).toEqual({ line: 'model-e xhigh grok', routed: true });
    const onlyKimi = { ...ioOf(missing, HAPPY_KIMI, grokReader(undefined)) };
    expect(await routeWith(onlyKimi, {}, { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({
      line: 'model-d max kimi',
      routed: true
    });
    expect(await routeWith(onlyKimi, {}, { mode: 'high', now: NOW, zone: 'UTC' })).toEqual({ line: 'none', routed: false });
  });

  it('keeps the claude, agy and kilo panels unchanged next to kimi', async () => {
    const withKimi = await runApp(routedRunner(), {}, NOW);
    const withoutKimi = await runApp(routedRunner({}, MISSING_KIMI), {}, NOW);
    for (const name of ['claude', 'agy', 'kilo']) expect(panelOf(withKimi, name)).toEqual(panelOf(withoutKimi, name));
  });

  it('renders a dim kimi panel with the reason while the others render normally', async () => {
    const launcher: Launcher = { launch: async () => ({ ...KIMI_CHILD, output: async () => '', hasExited: () => true }) };
    const output = await runApp(routedRunner({}, launcher), {}, NOW);
    expect(output).toContain(`${DIM}${RULE}\nkimi\nkimi web exited without printing a token\nkimi code · kimi\x1b[0m`);
    expect(panelOf(output, 'claude')).toHaveLength(5);
    expect(panelOf(output, 'agy')).toHaveLength(6);
    expect(panelOf(output, 'kilo')[1]).toContain('$14.15');
  });
});

describe('grok panel', () => {
  const grokIo = (log: string | undefined) => routedRunner({}, HAPPY_KIMI, grokReader(log));
  const WARM = '\x1b[33m';

  it('renders the newest snapshot between kimi and kilo', async () => {
    const output = await runApp(grokIo(grokLog()), { ...GROK_ENV, NO_COLOR: '1' }, NOW);
    const lines = output.split('\n');
    const grok = lines.indexOf('grok');
    expect(lines.slice(grok - 1, grok + 6)).toEqual([
      '='.repeat(72),
      'grok',
      'credits                             ###############-----  75% ↻ 11h15m',
      'snapshot 18h0m old',
      'SuperGrok Heavy · grok',
      '='.repeat(72),
      'codex'
    ]);
    expect(lines.indexOf('kimi')).toBeLessThan(grok);
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  it('keeps the claude, agy, kimi and kilo panels unchanged next to grok', async () => {
    const withGrok = await runApp(grokIo(grokLog()), GROK_ENV, NOW);
    const withoutGrok = await runApp(grokIo(undefined), GROK_ENV, NOW);
    for (const name of ['claude', 'agy', 'kimi', 'kilo']) expect(panelOf(withGrok, name)).toEqual(panelOf(withoutGrok, name));
  });

  it('colours a fresh grok panel warm with a dim snapshot line and caption', async () => {
    const output = await runApp(grokIo(grokLog()), GROK_ENV, NOW);
    expect(output).toContain(
      `\ngrok\n${'credits'.padEnd(35)} ${WARM}${'█'.repeat(15)}${'░'.repeat(5)}\x1b[0m ${WARM} 75%\x1b[0m ↻ 11h15m\n${DIM}snapshot 18h0m old\x1b[0m\n${DIM}SuperGrok Heavy · grok\x1b[0m\n`
    );
  });

  it.each([
    ['2026-09-13T09:59:00.000Z', 'snapshot 0h1m old', false],
    ['2026-09-13T11:00:00.000Z', 'snapshot 0h0m old', false],
    ['2026-09-11T10:00:00.000Z', 'snapshot 2d0h old', false],
    ['2026-09-11T09:59:59.000Z', 'stale snapshot 2d0h old', true],
    ['2026-09-10T17:14:22.812Z', 'stale snapshot 2d16h old', true]
  ])('shows a snapshot taken at %s as "%s"', async (ts, line, stale) => {
    const noColor = (await runApp(grokIo(grokLog(ts)), { ...GROK_ENV, NO_COLOR: '1' }, NOW)).split('\n');
    const grok = noColor.indexOf('grok');
    expect(noColor.slice(grok + 1, grok + 3)).toEqual(['credits                             ###############-----  75% ↻ 11h15m', line]);
    const output = await runApp(grokIo(grokLog(ts)), GROK_ENV, NOW);
    expect(output.includes(`${DIM}${RULE}\ngrok\n`)).toBe(stale);
  });

  it('dims a stale grok panel throughout without a ramp escape', async () => {
    const output = await runApp(grokIo(grokLog('2026-09-10T17:14:22.812Z')), GROK_ENV, NOW);
    expect(output).toContain(
      `${DIM}${RULE}\ngrok\n${'credits'.padEnd(35)} ${'█'.repeat(15)}${'░'.repeat(5)}  75% ↻ 11h15m\nstale snapshot 2d16h old\nSuperGrok Heavy · grok\x1b[0m\n`
    );
    expect(output).toContain(`${DIM}claude · personal · claude\x1b[0m`);
    expect(output).toContain(`\x1b[31m${'█'.repeat(17)}`);
  });

  it.each<[string, string]>([
    ['{"config":{"creditUsagePercent":75}}', 'credits                             ###############-----  75%|grok · grok'],
    ['{"config":{"creditUsagePercent":33.5},"subscriptionTier":""}', 'credits                             #######-------------  34%|grok · grok'],
    ['{"config":{"creditUsagePercent":0},"subscriptionTier":7}', 'credits                             --------------------   0%|grok · grok'],
    ['{"config":{"creditUsagePercent":130,"currentPeriod":{"end":"soon"}},"subscriptionTier":"SuperGrok"}', 'credits                             #################### 130%|SuperGrok · grok'],
    ['{"config":{"creditUsagePercent":75,"currentPeriod":null}}', 'credits                             ###############-----  75%|grok · grok']
  ])('renders the only billing event with ctx %s', async (ctx, expected) => {
    const event = `{"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":${ctx}}`;
    const lines = (await runApp(grokIo(event), { ...GROK_ENV, NO_COLOR: '1' }, NOW)).split('\n');
    const grok = lines.indexOf('grok');
    const [row, caption] = expected.split('|');
    expect([lines[grok + 1], lines[grok + 3]]).toEqual([row, caption]);
  });

  it('skips unusable billing events in favour of an older usable one', async () => {
    const unusable = [
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
    const lines = (await runApp(grokIo(`${grokLog()}\n${unusable}`), { ...GROK_ENV, NO_COLOR: '1' }, NOW)).split('\n');
    const grok = lines.indexOf('grok');
    expect(lines.slice(grok + 1, grok + 4)).toEqual([
      'credits                             ###############-----  75% ↻ 11h15m',
      'snapshot 18h0m old',
      'SuperGrok Heavy · grok'
    ]);
  });

  it('renders an older usable event far behind 50,000 unusable billing lines', async () => {
    const log = `${billingEvent('2026-09-11T09:00:00.000Z', 60.0, 'SuperGrok')}\n${LONG_UNUSABLE}`;
    const lines = (await runApp(grokIo(log), { ...GROK_ENV, NO_COLOR: '1' }, NOW)).split('\n');
    const grok = lines.indexOf('grok');
    expect(lines[grok + 1]).toBe('credits                             ############--------  60% ↻ 11h15m');
    expect(lines[grok + 3]).toBe('SuperGrok · grok');
  });

  it.each<[string, string | undefined]>([
    ['no log', undefined],
    ['an empty log', ''],
    ['only non-billing lines', '{"ts":"2026-09-11T08:00:00.000Z","msg":"session started","ctx":{}}\n{"msg":"tool call finished"}'],
    ['only unusable billing events', '{"ts":"later","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":95}}}'],
    ['50,000 unusable billing lines', LONG_UNUSABLE]
  ])('renders a dim unavailable grok panel with %s while the others render normally', async (_case, log) => {
    const output = await runApp(grokIo(log), GROK_ENV, NOW);
    expect(output).toContain(`${DIM}${RULE}\ngrok\nno grok billing snapshot — run grok once\ngrok · grok\x1b[0m\n`);
    expect(plain(output)).not.toMatch(/^(stale )?snapshot /m);
    expect(panelOf(output, 'claude')).toHaveLength(5);
    expect(panelOf(output, 'kimi')).toHaveLength(4);
    expect(panelOf(output, 'kilo')[1]).toContain('$14.15');
  });
});

describe('real grok reader', () => {
  let scratch = '';

  afterEach(() => {
    if (scratch) {
      chmodSync(scratch, 0o755);
      rmSync(scratch, { recursive: true, force: true });
    }
    scratch = '';
  });

  function grokHome(): string {
    scratch = mkdtempSync(join(tmpdir(), 'dandelion-grok-'));
    return scratch;
  }

  function writeLog(home: string, log: string): string {
    mkdirSync(join(home, 'logs'));
    const path = join(home, 'logs', 'unified.jsonl');
    writeFileSync(path, log);
    return path;
  }

  function tree(dir: string): [string, number, number][] {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort().map((name) => {
      const info = statSync(join(dir, name));
      return [name, info.size, info.mtimeMs];
    });
  }

  it('uses the os home dir', () => {
    expect(realIo.reader.homeDir()).toBe(homedir());
  });

  it('reads the log file', async () => {
    const path = writeLog(grokHome(), 'hello');
    expect(await realIo.reader.read(path)).toBe('hello');
  });

  it('reports a missing path, a directory and an unreadable file as undefined', async () => {
    const home = grokHome();
    const path = writeLog(home, 'secret');
    expect(await realIo.reader.read(join(home, 'nope', 'unified.jsonl'))).toBeUndefined();
    expect(await realIo.reader.read(join(home, 'logs'))).toBeUndefined();
    chmodSync(path, 0o000);
    const readable = await realIo.reader.read(path);
    expect(readable === undefined || process.getuid?.() === 0).toBe(true);
  });

  it('renders from a real grok home and a missing one without writing to either', async () => {
    const home = grokHome();
    writeLog(home, grokLog());
    const io = { ...routedRunner(), reader: realIo.reader };
    const before = tree(home);
    const output = await runApp(io, { DANDELION_GROK_HOME: home, NO_COLOR: '1', DANDELION_HERMES_AUTH_FILE: join(home, 'missing-hermes.json') }, NOW);
    expect(output).toContain('\ngrok\ncredits                             ###############-----  75% ↻ 11h15m\n');
    expect(tree(home)).toEqual(before);
    const empty = join(home, 'empty');
    mkdirSync(empty);
    const emptyBefore = tree(empty);
    expect(await runApp(io, { DANDELION_GROK_HOME: empty, DANDELION_HERMES_AUTH_FILE: join(home, 'missing-hermes.json') }, NOW)).toContain('grok\nno grok billing snapshot — run grok once');
    expect(tree(empty)).toEqual(emptyBefore);
    expect(await runApp(io, { DANDELION_GROK_HOME: join(home, 'missing'), DANDELION_HERMES_AUTH_FILE: join(home, 'missing-hermes.json') }, NOW)).toContain('grok\nno grok billing snapshot — run grok once');
    expect(readdirSync(home).sort()).toEqual(['empty', 'logs']);
  });
});

describe('codex panel', () => {
  const HOT = '\x1b[31m';
  const codexIo = (codex: CommandRunnerResult, spawner = codexSpawner()) => ({ ...routedRunner({ codex }), spawner });

  it('renders both ChatGPT rate-limit windows between grok and kilo', async () => {
    const spawned: string[][] = [];
    const output = await runApp(codexIo(CODEX_CHATGPT, codexSpawner(codexLines(), spawned)), { ...GROK_ENV, NO_COLOR: '1' }, NOW);
    const lines = output.split('\n');
    expect(['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'].map((name) => lines.indexOf(name))).toEqual([2, 8, 14, 21, 26, 31, 36, 40, 44, 48]);
    expect(lines.slice(30, 36)).toEqual([
      '='.repeat(72),
      'codex',
      '5h                                  ########------------  42% ↻ 2h30m',
      'weekly                              #################---  86% ↻ 3d0h',
      'codex · codex',
      '='.repeat(72)
    ]);
    expect(spawned).toEqual([['codex', 'app-server']]);
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  it('keeps the other panels unchanged next to codex', async () => {
    const withCodex = await runApp(codexIo(CODEX_CHATGPT), GROK_ENV, NOW);
    const withoutCodex = await runApp(codexIo({ stdout: '', stderr: '', failure: 'missing' }), GROK_ENV, NOW);
    for (const name of ['claude', 'agy', 'kimi', 'grok', 'kilo']) expect(panelOf(withCodex, name)).toEqual(panelOf(withoutCodex, name));
  });

  it('colours the 5h window calm, the weekly window hot and the caption dim', async () => {
    const output = await runApp(codexIo(CODEX_CHATGPT), GROK_ENV, NOW);
    expect(output).toContain(
      [
        '\ncodex',
        `${'5h'.padEnd(35)} ${CALM}${'█'.repeat(8)}${'░'.repeat(12)}\x1b[0m ${CALM} 42%\x1b[0m ↻ 2h30m`,
        `${'weekly'.padEnd(35)} ${HOT}${'█'.repeat(17)}${'░'.repeat(3)}\x1b[0m ${HOT} 86%\x1b[0m ↻ 3d0h`,
        `${DIM}codex · codex\x1b[0m\n`
      ].join('\n')
    );
  });

  it('renders the API-key caption instead of rows without starting app-server', async () => {
    const spawned: string[][] = [];
    const io = codexIo(CODEX_API_KEY, codexSpawner(codexLines(), spawned));
    expect(panelOf(await runApp(io, { NO_COLOR: '1' }, NOW), 'codex')).toEqual(['codex', 'api-key billing · no usage windows', 'codex · codex']);
    const output = await runApp(io, {}, NOW);
    expect(output).toContain(`${DIM}${RULE}\x1b[0m\ncodex\napi-key billing · no usage windows\n${DIM}codex · codex\x1b[0m\n`);
    expect(panelOf(output, 'codex').join('\n')).not.toMatch(/[█░%]/);
    expect(spawned).toEqual([]);
  });

  it.each<[unknown, string]>([
    [{ primary: { usedPercent: 33.5, windowDurationMins: 300 }, secondary: null }, '5h                                  #######-------------  34%'],
    [{ primary: null, secondary: { usedPercent: 130, windowDurationMins: 10080, resetsAt: 'soon' } }, 'weekly                              #################### 130%'],
    [{ primary: { usedPercent: 0, windowDurationMins: 1440, resetsAt: null } }, '1d                                  --------------------   0%'],
    [{ primary: { usedPercent: 10, windowDurationMins: 90 }, secondary: { usedPercent: 'x' } }, '90m                                 ##------------------  10%'],
    [{ primary: { usedPercent: 10 }, secondary: { usedPercent: -1, windowDurationMins: 300 } }, 'primary                             ##------------------  10%']
  ])('renders rate limits %j as the single row "%s"', async (limits, row) => {
    const output = await runApp(codexIo(CODEX_CHATGPT, codexSpawner(codexLines(limits))), { NO_COLOR: '1' }, NOW);
    expect(panelOf(output, 'codex')).toEqual(['codex', row, 'codex · codex']);
  });

  it('ignores a non-JSON line and a rate-limits notification before the answer', async () => {
    const notification = '{"method":"account/rateLimits/updated","params":{"rateLimits":{"primary":{"usedPercent":99,"windowDurationMins":300}}}}';
    const output = await runApp(codexIo(CODEX_CHATGPT, codexSpawner(['not json', notification, ...codexLines()])), { NO_COLOR: '1' }, NOW);
    expect(panelOf(output, 'codex').slice(1, 3).map((line) => line.split(/ +/).slice(0, 1).concat(line.match(/\d+%/) ?? []))).toEqual([['5h', '42%'], ['weekly', '86%']]);
    expect(output).not.toContain('99%');
  });

  it.each<[string, CommandRunnerResult, string[], string]>([
    ['a missing codex', { stdout: '', stderr: '', failure: 'missing' }, codexLines(), 'codex CLI not found in PATH'],
    ['a logged-out codex', { stdout: '', stderr: 'Not logged in', failure: 'exit' }, codexLines(), 'codex is not logged in'],
    ['a ChatGPT line with exit 1', { stdout: '', stderr: 'Logged in using ChatGPT', failure: 'exit' }, codexLines(), 'codex is not logged in'],
    ['unknown login text', { stdout: 'hello', stderr: '' }, codexLines(), 'codex is not logged in'],
    ['a hanging login', { stdout: '', stderr: '', failure: 'timeout' }, codexLines(), 'Command timed out after 15s'],
    ['a JSON-RPC error', CODEX_CHATGPT, ['{"error":{"code":-32600,"message":"chatgpt authentication required to read rate limits"},"id":2}'], 'chatgpt authentication required to read rate limits'],
    ['a JSON-RPC error without a message', CODEX_CHATGPT, ['{"error":{"code":-32600},"id":2}'], 'codex app-server error'],
    ['an app-server that exits at once', CODEX_CHATGPT, [], 'codex app-server exited without answering'],
    ['null rate limits', CODEX_CHATGPT, ['{"id":2,"result":{"rateLimits":{"primary":null,"secondary":null}}}'], 'Could not parse rate limits from response'],
    ['a null result', CODEX_CHATGPT, ['{"id":2,"result":null}'], 'Could not parse rate limits from response']
  ])('renders a dim codex panel for %s while the others render normally', async (_case, login, lines, reason) => {
    const output = await runApp(codexIo(login, codexSpawner(lines)), GROK_ENV, NOW);
    expect(output).toContain(`${DIM}${RULE}\ncodex\n${reason}\ncodex · codex\x1b[0m\n`);
    expect(panelOf(output, 'claude')).toHaveLength(5);
    expect(panelOf(output, 'grok')).toHaveLength(4);
    expect(panelOf(output, 'kilo')[1]).toContain('$14.15');
    expect(plain(output).split('\n').filter((line) => /^(claude|agy|kimi|grok|codex|kilo)$/.test(line))).toEqual(['claude', 'agy', 'kimi', 'grok', 'codex', 'kilo']);
  });
});

describe('real codex app-server spawner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function spawnNode(script: string): RpcChild {
    return realIo.spawner.spawn(process.execPath, ['-e', script]);
  }

  async function linesUntil(child: RpcChild, last: string): Promise<string[]> {
    const seen: string[] = [];
    for await (const line of child.lines) {
      seen.push(line);
      if (line === last) break;
    }
    return seen;
  }

  it('keeps lines printed before the first read and delivers each sent message as a line', async () => {
    const child = spawnNode('console.log("ready"); require("node:readline").createInterface({ input: process.stdin }).on("line", (l) => console.log("got " + l))');
    await new Promise((resolve) => setTimeout(resolve, 200));
    child.send('{"id":1}');
    child.send('{"id":2}');
    expect(await linesUntil(child, 'got {"id":2}')).toEqual(['ready', 'got {"id":1}', 'got {"id":2}']);
    await child.stop();
  });

  it('does not let a child block on a flood of stderr before it answers', async () => {
    const child = spawnNode('require("node:fs").writeSync(2, "x".repeat(4 << 20)); console.log("answer"); setInterval(() => {}, 1000)');
    const lines = child.lines[Symbol.asyncIterator]();
    const blocked = new Promise((resolve) => setTimeout(() => resolve({ blocked: true }), 3000));
    expect(await Promise.race([lines.next(), blocked])).toEqual({ value: 'answer', done: false });
    await child.stop();
  });

  it('ends the lines when the child exits', async () => {
    const child = spawnNode('console.log("a"); console.log("b")');
    expect(await linesUntil(child, 'never')).toEqual(['a', 'b']);
    await child.stop();
  });

  it('ends the lines, ignores sends and stops at once when the binary is missing', async () => {
    const child = realIo.spawner.spawn('thiscommanddoesnotexist', ['app-server']);
    child.send('{"id":1}');
    expect(await linesUntil(child, 'never')).toEqual([]);
    child.send('{"id":2}');
    await expect(child.stop()).resolves.toBeUndefined();
  });

  it('ignores writes to a child that already exited', async () => {
    const child = spawnNode('process.stdin.destroy()');
    expect(await linesUntil(child, 'never')).toEqual([]);
    await vi.waitFor(async () => {
      child.send('x'.repeat(1 << 20));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await child.stop();
  });

  it('terminates a running child with SIGTERM', async () => {
    const child = spawnNode('console.log("ready"); setInterval(() => {}, 1000)');
    const lines = child.lines[Symbol.asyncIterator]();
    expect(await lines.next()).toEqual({ value: 'ready', done: false });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await child.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(await lines.next()).toMatchObject({ done: true });
  });

  it('does not signal an app-server child again once it has exited', async () => {
    const child = spawnNode('console.log("ready"); setInterval(() => {}, 1000)');
    await child.lines[Symbol.asyncIterator]().next();
    const kill = vi.spyOn(ChildProcess.prototype, 'kill');
    try {
      await child.stop();
      await child.stop();
      expect(kill).toHaveBeenCalledTimes(1);
    } finally {
      kill.mockRestore();
    }
  });

  it('kills an app-server child that ignores SIGTERM after 5 seconds', async () => {
    const child = spawnNode('process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)');
    const lines = child.lines[Symbol.asyncIterator]();
    await lines.next();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let stopped = false;
    const stopping = child.stop().then(() => {
      stopped = true;
    });
    vi.advanceTimersByTime(4999);
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);
    vi.advanceTimersByTime(1);
    await stopping;
    expect(await lines.next()).toMatchObject({ done: true });
  });
});

describe('real kimi launcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function launchNode(script: string): Promise<LaunchedProcess> {
    const child = await realIo.launcher.launch(process.execPath, ['-e', script]);
    if (child === undefined) throw new Error('node did not launch');
    return child;
  }

  async function outputContaining(child: LaunchedProcess, text: string): Promise<string> {
    const output = await child.output();
    if (output.includes(text)) return output;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return outputContaining(child, text);
  }

  it('logs stdout and stderr of an exited child and stops it without signals', async () => {
    const child = await launchNode('console.log("token=out"); console.error("Bearer err")');
    expect(await outputContaining(child, 'Bearer err')).toBe('token=out\nBearer err\n');
    await vi.waitFor(() => expect(child.hasExited()).toBe(true));
    await child.stop();
    expect(await child.output()).toBe('');
  });

  it('terminates a running child with SIGTERM', async () => {
    const child = await launchNode('console.log("ready"); setInterval(() => {}, 1000)');
    await outputContaining(child, 'ready');
    expect(child.hasExited()).toBe(false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await child.stop();
    expect(child.hasExited()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can be stopped again after its log dir is gone', async () => {
    const child = await launchNode('');
    await child.stop();
    await expect(child.stop()).resolves.toBeUndefined();
  });

  it('leaves no log dir and no open descriptor when the binary is missing', async () => {
    const openDescriptors = () => readdirSync('/proc/self/fd').length;
    const scratch = mkdtempSync(join(tmpdir(), 'dandelion-test-'));
    vi.stubEnv('TMPDIR', scratch);
    try {
      await realIo.launcher.launch('thiscommanddoesnotexist', []);
      const before = openDescriptors();
      await realIo.launcher.launch('thiscommanddoesnotexist', []);
      await new Promise((resolve) => setImmediate(resolve));
      expect(openDescriptors()).toBe(before);
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('kills a child that ignores SIGTERM after 5 seconds', async () => {
    const child = await launchNode('process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)');
    await outputContaining(child, 'ready');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let stopped = false;
    const stopping = child.stop().then(() => {
      stopped = true;
    });
    vi.advanceTimersByTime(4999);
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);
    vi.advanceTimersByTime(1);
    await stopping;
    expect(child.hasExited()).toBe(true);
  });

  it('reports a missing binary as undefined', async () => {
    expect(await realIo.launcher.launch('thiscommanddoesnotexist', [])).toBeUndefined();
  });
});

describe('cursor panel', () => {
  const TOKEN = 'unit-dummy-cursor-token';
  const AUTH = JSON.stringify({ accessToken: TOKEN, refreshToken: 'unit-dummy-refresh' });
  const USAGE = JSON.stringify({
    billingCycleStart: '1788108306000',
    billingCycleEnd: '1790786706000',
    planUsage: { totalSpend: 101050, includedSpend: 40000, limit: 40000, autoPercentUsed: 32.36, apiPercentUsed: 15.81, totalPercentUsed: 31.09 }
  });
  const PLAN = JSON.stringify({ planInfo: { planName: 'Ultra', includedAmountCents: 40000, price: '$200/mo', billingCycleEnd: '1790786706000' } });
  const CURSOR_ENV = { ...GROK_ENV, DANDELION_CURSOR_AUTH_FILE: '/cursor/auth.json', DANDELION_CURSOR_API_BASE: 'http://127.0.0.1:48006' };
  const ROWS = [
    'total                               ######--------------  31% ↻ 17d6h',
    'auto                                ######--------------  32% ↻ 17d6h',
    'api                                 ###-----------------  16% ↻ 17d6h'
  ];
  type Outcome = Awaited<ReturnType<Fetcher['post']>>;

  function cursorIo(usage: Outcome = { status: 200, body: USAGE }, plan: Outcome = { status: 200, body: PLAN }, auth: Record<string, string> = { '/cursor/auth.json': AUTH }) {
    const files: Record<string, string> = { '/grok/logs/unified.jsonl': grokLog(), ...auth };
    const reader: FileReader = { homeDir: () => '/home/tester', read: async (path) => files[path], isDirectory: hasWorkConfig };
    const fetcher: Fetcher = { get: KIMI_FETCHER.get, post: async (url) => (url.endsWith('/GetPlanInfo') ? plan : usage) };
    return { ...routedRunner({ codex: CODEX_API_KEY }, HAPPY_KIMI, reader), fetcher };
  }

  it('renders the total, auto and api windows between codex and junie', async () => {
    const output = await runApp(cursorIo(), { ...CURSOR_ENV, NO_COLOR: '1' }, NOW);
    const lines = output.split('\n');
    expect(plain(output).split('\n').filter((line) => /^(claude|agy|kimi|grok|codex|cursor|junie|kilo)$/.test(line))).toEqual(['claude', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'kilo']);
    const cursor = lines.indexOf('cursor');
    expect(lines.slice(cursor - 1, cursor + 6)).toEqual(['='.repeat(72), 'cursor', ...ROWS, 'Ultra · $200/mo · cursor', '='.repeat(72)]);
    expect(lines[cursor + 6]).toBe('junie');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
    expect(output).not.toContain(TOKEN);
  });

  it('keeps the other panels unchanged next to cursor', async () => {
    const withCursor = await runApp(cursorIo(), CURSOR_ENV, NOW);
    const withoutCursor = await runApp(cursorIo(undefined, undefined, {}), CURSOR_ENV, NOW);
    for (const name of ['claude', 'agy', 'kimi', 'grok', 'codex', 'kilo']) expect(panelOf(withCursor, name)).toEqual(panelOf(withoutCursor, name));
  });

  it('colours the three cursor windows calm and the caption dim', async () => {
    const output = await runApp(cursorIo(), CURSOR_ENV, NOW);
    expect(output).toContain(
      [
        '\ncursor',
        `${'total'.padEnd(35)} ${CALM}${'█'.repeat(6)}${'░'.repeat(14)}\x1b[0m ${CALM} 31%\x1b[0m ↻ 17d6h`,
        `${'auto'.padEnd(35)} ${CALM}${'█'.repeat(6)}${'░'.repeat(14)}\x1b[0m ${CALM} 32%\x1b[0m ↻ 17d6h`,
        `${'api'.padEnd(35)} ${CALM}${'█'.repeat(3)}${'░'.repeat(17)}\x1b[0m ${CALM} 16%\x1b[0m ↻ 17d6h`,
        `${DIM}Ultra · $200/mo · cursor\x1b[0m\n`
      ].join('\n')
    );
  });

  it.each<[string, string[]]>([
    ['{"billingCycleEnd":"1790786706000","planUsage":{"totalPercentUsed":31.09,"apiPercentUsed":15.81}}', [ROWS[0], ROWS[2]]],
    ['{"planUsage":{"totalPercentUsed":0,"autoPercentUsed":"32","apiPercentUsed":-1}}', ['total                               --------------------   0%']],
    ['{"billingCycleEnd":1790786706000,"planUsage":{"totalPercentUsed":130}}', ['total                               #################### 130%']],
    ['{"billingCycleEnd":"soon","planUsage":{"autoPercentUsed":32.5}}', ['auto                                #######-------------  33%']],
    ['{"billingCycleEnd":"1e12","planUsage":{"totalPercentUsed":0}}', ['total                               --------------------   0%']],
    ['{"billingCycleEnd":" 1790786706000","planUsage":{"totalPercentUsed":0}}', ['total                               --------------------   0%']]
  ])('renders the usage body %s', async (body, rows) => {
    const output = await runApp(cursorIo({ status: 200, body }), { ...CURSOR_ENV, NO_COLOR: '1' }, NOW);
    expect(panelOf(output, 'cursor')).toEqual(['cursor', ...rows, 'Ultra · $200/mo · cursor']);
  });

  it.each<[string, Outcome, string]>([
    ['a name only', { status: 200, body: '{"planInfo":{"planName":"Pro"}}' }, 'Pro · cursor'],
    ['an empty price', { status: 200, body: '{"planInfo":{"planName":"Pro","price":""}}' }, 'Pro · cursor'],
    ['a price only', { status: 200, body: '{"planInfo":{"price":"$200/mo"}}' }, 'cursor · cursor'],
    ['an empty object', { status: 200, body: '{}' }, 'cursor · cursor'],
    ['a non-JSON body', { status: 200, body: 'not json' }, 'cursor · cursor'],
    ['HTTP 500', { status: 500, body: PLAN }, 'cursor · cursor'],
    ['a timeout', { failure: 'timeout' }, 'cursor · cursor']
  ])('captions the cursor panel for GetPlanInfo with %s', async (_case, plan, caption) => {
    const output = await runApp(cursorIo(undefined, plan), { ...CURSOR_ENV, NO_COLOR: '1' }, NOW);
    expect(panelOf(output, 'cursor')).toEqual(['cursor', ...ROWS, caption]);
  });

  it.each<[string, Outcome, Record<string, string>, string]>([
    ['a missing auth file', { status: 200, body: USAGE }, {}, 'no cursor auth — run cursor-agent login'],
    ['an auth file without a token', { status: 200, body: USAGE }, { '/cursor/auth.json': '{"refreshToken":"r"}' }, 'no cursor auth — run cursor-agent login'],
    ['HTTP 401 echoing the token', { status: 401, body: `{"error":"bad token ${TOKEN}"}` }, { '/cursor/auth.json': AUTH }, 'cursor usage request failed: HTTP 401'],
    ['a network failure', { failure: 'network' }, { '/cursor/auth.json': AUTH }, 'cursor usage request failed'],
    ['a timeout', { failure: 'timeout' }, { '/cursor/auth.json': AUTH }, 'cursor usage request timed out after 15s'],
    ['a null plan usage', { status: 200, body: '{"planUsage":null}' }, { '/cursor/auth.json': AUTH }, 'Could not parse usage from response']
  ])('renders a dim cursor panel for %s while the others render normally', async (_case, usage, auth, reason) => {
    const output = await runApp(cursorIo(usage, undefined, auth), CURSOR_ENV, NOW);
    expect(output).toContain(`${DIM}${RULE}\ncursor\n${reason}\ncursor · cursor\x1b[0m\n`);
    expect(panelOf(output, 'claude')).toHaveLength(5);
    expect(panelOf(output, 'kilo')[1]).toContain('$14.15');
    expect(plain(output).split('\n').filter((line) => /^(claude|agy|kimi|grok|codex|cursor|junie|kilo)$/.test(line))).toEqual(['claude', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'kilo']);
    expect(output).not.toContain(TOKEN);
  });

  it('reads a real auth file without writing the token anywhere', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'dandelion-cursor-'));
    try {
      const authFile = join(scratch, 'auth.json');
      writeFileSync(authFile, AUTH);
      const before = readdirSync(scratch, { recursive: true, encoding: 'utf8' }).map((name) => [name, statSync(join(scratch, name)).mtimeMs]);
      const io = { ...cursorIo(), reader: realIo.reader };
      const output = await runApp(io, { DANDELION_CURSOR_AUTH_FILE: authFile, NO_COLOR: '1', DANDELION_HERMES_AUTH_FILE: join(scratch, 'missing-hermes.json') }, NOW);
      expect(panelOf(output, 'cursor')).toEqual(['cursor', ...ROWS, 'Ultra · $200/mo · cursor']);
      expect(readdirSync(scratch, { recursive: true, encoding: 'utf8' }).map((name) => [name, statSync(join(scratch, name)).mtimeMs])).toEqual(before);
      expect(readFileSync(authFile, 'utf8')).toBe(AUTH);
      expect(output).not.toContain(TOKEN);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  describe('live dashboard', () => {
    const LIVE_ENV = { ...CURSOR_ENV, NO_COLOR: '1' };
    const LATER = '2026-09-13T10:01:05.000Z';

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      vi.setSystemTime(new Date(NOW));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function settleProbes(): Promise<void> {
      for (let turn = 0; turn < 16; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    }

    function kimiOnlyOnce(): Launcher {
      return { launch: vi.fn<Launcher['launch']>().mockResolvedValueOnce(KIMI_CHILD).mockReturnValue(new Promise(() => undefined)) };
    }

    function sessionRow(frame: string): string | undefined {
      return frame.split('\n').find((line) => line.startsWith('session '));
    }

    it('begins the frame with the data age banner and the fleet summary once every probe has settled', async () => {
      const dashboard = startDashboard(cursorIo(), LIVE_ENV);
      await settleProbes();
      const frame = dashboard.lastFrame();
      expect(frame).not.toContain('probing…');
      expect(frame.split('\n').slice(0, 2)).toEqual(['DANDELION'.padEnd(47) + 'data 0h0m old · 10:00:00Z', '2/16 windows above 80% · next reset: claude session in 8h40m']);
      expect(frame.split('\n').every((line) => [...line].length <= 72)).toBe(true);
      dashboard.press('q');
      await dashboard.finished;
    });

    function recordingEnv(values: Record<string, string>) {
      const names = new Set<string>();
      const env = new Proxy(values, {
        get: (target, name) => {
          names.add(String(name));
          return Reflect.get(target, name);
        }
      });
      return { env, names: () => [...names].sort() };
    }

    const SETTINGS = ['DANDELION_CLAUDE_WORK_CONFIG_DIR', 'DANDELION_CURSOR_API_BASE', 'DANDELION_CURSOR_AUTH_FILE', 'DANDELION_GROK_HOME', 'DANDELION_HERMES_AUTH_FILE', 'DANDELION_JUNIE_HOME', 'DANDELION_KILO_REFERENCE', 'DANDELION_KIMI_PORT', 'DANDELION_STATE_FILE', 'NO_COLOR', 'XDG_STATE_HOME'];

    it('applies every setting under its DANDELION_* name', async () => {
      const launch = vi.fn(HAPPY_KIMI.launch);
      const io = { ...routedRunner({ kilo: { stdout: 'Balance: $5.00', stderr: '' } }, { launch }, NO_GROK), fetcher: KIMI_FETCHER };
      const env = { NO_COLOR: '1', DANDELION_KILO_REFERENCE: '10', DANDELION_KIMI_PORT: 'abc', DANDELION_GROK_HOME: '/empty-grok', DANDELION_CURSOR_AUTH_FILE: '/missing.json', DANDELION_CLAUDE_WORK_CONFIG_DIR: '/no-such-dir' };
      const output = await runApp(io, env, NOW);
      expect(panelOf(output, 'kilo')[1]).toMatch(/^\$5\.00 #{10}-{10} /);
      expect(panelOf(output, 'kimi')[1]).toBe('DANDELION_KIMI_PORT must be an integer from 1 to 65535');
      expect(launch).not.toHaveBeenCalled();
      expect(panelOf(output, 'grok')[1]).toBe('no grok billing snapshot — run grok once');
      expect(panelOf(output, 'cursor')[1]).toBe('no cursor auth — run cursor-agent login');
      expect(panelOf(output, 'claude-work')[1]).toBe('no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude');
      const cursor = cursorIo();
      const post = vi.spyOn(cursor.fetcher, 'post');
      expect(panelOf(await runApp(cursor, { ...CURSOR_ENV, NO_COLOR: '1' }, NOW), 'cursor').slice(1, 4)).toEqual(ROWS);
      expect(post.mock.calls.map(([url]) => new URL(url).origin)).toEqual(['http://127.0.0.1:48006', 'http://127.0.0.1:48006']);
    });

    it('reads its settings under the DANDELION_* names and no other name', async () => {
      const recorded = recordingEnv({ ...CURSOR_ENV, NO_COLOR: '1' });
      const output = await runApp(cursorIo(), recorded.env, NOW);
      expect(output.split('\n')[0]).toMatch(/^DANDELION /);
      expect(recorded.names()).toEqual(SETTINGS);
    });

    it('waits the default 300 seconds between rounds unless DANDELION_REFRESH_SECONDS is set, reading no other name', async () => {
      const io = cursorIo();
      const run = vi.spyOn(io.runner, 'run');
      const claudeRuns = () => run.mock.calls.filter(([command]) => command === 'claude').length;
      const recorded = recordingEnv({ ...CURSOR_ENV, NO_COLOR: '1', DANDELION_ROUTES_FILE: ROUTES_FILE });
      const dashboard = startDashboard(io, recorded.env);
      await settleProbes();
      await vi.advanceTimersByTimeAsync(5000);
      expect(claudeRuns()).toBe(2);
      expect(dashboard.writes.join('')).not.toContain('refreshing…');
      await vi.advanceTimersByTimeAsync(295000);
      expect(claudeRuns()).toBe(4);
      expect(recorded.names()).toEqual([...SETTINGS, 'DANDELION_REFRESH_SECONDS', 'DANDELION_ROUTES_FILE'].sort());
      dashboard.press('q');
      await dashboard.finished;
    });

    it('keeps time between frames drawn by the 1000ms timer without new data', async () => {
      const dashboard = startDashboard(cursorIo(), { ...LIVE_ENV, DANDELION_REFRESH_SECONDS: '300' });
      await settleProbes();
      expect(sessionRow(dashboard.lastFrame())).toMatch(/ ↻ 8h40m$/);
      const count = dashboard.frames().length;
      await vi.advanceTimersByTimeAsync(65100);
      const frame = dashboard.lastFrame();
      expect(frame.split('\n').slice(0, 2)).toEqual(['DANDELION'.padEnd(47) + 'data 0h1m old · 10:01:05Z', '2/16 windows above 80% · next reset: claude session in 8h38m']);
      expect(sessionRow(frame)).toMatch(/ ↻ 8h38m$/);
      expect(dashboard.frames().length - count).toBe(66);
      dashboard.press('q');
      await dashboard.finished;
    });

    it('turns a grok snapshot stale between frames', async () => {
      const files: Record<string, string> = { '/grok/logs/unified.jsonl': grokLog('2026-09-11T10:01:00.000Z'), '/cursor/auth.json': AUTH };
      const io = { ...cursorIo(), reader: { homeDir: () => '/home/tester', read: async (path: string) => files[path], isDirectory: hasWorkConfig } };
      const dashboard = startDashboard(io, { ...CURSOR_ENV, DANDELION_REFRESH_SECONDS: '300' });
      await settleProbes();
      const earlier = dashboard.lastFrame();
      expect(earlier).toContain(`\ngrok\n${'credits'.padEnd(35)} \x1b[33m`);
      expect(earlier).toContain(`\n${DIM}snapshot 1d23h old\x1b[0m\n`);
      await vi.advanceTimersByTimeAsync(120100);
      const later = dashboard.lastFrame();
      expect(later).toContain(`${DIM}${RULE}\ngrok\n${'credits'.padEnd(35)} ${'█'.repeat(15)}${'░'.repeat(5)}  75% ↻ 11h13m\nstale snapshot 2d0h old\nSuperGrok Heavy · grok\x1b[0m\n`);
      dashboard.press('q');
      await dashboard.finished;
    });

    it('colours a refreshing frame with the footer and keeps every panel as its once rendering', async () => {
      const dashboard = startDashboard({ ...cursorIo(), launcher: kimiOnlyOnce() }, CURSOR_ENV);
      expect(dashboard.lastFrame()).toContain(`${DIM}${RULE}\nkimi\n⠋ probing…\x1b[0m`);
      await settleProbes();
      dashboard.press('?');
      await vi.advanceTimersByTimeAsync(65000);
      dashboard.press('r');
      const lines = dashboard.lastFrame().split('\n');
      expect(lines[0]).toBe(`\x1b[1mDANDELION${' '.repeat(24)}\x1b[0m\x1b[90mrefreshing…\x1b[0m\x1b[1m · data 0h1m old · 10:01:05Z\x1b[0m`);
      expect(lines[1]).toBe('\x1b[90m2/16 windows above 80% · next reset: claude session in 8h38m\x1b[0m');
      expect(lines.at(-1)).toBe('\x1b[90mkeys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help\x1b[0m');
      const once = await runApp(cursorIo(), CURSOR_ENV, LATER);
      expect(lines.slice(6, -1).join('\n')).toBe(once.split('\n').slice(1).join('\n'));
      dashboard.press('q');
      await dashboard.finished;
    });

    it('shows in the boxes what route and route --high print for the process zone at the frame time', async () => {
      const scratch = mkdtempSync(join(tmpdir(), 'dandelion-boxes-'));
      try {
        const env = { ...LIVE_ENV, DANDELION_STATE_FILE: join(scratch, 'eligibility.json') };
        const dashboard = startDashboard(cursorIo(), env);
        await settleProbes();
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const headroom = await routeWith(cursorIo(), env, { mode: 'headroom', now: NOW, zone });
        const high = await routeWith(cursorIo(), env, { mode: 'high', now: NOW, zone });
        const rowsOf = (line: string) => (line === 'none' ? ['none', 'no subscription available'] : [line.slice(0, line.lastIndexOf(' ')), line.slice(line.lastIndexOf(' ') + 1)]);
        const [model, account] = rowsOf(headroom.line);
        const [highModel, highAccount] = rowsOf(high.line);
        const lines = dashboard.lastFrame().split('\n');
        expect(lines[3]).toBe(`| ${model.padEnd(31)} |  | ${highModel.padEnd(31)} |`);
        expect(lines[4]).toBe(`| ${account.padEnd(31)} |  | ${highAccount.padEnd(31)} |`);
        dashboard.press('q');
        await dashboard.finished;
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });

    it('draws eight pending panels first and reruns claude once per account on r', async () => {
      const io = { ...cursorIo(), launcher: kimiOnlyOnce() };
      const run = vi.spyOn(io.runner, 'run');
      const claudeRuns = () => run.mock.calls.filter(([command]) => command === 'claude').map(([, , , env]) => env?.CLAUDE_CONFIG_DIR ?? '-');
      const dashboard = startDashboard(io, LIVE_ENV);
      const names = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];
      expect(dashboard.frames()[0].split('\n').filter((line) => names.includes(line))).toEqual(names);
      await settleProbes();
      expect(claudeRuns().sort()).toEqual(['-', WORK_CONFIG_DIR]);
      dashboard.press('r');
      await settleProbes();
      expect(claudeRuns().sort()).toEqual(['-', '-', WORK_CONFIG_DIR, WORK_CONFIG_DIR]);
      dashboard.press('q');
      await dashboard.finished;
    });

    it('answers ?, r and other keys as the key scenario says', async () => {
      const io = { ...cursorIo(), launcher: kimiOnlyOnce() };
      const run = vi.spyOn(io.runner, 'run');
      const codexLogins = () => run.mock.calls.filter(([command, args]) => command === 'codex' && args.join(' ') === 'login status').length;
      const dashboard = startDashboard(io, LIVE_ENV);
      await settleProbes();
      dashboard.press('?');
      expect(dashboard.lastFrame().split('\n').at(-1)).toBe('keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help');
      dashboard.press('?');
      expect(dashboard.lastFrame()).not.toContain('keys:');
      dashboard.press('r');
      expect(dashboard.lastFrame().split('\n')[0]).toContain('refreshing…');
      await settleProbes();
      expect(codexLogins()).toBe(2);
      dashboard.press('r');
      await settleProbes();
      expect(codexLogins()).toBe(2);
      const count = dashboard.frames().length;
      dashboard.press('x');
      dashboard.press('R');
      dashboard.press('\r');
      expect(dashboard.frames()).toHaveLength(count);
      dashboard.press('q');
      await dashboard.finished;
    });
  });
});

describe('real fetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the body with headers and a timeout signal', async () => {
    const fetchMock = vi.fn(async () => new Response('{"planInfo":{}}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const headers = { Authorization: 'Bearer t', 'Content-Type': 'application/json' };
    expect(await realIo.fetcher.post('http://127.0.0.1:1/y', headers, '{}', 15000)).toEqual({ status: 200, body: '{"planInfo":{}}' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1/y', { method: 'POST', headers, body: '{}', signal: expect.any(AbortSignal) });
  });

  it('maps a POST timeout to a failure', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('slow', 'TimeoutError');
    });
    expect(await realIo.fetcher.post('http://127.0.0.1:1/y', {}, '{}', 10)).toEqual({ failure: 'timeout' });
  });

  it('returns the status and body with headers and a timeout signal', async () => {
    const fetchMock = vi.fn(async () => new Response('{"data":1}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await realIo.fetcher.get('http://127.0.0.1:1/x', { Authorization: 'Bearer t' }, 10000);
    expect(outcome).toEqual({ status: 401, body: '{"data":1}' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1/x', {
      headers: { Authorization: 'Bearer t' },
      signal: expect.any(AbortSignal)
    });
  });

  it.each<[string, unknown, string]>([
    ['a timeout', new DOMException('slow', 'TimeoutError'), 'timeout'],
    ['an abort', new DOMException('gone', 'AbortError'), 'network'],
    ['a refused connection', new TypeError('fetch failed'), 'network']
  ])('maps %s to a failure', async (_case, error, failure) => {
    vi.stubGlobal('fetch', async () => {
      throw error;
    });
    expect(await realIo.fetcher.get('http://127.0.0.1:1/x', {}, 10)).toEqual({ failure });
  });
});

describe('wiring', () => {
  const session: { dashboard?: ReturnType<typeof startDashboard> } = {};

  beforeEach(() => {
    session.dashboard = startDashboard(mockRunner({ stdout: '', stderr: '', failure: 'missing' }), { NO_COLOR: '1' });
  });

  afterEach(async () => {
    session.dashboard?.press('q');
    await session.dashboard?.finished;
  });

  it('displays kilo balance with default reference', async () => {
    const output = await runApp(profileRunner(PROFILE), {}, NOW);
    expect(output).toContain('DANDELION');
    expect(output).toContain('10:00:00Z');
    expect(output).toContain('━'.repeat(72));
    expect(output).toContain('$14.15 ██████████████░░░░░░');
    expect(output).toContain('\x1b[90mapi balance · kilo\x1b[0m');
  });

  it('rounds gauge fill half-up', async () => {
    const output = await runApp(profileRunner('Balance: $14.50'), {}, NOW);
    expect(output).toContain('$14.50 ███████████████░░░░░ ');
  });

  it('fills the gauge when balance exceeds reference', async () => {
    const output = await runApp(profileRunner('Balance: $25.00'), {}, NOW);
    expect(output).toContain('$25.00 ████████████████████ ');
  });

  it('renders an empty gauge when reference is empty', async () => {
    const output = await runApp(profileRunner('Balance: $14.15'), { DANDELION_KILO_REFERENCE: '' }, NOW);
    expect(output).toContain('$14.15 ░░░░░░░░░░░░░░░░░░░░');
  });

  it('uses a custom reference', async () => {
    const output = await runApp(profileRunner('Balance: $5.00'), { DANDELION_KILO_REFERENCE: '10' }, NOW);
    expect(output).toContain('$5.00 ██████████░░░░░░░░░░');
  });

  it('degrades to ASCII when NO_COLOR is set', async () => {
    const output = await runApp(profileRunner('Balance: $14.15'), { NO_COLOR: '1' }, NOW);
    expect(output).toContain('$14.15 ##############------');
    expect(output).not.toContain('\x1b[');
  });

  it('keeps every line within 72 columns', async () => {
    const lines = [
      ...visibleLines(await runApp(profileRunner(PROFILE), {}, NOW)),
      ...visibleLines(await runApp(profileRunner(PROFILE), { NO_COLOR: '1' }, NOW))
    ];
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
  });

  it('renders a dim unavailable panel when kilo is missing', async () => {
    const runner = mockRunner({ stdout: '', stderr: '', failure: 'missing' });
    const output = await runApp(runner, {}, NOW);
    expect(output).toContain('DANDELION');
    expect(output).toContain('\x1b[90m' + '━'.repeat(72) + '\nkilo\nkilo CLI not found in PATH');
  });

  it('renders a dim unavailable panel for unparseable output', async () => {
    const output = await runApp(profileRunner('Name: Max\nEmail: yeti213@googlemail.com\nTeam: Personal\n'), {}, NOW);
    expect(output).toContain('\x1b[90m');
    expect(output).toContain('Could not parse balance from output');
    expect(output).not.toContain('█');
  });

  it('renders a dim unavailable panel when kilo times out', async () => {
    const runner = mockRunner({ stdout: '', stderr: '', failure: 'timeout' });
    const output = await runApp(runner, {}, NOW);
    expect(output).toContain('Command timed out after 20s');
  });

  it('renders a dim unavailable panel when kilo exits with an error', async () => {
    const runner = mockRunner({ stdout: '', stderr: '', failure: 'exit' });
    const output = await runApp(runner, {}, NOW);
    expect(output).toContain('Command failed or timed out');
  });

  it('probes claude, agy, codex and kilo with their commands and timeouts', async () => {
    const calls: [string, string[], number, Record<string, string> | undefined][] = [];
    const runner: CommandRunner = {
      run: async (command, args, timeoutMs, env) => {
        calls.push([command, args, timeoutMs, env]);
        return { stdout: PROFILE, stderr: '' };
      }
    };
    await runApp(ioOf(runner), {}, NOW);
    expect(calls.filter((call) => call[3] === undefined)).toEqual([
      ['claude', ['-p', '/usage'], 90000, undefined],
      ['agy', ['-p', '/usage'], 60000, undefined],
      ['codex', ['login', 'status'], 15000, undefined],
      ['kilo', ['profile'], 20000, undefined]
    ]);
    expect(calls.filter((call) => call[3] !== undefined)).toEqual([['claude', ['-p', '/usage'], 90000, { CLAUDE_CONFIG_DIR: WORK_CONFIG_DIR }]]);
  });

  it('realCommandRunner executes commands successfully', async () => {
    const result = await realIo.runner.run('node', ['-e', 'console.log("hello")'], 2000);
    expect(result.stdout).toContain('hello');
    expect(result.failure).toBeUndefined();
  });

  it('realCommandRunner reports a missing binary', async () => {
    const result = await realIo.runner.run('thiscommanddoesnotexist', [], 2000);
    expect(result.failure).toBe('missing');
  });

  it('realCommandRunner reports a timeout', async () => {
    const result = await realIo.runner.run('node', ['-e', 'setTimeout(() => {}, 5000)'], 100);
    expect(result.failure).toBe('timeout');
  });

  it('realCommandRunner reports a non-zero exit', async () => {
    const result = await realIo.runner.run('node', ['-e', 'process.exit(2)'], 2000);
    expect(result.failure).toBe('exit');
  });

  it('realCommandRunner reports a self-inflicted SIGTERM as an exit', async () => {
    const result = await realIo.runner.run('node', ['-e', 'process.kill(process.pid, "SIGTERM")'], 2000);
    expect(result.failure).toBe('exit');
  });
});

describe('quitting the live dashboard', () => {
  const HOLD = 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)';
  const CHILDREN = ['agy', 'app-server', 'claude', 'claude-work', 'kilo', 'kimi'];
  const MISSING_RUN: CommandRunnerResult = { stdout: '', stderr: '', failure: 'missing' };
  let scratch = '';

  function cmdlineOf(pid: string): string {
    try {
      return readFileSync(join('/proc', pid, 'cmdline'), 'utf8');
    } catch {
      return '';
    }
  }

  function runningWith(marker: string): string[] {
    return readdirSync('/proc').filter((pid) => cmdlineOf(pid).includes(marker));
  }

  afterEach(() => {
    if (scratch !== '') runningWith(scratch).forEach((pid) => process.kill(Number(pid), 'SIGKILL'));
    rmSync(scratch, { recursive: true, force: true });
  });

  function isRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it.each([['q'], ['\x03']])('stops every in-flight probe child before finishing on %j', async (key) => {
    scratch = mkdtempSync(join(tmpdir(), 'dandelion-live-'));
    const hold = (name: string) => ['-e', HOLD, join(scratch, name)];
    const runner: CommandRunner = {
      run: (command, _args, timeoutMs, env) =>
        command === 'codex' ? Promise.resolve(CODEX_CHATGPT) : realIo.runner.run(process.execPath, hold(env === undefined ? command : 'claude-work'), timeoutMs)
    };
    const pidOf = (name: string) => Number(readFileSync(join(scratch, name), 'utf8'));
    const launcher: Launcher = {
      launch: async () => {
        const child = await realIo.launcher.launch(process.execPath, hold('kimi'));
        await vi.waitFor(() => expect(pidOf('kimi')).toBeGreaterThan(0), { timeout: 10000 });
        return child;
      }
    };
    const spawner: RpcSpawner = { spawn: () => realIo.spawner.spawn(process.execPath, hold('app-server')) };
    const dashboard = startDashboard(ioOf(runner, launcher, NO_GROK, spawner), { NO_COLOR: '1' });
    const pids = () => CHILDREN.map(pidOf);
    await vi.waitFor(() => expect(pids().every((pid) => pid > 0)).toBe(true), { timeout: 10000 });
    expect(pids().every(isRunning)).toBe(true);
    expect(dashboard.lastFrame()).toMatch(/\nkimi\n\S probing…\n/);
    dashboard.press(key);
    expect(dashboard.writes.at(-1)).toBe('\x1b[?25h\x1b[?1049l');
    await dashboard.finished;
    expect(pids().filter(isRunning)).toEqual([]);
  }, 20000);

  it('does not signal a child again on quit once it has settled, been stopped or failed to launch', async () => {
    const dashboard = startDashboard(mockRunner(MISSING_RUN), { NO_COLOR: '1' });
    const kill = vi.spyOn(ChildProcess.prototype, 'kill');
    try {
      await realIo.runner.run(process.execPath, ['-e', ''], 5000);
      await realIo.spawner.spawn(process.execPath, ['-e', '']).stop();
      expect(await realIo.launcher.launch('thiscommanddoesnotexist', [])).toBeUndefined();
      expect(kill).toHaveBeenCalledTimes(1);
      dashboard.press('q');
      await dashboard.finished;
      expect(kill).toHaveBeenCalledTimes(1);
    } finally {
      kill.mockRestore();
    }
  });

  it('does not run a stop again on quit while that stop is still waiting for its child to exit', async () => {
    const dashboard = startDashboard(mockRunner(MISSING_RUN), { NO_COLOR: '1' });
    const child = realIo.spawner.spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 300)); console.log("ready"); setInterval(() => {}, 1000)']);
    await child.lines[Symbol.asyncIterator]().next();
    const kill = vi.spyOn(ChildProcess.prototype, 'kill');
    try {
      const stopping = child.stop();
      dashboard.press('q');
      await dashboard.finished;
      await stopping;
      expect(kill).toHaveBeenCalledTimes(1);
    } finally {
      kill.mockRestore();
    }
  });

  it('stops a kimi child when quit arrives in the same tick as its launch', async () => {
    scratch = mkdtempSync(join(tmpdir(), 'dandelion-live-'));
    const holder: { dashboard?: ReturnType<typeof startDashboard> } = {};
    const launcher: Launcher = {
      launch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const launching = realIo.launcher.launch(process.execPath, ['-e', HOLD, join(scratch, 'kimi')]);
        expect(runningWith(scratch)).toHaveLength(1);
        holder.dashboard?.press('q');
        return launching;
      }
    };
    holder.dashboard = startDashboard(ioOf({ run: async () => MISSING_RUN }, launcher), { NO_COLOR: '1' });
    await holder.dashboard.finished;
    expect(runningWith(scratch)).toEqual([]);
  }, 20000);

  it('stops a child that starts after quit has finished, until the next session opens', async () => {
    const brief = ['-e', 'setTimeout(() => {}, 300)'];
    const closed = startDashboard(mockRunner(MISSING_RUN), { NO_COLOR: '1' });
    closed.press('q');
    await closed.finished;
    expect((await realIo.runner.run(process.execPath, brief, 5000)).failure).toBeDefined();
    const open = startDashboard(mockRunner(MISSING_RUN), { NO_COLOR: '1' });
    expect((await realIo.runner.run(process.execPath, brief, 5000)).failure).toBeUndefined();
    open.press('q');
    await open.finished;
  });
});

describe('isEntryFile', () => {
  it('matches the module file itself or a symlink to it, and not a missing or different file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dandelion-realpath-'));
    try {
      const target = join(dir, 'main.ts');
      const url = pathToFileURL(target).href;
      writeFileSync(target, '');
      writeFileSync(join(dir, 'other.ts'), '');
      symlinkSync(target, join(dir, 'dandelion'));
      expect(isEntryFile(url, join(dir, 'dandelion'))).toBe(true);
      expect(isEntryFile(url, target)).toBe(true);
      expect(isEntryFile(url, join(dir, 'other.ts'))).toBe(false);
      expect(isEntryFile(url, join(dir, 'missing'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runRoute', () => {
  it('probes every provider once and routes by the next local midnight of the given zone', async () => {
    expect(await routeWith(routedRunner(), {}, { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ line: 'model-a max claude', routed: true });
    expect(await routeWith(routedRunner(), {}, { mode: 'headroom', now: NOW, zone: 'Etc/GMT-2' })).toEqual({ line: 'model-a high claude-work', routed: true });
  });

  it('walks the quality chain when high, skipping personal whose Fable window is tripped', async () => {
    expect(await routeWith(routedRunner(), {}, { mode: 'high', now: NOW, zone: 'UTC' })).toEqual({ line: 'model-h1 max claude-work', routed: true });
  });

  it('is none when every provider is unavailable', async () => {
    expect(await routeWith(mockRunner({ stdout: '', stderr: '', failure: 'missing' }), {}, { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ line: 'none', routed: false });
  });

  it('reads the shipped routes.json when DANDELION_ROUTES_FILE is unset, and it holds every routed provider and high entry as a valid line', async () => {
    const nothing = mockRunner({ stdout: '', stderr: '', failure: 'missing' });
    for (const mode of ['headroom', 'high'] as const) {
      expect(await runRoute(nothing, {}, { mode, now: NOW, zone: 'UTC' })).toEqual({ out: 'none\n', err: '', code: 1 });
    }
  });

  describe('with a bad routes file', () => {
    let scratch = '';

    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), 'dandelion-routes-'));
    });

    afterEach(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    it.each(['headroom', 'high'] as const)('prints the fault on stderr and exits 2 in %s mode without probing', async (mode) => {
      const run = vi.fn(async () => ({ stdout: '', stderr: '', failure: 'missing' as const }));
      const path = join(scratch, 'nope.json');
      expect(await runRoute(ioOf({ run }), { DANDELION_ROUTES_FILE: path }, { mode, now: NOW, zone: 'UTC' })).toEqual({ out: '', err: `dandelion: routes file ${path}: cannot be read\n`, code: 2 });
      expect(await runRoute(ioOf({ run }), { DANDELION_ROUTES_FILE: scratch }, { mode, now: NOW, zone: 'UTC' })).toEqual({ out: '', err: `dandelion: routes file ${scratch}: cannot be read\n`, code: 2 });
      expect(run).not.toHaveBeenCalled();
    });

    it('warns with the same line for --once, and with nothing for a good file', () => {
      const path = join(scratch, 'bad.json');
      writeFileSync(path, '{"route":');
      expect(routesWarning({ DANDELION_ROUTES_FILE: path })).toBe(`dandelion: routes file ${path}: is not valid JSON\n`);
      expect(routesWarning({ DANDELION_ROUTES_FILE: ROUTES_FILE })).toBe('');
    });
  });
});

describe('route eligibility state file', () => {
  const CLAUDE_TAG = `claude${' '.repeat(55)}routing off`;
  let scratch = '';
  let statePath = '';

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'dandelion-state-'));
    statePath = join(scratch, 'state', 'eligibility.json');
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(scratch, { recursive: true, force: true });
  });

  function writeState(bytes: string): void {
    mkdirSync(join(scratch, 'state'), { recursive: true });
    writeFileSync(statePath, bytes);
  }

  function stateOf(): unknown {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  }

  async function settleProbes(): Promise<void> {
    for (let turn = 0; turn < 16; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  }

  async function settledDashboard(io: ProbeIo, env: Record<string, string>, clock?: () => string) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(NOW));
    const dashboard = startDashboard({ ...io, launcher: MISSING_KIMI }, { NO_COLOR: '1', DANDELION_STATE_FILE: statePath, ...env }, clock);
    await settleProbes();
    return dashboard;
  }

  async function quit(dashboard: ReturnType<typeof startDashboard>): Promise<void> {
    dashboard.press('q');
    await dashboard.finished;
  }

  function headerOf(frame: string, id: string): string | undefined {
    return frame.split('\n').find((line) => line.replace(/^▸ /, '').split(' ')[0] === id);
  }

  it('routes as the 010 rules say with no state file and never creates one', async () => {
    expect(await routeWith(routedRunner(), { DANDELION_STATE_FILE: statePath }, { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ line: 'model-a max claude', routed: true });
    expect(readdirSync(scratch)).toEqual([]);
  });

  it.each<[string, string, string]>([
    ['claude and claude-work off', '{"claude": false, "claude-work": false}', 'model-d max kimi'],
    ['claude off, true and other values eligible', '{"claude": false, "claude-work": true, "kimi": "no"}', 'model-a high claude-work'],
    ['corrupt bytes', '{not json', 'model-a max claude'],
    ['JSON null', 'null', 'model-a max claude'],
    ['a JSON array', '[false]', 'model-a max claude']
  ])('routes around ineligible providers and never writes: %s', async (_case, bytes, line) => {
    writeState(bytes);
    const before = statSync(statePath).mtimeMs;
    expect(await routeWith(routedRunner(), { DANDELION_STATE_FILE: statePath }, { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ line, routed: true });
    expect([readFileSync(statePath, 'utf8'), statSync(statePath).mtimeMs]).toEqual([bytes, before]);
  });

  it('routes as if every provider is eligible when the state path is a directory, and is none when all are off', async () => {
    mkdirSync(statePath, { recursive: true });
    expect(await routeWith(routedRunner(), { DANDELION_STATE_FILE: statePath }, { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ line: 'model-a max claude', routed: true });
    rmSync(statePath, { recursive: true });
    writeState('{"claude": false, "claude-work": false, "agy": false, "kimi": false}');
    expect(await routeWith(routedRunner(), { DANDELION_STATE_FILE: statePath }, { mode: 'headroom', now: NOW, zone: 'UTC' })).toEqual({ line: 'none', routed: false });
  });

  it.each<[string, (home: string) => Record<string, string>, (home: string) => string]>([
    ['XDG_STATE_HOME', (home) => ({ XDG_STATE_HOME: join(home, 'xdg') }), (home) => join(home, 'xdg', 'dandelion', 'eligibility.json')],
    ['home with an empty DANDELION_STATE_FILE', () => ({ DANDELION_STATE_FILE: '' }), (home) => join(home, '.local', 'state', 'dandelion', 'eligibility.json')],
    ['home with an empty XDG_STATE_HOME', () => ({ XDG_STATE_HOME: '' }), (home) => join(home, '.local', 'state', 'dandelion', 'eligibility.json')]
  ])('reads the default state path under %s', async (_case, envOf, pathOf) => {
    const io = routedRunner();
    const homed = { ...io, reader: { ...io.reader, homeDir: () => scratch } };
    expect((await routeWith(homed, envOf(scratch), { mode: 'headroom', now: NOW, zone: 'UTC' })).line).toBe('model-a max claude');
    mkdirSync(join(pathOf(scratch), '..'), { recursive: true });
    writeFileSync(pathOf(scratch), '{"claude": false}');
    expect((await routeWith(homed, envOf(scratch), { mode: 'headroom', now: NOW, zone: 'UTC' })).line).toBe('model-d max kimi');
  });

  it('tags ineligible panels in --once output, changes no other line and never writes', async () => {
    const env = { NO_COLOR: '1', DANDELION_STATE_FILE: statePath };
    const plainOutput = await runApp(routedRunner(), env, NOW);
    expect(readdirSync(scratch)).toEqual([]);
    expect(plainOutput).not.toMatch(/routing off|▸/);
    writeState('{"claude": false, "kilo": false}');
    const mtime = statSync(statePath).mtimeMs;
    const tagged = (await runApp(routedRunner(), env, NOW)).split('\n');
    const expected = plainOutput.split('\n').map((line) => (line === 'claude' || line === 'kilo' ? `${line}${' '.repeat(72 - line.length - 11)}routing off` : line));
    expect(tagged).toEqual(expected);
    expect(statSync(statePath).mtimeMs).toBe(mtime);
    for (const bytes of ['{not json', 'null']) {
      writeState(bytes);
      expect(await runApp(routedRunner(), env, NOW)).toBe(plainOutput);
    }
  });

  it('keeps every panel with a bad routes file and shows routes file error over the unknown key in both boxes', async () => {
    const untilSettled = async (dashboard: ReturnType<typeof startDashboard>) => {
      for (let round = 0; round < 50 && dashboard.lastFrame().includes('probing…'); round += 1) await settleProbes();
      return dashboard.lastFrame().split('\n');
    };
    const good = await settledDashboard(routedRunner(), {}, () => NOW);
    const goodFrame = await untilSettled(good);
    await quit(good);
    const fixture = JSON.parse(readFileSync(ROUTES_FILE, 'utf8'));
    const wrok = join(scratch, 'wrok.json');
    writeFileSync(wrok, JSON.stringify({ ...fixture, route: { ...fixture.route, 'claude-wrok': fixture.route.claude } }));
    const bad = await settledDashboard(routedRunner(), { DANDELION_ROUTES_FILE: wrok }, () => NOW);
    const badFrame = await untilSettled(bad);
    expect(badFrame.slice(3, 5)).toEqual([
      `| routes file error${' '.repeat(15)}|  | routes file error${' '.repeat(15)}|`,
      `| ${'unknown key route.claude-wrok'.padEnd(31)} |  | ${'unknown key route.claude-wrok'.padEnd(31)} |`
    ]);
    expect([...badFrame.slice(0, 3), ...badFrame.slice(5)]).toEqual([...goodFrame.slice(0, 3), ...goodFrame.slice(5)]);
    await quit(bad);
  });

  it('toggles claude off and on with j and space, writing only the state file, and keeps the choice across restarts', async () => {
    const dashboard = await settledDashboard(routedRunner(), {});
    expect(dashboard.lastFrame()).not.toMatch(/routing off|▸/);
    dashboard.press('j');
    expect(headerOf(dashboard.lastFrame(), 'claude')).toBe('▸ claude');
    expect(readdirSync(scratch)).toEqual([]);
    const rows = dashboard.lastFrame().split('\n').filter((line) => line.startsWith('session ') || line.startsWith('weekly '));
    dashboard.press(' ');
    expect(stateOf()).toEqual({ claude: false });
    expect(readFileSync(statePath, 'utf8')).toBe('{\n  "claude": false\n}\n');
    expect(readdirSync(join(scratch, 'state'))).toEqual(['eligibility.json']);
    expect(headerOf(dashboard.lastFrame(), 'claude')).toBe(`▸ ${CLAUDE_TAG.slice(0, -13)}routing off`);
    expect(dashboard.lastFrame().split('\n').filter((line) => line.startsWith('session ') || line.startsWith('weekly '))).toEqual(rows);
    expect((await routeWith(routedRunner(), { DANDELION_STATE_FILE: statePath }, { mode: 'headroom', now: NOW, zone: 'UTC' })).line).toBe('model-a high claude-work');
    dashboard.press(' ');
    expect(stateOf()).toEqual({ claude: true });
    expect(headerOf(dashboard.lastFrame(), 'claude')).toBe('▸ claude');
    dashboard.press(' ');
    await quit(dashboard);
    const again = startDashboard({ ...routedRunner(), launcher: MISSING_KIMI }, { NO_COLOR: '1', DANDELION_STATE_FILE: statePath });
    await settleProbes();
    expect(headerOf(again.lastFrame(), 'claude')).toBe(CLAUDE_TAG);
    expect(again.lastFrame()).not.toContain('▸');
    await quit(again);
  });

  it('rewrites the state read at start with unknown keys kept, overwriting edits made while running', async () => {
    writeState('{"nope": 1, "agy": false}');
    const dashboard = await settledDashboard(routedRunner(), {});
    writeState('{"kimi": false}');
    dashboard.press('?');
    expect(headerOf(dashboard.lastFrame(), 'agy')).toBe(`agy${' '.repeat(58)}routing off`);
    expect(headerOf(dashboard.lastFrame(), 'kimi')).toBe('kimi');
    dashboard.press('j');
    dashboard.press(' ');
    expect(stateOf()).toEqual({ nope: 1, agy: false, claude: false });
    await quit(dashboard);
  });

  it('keeps nothing from a corrupt file when it rewrites', async () => {
    writeState('{not json');
    const dashboard = await settledDashboard(routedRunner(), {});
    dashboard.press('j');
    dashboard.press(' ');
    expect(stateOf()).toEqual({ claude: false });
    await quit(dashboard);
  });

  it('flashes kilo as not routable and writes nothing', async () => {
    const dashboard = await settledDashboard(routedRunner(), {});
    dashboard.press('k');
    dashboard.press(' ');
    expect(dashboard.lastFrame().split('\n').at(-1)).toBe('not routable (no usage windows)');
    await vi.advanceTimersByTimeAsync(2000);
    expect(dashboard.lastFrame().split('\n').at(-1)).toBe('api balance · kilo');
    expect(readdirSync(scratch)).toEqual([]);
    await quit(dashboard);
  });

  it.each<[string, (root: string) => string, (root: string) => void, (root: string) => string, (root: string) => void]>([
    ['a parent that is a file', (root) => join(root, 'blocked', 'eligibility.json'), (root) => writeFileSync(join(root, 'blocked'), ''), (root) => root, (root) => rmSync(join(root, 'blocked'))],
    ['a non-empty directory at the path', (root) => join(root, 'state', 'eligibility.json'), (root) => mkdirSync(join(root, 'state', 'eligibility.json', 'keep'), { recursive: true }), (root) => join(root, 'state'), (root) => rmSync(join(root, 'state', 'eligibility.json'), { recursive: true })],
    ['a directory that cannot be written', (root) => join(root, 'locked', 'eligibility.json'), (root) => { mkdirSync(join(root, 'locked')); chmodSync(join(root, 'locked'), 0o555); }, (root) => join(root, 'locked'), (root) => chmodSync(join(root, 'locked'), 0o755)]
  ])('flashes routing state not saved and leaves no temp file behind with %s', async (_case, pathOf, block, dirOf, unblock) => {
    block(scratch);
    const entries = readdirSync(dirOf(scratch)).sort();
    const dashboard = await settledDashboard(routedRunner(), { DANDELION_STATE_FILE: pathOf(scratch) });
    dashboard.press('j');
    dashboard.press(' ');
    expect(dashboard.lastFrame()).toContain('\nrouting state not saved\n');
    expect(dashboard.lastFrame()).not.toContain('routing off');
    expect(readdirSync(dirOf(scratch)).sort()).toEqual(entries);
    unblock(scratch);
    dashboard.press(' ');
    expect(JSON.parse(readFileSync(pathOf(scratch), 'utf8'))).toEqual({ claude: false });
    expect(headerOf(dashboard.lastFrame(), 'claude')).toBe(`▸ claude${' '.repeat(53)}routing off`);
    await quit(dashboard);
  });
});

describe('junie panel', () => {
  const JUNIE_NOW = '2026-09-18T19:00:00Z';
  const JETBRAINS = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.JetBrains';
  const UNKNOWN_LINE = '{"kind":"SessionA2uxEvent","completion":{"endedAtMs":1789735700000,"quota":{"type":"com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.Unknown"}}}';
  const NOISE = ['{"kind":"SessionA2uxEvent","event":{"state":"IN_PROGRESS"},"timestampMs":1789735600000}', '{"kind":"UserPromptEvent","prompt":"ping"}'];
  const INDEX = [
    '{"sessionId":"session-old","createdAt":1789735398143,"updatedAt":1789735405438,"projectDir":"/w","taskName":"Old","status":"Sending LLM request"}',
    'not json at all',
    '{"sessionId":"session-new","createdAt":1789735553568,"updatedAt":1789735558242,"projectDir":"/w/d","taskName":"Respond with Pong Only"}'
  ].join('\n');
  const JUNIE_ENV = { ...GROK_ENV, DANDELION_JUNIE_HOME: '/junie' };
  const ROW_30 = 'credits                             ######--------------  30%';

  function snapshotLine(endedAtMs: number, balanceLeft: unknown): string {
    const completion = { endedAtMs, taskCostUsd: 0.0334116, quota: { type: JETBRAINS, balanceUnit: 'CREDITS', balanceLeft } };
    return JSON.stringify({ kind: 'SessionA2uxEvent', event: { state: 'IN_PROGRESS' }, completion, timestampMs: endedAtMs + 4 });
  }

  function newEvents(newest: unknown = 701512.73275): string {
    return [...NOISE, snapshotLine(1789735651253, 704863.73775), UNKNOWN_LINE, 'not json at all', snapshotLine(1789736030118, newest)].join('\n');
  }

  function junieTree(events = newEvents()): Record<string, string> {
    return { 'sessions/index.jsonl': INDEX, 'sessions/session-old/events.jsonl': snapshotLine(1789730000000, 900000), 'sessions/session-new/events.jsonl': events };
  }

  function withFiles(runner: ProbeIo, files: Record<string, string>): ProbeIo {
    return { ...runner, reader: { homeDir: () => '/home/tester', read: async (path) => files[path], isDirectory: hasWorkConfig } };
  }

  function junieFiles(tree: Record<string, string>, root: string): Record<string, string> {
    return Object.fromEntries(Object.entries(tree).map(([path, body]) => [`${root}/${path}`, body]));
  }

  function junieIo(tree = junieTree(), root = '/junie'): ProbeIo {
    return withFiles(routedRunner(), { '/grok/logs/unified.jsonl': grokLog(), ...junieFiles(tree, root) });
  }

  async function junieLines(io: ProbeIo, env: Record<string, string>, now = JUNIE_NOW): Promise<string[]> {
    return panelOf(await runApp(io, { ...JUNIE_ENV, NO_COLOR: '1', ...env }, now), 'junie').slice(1);
  }

  it('renders the newest session snapshot between cursor and kilo, leaving the other panels unchanged', async () => {
    const output = await runApp(junieIo(), { ...JUNIE_ENV, NO_COLOR: '1' }, JUNIE_NOW);
    const lines = output.split('\n');
    const names = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];
    expect(lines.filter((line) => names.includes(line))).toEqual(names);
    const junie = lines.indexOf('junie');
    expect(lines.slice(junie - 1, junie + 5)).toEqual(['='.repeat(72), 'junie', ROW_30, 'snapshot 6h6m old', '701513 credits · junie', '='.repeat(72)]);
    expect(lines[junie + 5]).toBe('hermes');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
    const without = await runApp(junieIo({}), { ...JUNIE_ENV, NO_COLOR: '1' }, JUNIE_NOW);
    for (const name of names.filter((each) => each !== 'junie')) expect(panelOf(output, name)).toEqual(panelOf(without, name));
  });

  it.each<[string, Record<string, string>, Record<string, string>, string, string[]]>([
    ['reference 2000000', { DANDELION_JUNIE_REFERENCE: '2000000' }, junieTree(), JUNIE_NOW, ['credits                             #############-------  65%', 'snapshot 6h6m old', '701513 credits · junie']],
    ['reference 500000', { DANDELION_JUNIE_REFERENCE: '500000' }, junieTree(), JUNIE_NOW, ['credits                             --------------------   0%', 'snapshot 6h6m old', '701513 credits · junie']],
    ['reference abc', { DANDELION_JUNIE_REFERENCE: 'abc' }, junieTree(), JUNIE_NOW, [ROW_30, 'snapshot 6h6m old', '701513 credits · junie']],
    ['reference 0', { DANDELION_JUNIE_REFERENCE: '0' }, junieTree(), JUNIE_NOW, [ROW_30, 'snapshot 6h6m old', '701513 credits · junie']],
    ['reference -5', { DANDELION_JUNIE_REFERENCE: '-5' }, junieTree(), JUNIE_NOW, [ROW_30, 'snapshot 6h6m old', '701513 credits · junie']],
    ['an empty reference', { DANDELION_JUNIE_REFERENCE: '' }, junieTree(), JUNIE_NOW, ['balance without a reference', 'snapshot 6h6m old', '701513 credits · junie']],
    ['a balance of 1000000.4', {}, junieTree(newEvents(1000000.4)), JUNIE_NOW, ['credits                             --------------------   0%', 'snapshot 6h6m old', '1000000 credits · junie']],
    ['a balance of 0', {}, junieTree(newEvents(0)), JUNIE_NOW, ['credits                             #################### 100%', 'snapshot 6h6m old', '0 credits · junie']],
    ['only Unknown lines and noise in the newest session', {}, junieTree([...NOISE, UNKNOWN_LINE, 'not json at all'].join('\n')), JUNIE_NOW, ['credits                             ##------------------  10%', 'snapshot 7h46m old', '900000 credits · junie']],
    ['a balance of -1', {}, junieTree(newEvents(-1)), JUNIE_NOW, [ROW_30, 'snapshot 6h12m old', '704864 credits · junie']],
    ['a string balance', {}, junieTree(newEvents('701512')), JUNIE_NOW, [ROW_30, 'snapshot 6h12m old', '704864 credits · junie']],
    ['a snapshot older than 48h', {}, junieTree(), '2026-09-20T12:53:51Z', [ROW_30, 'stale snapshot 2d0h old', '701513 credits · junie']]
  ])('renders %s', async (_case, env, tree, now, lines) => {
    expect(await junieLines(junieIo(tree), env, now)).toEqual(lines);
  });

  it('colours a fresh junie gauge calm with a dim snapshot line and caption, and dims a stale panel without a ramp escape', async () => {
    const fresh = await runApp(junieIo(), JUNIE_ENV, JUNIE_NOW);
    expect(fresh).toContain(`\njunie\n${'credits'.padEnd(35)} ${CALM}${'█'.repeat(6)}${'░'.repeat(14)}\x1b[0m ${CALM} 30%\x1b[0m\n${DIM}snapshot 6h6m old\x1b[0m\n${DIM}701513 credits · junie\x1b[0m\n`);
    const stale = await runApp(junieIo(), JUNIE_ENV, '2026-09-20T12:53:51Z');
    expect(stale).toContain(`${DIM}${RULE}\njunie\n${'credits'.padEnd(35)} ${'█'.repeat(6)}${'░'.repeat(14)}  30%\nstale snapshot 2d0h old\n701513 credits · junie\x1b[0m\n`);
  });

  it.each<[string, Record<string, string>]>([
    ['a missing home', {}],
    ['an empty index', { 'sessions/index.jsonl': '' }],
    ['an index of only bad lines', { 'sessions/index.jsonl': 'not json at all' }],
    ['sessions whose events files are missing', { 'sessions/index.jsonl': INDEX }],
    ['only Unknown lines, noise and bad lines', { 'sessions/index.jsonl': INDEX, 'sessions/session-new/events.jsonl': [...NOISE, UNKNOWN_LINE, 'not json at all'].join('\n'), 'sessions/session-old/events.jsonl': UNKNOWN_LINE }]
  ])('renders a dim unavailable junie panel with %s while the others render normally', async (_case, tree) => {
    const output = await runApp(junieIo(tree), JUNIE_ENV, JUNIE_NOW);
    expect(output).toContain(`${DIM}${RULE}\njunie\nno junie quota snapshot — run junie once\njunie · junie\x1b[0m\n`);
    expect(panelOf(output, 'claude')).toHaveLength(5);
    expect(panelOf(output, 'kilo')[1]).toContain('$14.15');
  });

  it.each([[{}], [{ DANDELION_JUNIE_HOME: '' }]])('defaults junie home to ~/.junie for %j', async (env) => {
    const output = await runApp(junieIo(junieTree(), '/home/tester/.junie'), { ...GROK_ENV, NO_COLOR: '1', ...env }, JUNIE_NOW);
    expect(panelOf(output, 'junie').slice(1)).toEqual([ROW_30, 'snapshot 6h6m old', '701513 credits · junie']);
  });

  describe('against a real junie home', () => {
    let scratch = '';

    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), 'dandelion-junie-'));
    });

    afterEach(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    function writeTree(home: string, tree: Record<string, string>): void {
      for (const [path, body] of Object.entries(tree)) {
        mkdirSync(join(home, path, '..'), { recursive: true });
        writeFileSync(join(home, path), body);
      }
    }

    function snapshotOf(dir: string): [string, number, number, string][] {
      return readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort().map((name) => {
        const info = statSync(join(dir, name));
        return [name, info.size, info.mtimeMs, info.isFile() ? readFileSync(join(dir, name), 'utf8') : ''];
      });
    }

    it('renders the Background home and an empty home without writing to either', async () => {
      const home = join(scratch, 'junie');
      writeTree(home, junieTree());
      const empty = join(scratch, 'empty');
      mkdirSync(empty);
      const io = { ...routedRunner(), reader: realIo.reader };
      const before = snapshotOf(scratch);
      expect(panelOf(await runApp(io, { NO_COLOR: '1', DANDELION_JUNIE_HOME: home, DANDELION_HERMES_AUTH_FILE: join(scratch, 'missing-hermes.json') }, JUNIE_NOW), 'junie').slice(1)).toEqual([ROW_30, 'snapshot 6h6m old', '701513 credits · junie']);
      expect(panelOf(await runApp(io, { NO_COLOR: '1', DANDELION_JUNIE_HOME: empty, DANDELION_HERMES_AUTH_FILE: join(scratch, 'missing-hermes.json') }, JUNIE_NOW), 'junie')[1]).toBe('no junie quota snapshot — run junie once');
      expect(snapshotOf(scratch)).toEqual(before);
    });

    it('is unavailable when the index is a directory or unreadable', async () => {
      const io = { ...routedRunner(), reader: realIo.reader };
      mkdirSync(join(scratch, 'sessions', 'index.jsonl'), { recursive: true });
      expect(panelOf(await runApp(io, { DANDELION_JUNIE_HOME: scratch, DANDELION_HERMES_AUTH_FILE: join(scratch, 'missing-hermes.json') }, JUNIE_NOW), 'junie')[1]).toBe('no junie quota snapshot — run junie once');
      const locked = join(scratch, 'locked');
      writeTree(locked, junieTree());
      chmodSync(join(locked, 'sessions', 'index.jsonl'), 0o000);
      const reason = panelOf(await runApp(io, { DANDELION_JUNIE_HOME: locked, DANDELION_HERMES_AUTH_FILE: join(scratch, 'missing-hermes.json') }, JUNIE_NOW), 'junie')[1];
      expect(reason === 'no junie quota snapshot — run junie once' || process.getuid?.() === 0).toBe(true);
    });
  });

  describe('live dashboard and route', () => {
    let scratch = '';
    let statePath = '';

    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), 'dandelion-junie-state-'));
      statePath = join(scratch, 'eligibility.json');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      vi.setSystemTime(new Date(JUNIE_NOW));
    });

    afterEach(() => {
      vi.useRealTimers();
      rmSync(scratch, { recursive: true, force: true });
    });

    async function settledJunie(io: ProbeIo, env: Record<string, string>) {
      const dashboard = startDashboard({ ...io, launcher: MISSING_KIMI }, { ...JUNIE_ENV, NO_COLOR: '1', DANDELION_STATE_FILE: statePath, ...env });
      for (let turn = 0; turn < 16; turn += 1) await new Promise((resolve) => setImmediate(resolve));
      return dashboard;
    }

    function onlyJunie(tree: Record<string, string> = junieTree()): ProbeIo {
      return withFiles(mockRunner({ stdout: '', stderr: '', failure: 'missing' }), junieFiles(tree, '/junie'));
    }

    it('toggles junie off with space and flashes it as not routable without a reference', async () => {
      const dashboard = await settledJunie(junieIo(), {});
      dashboard.press('k');
      dashboard.press('k');
      dashboard.press('k');
      dashboard.press(' ');
      expect(dashboard.lastFrame().split('\n')).toContain(`▸ junie${' '.repeat(54)}routing off`);
      expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({ junie: false });
      dashboard.press('q');
      await dashboard.finished;
      rmSync(statePath);
      const unreferenced = await settledJunie(junieIo(), { DANDELION_JUNIE_REFERENCE: '' });
      unreferenced.press('k');
      unreferenced.press('k');
      unreferenced.press('k');
      unreferenced.press(' ');
      const lines = unreferenced.lastFrame().split('\n');
      expect(lines[lines.indexOf('▸ junie') + 3]).toBe('not routable (no usage windows)');
      await vi.advanceTimersByTimeAsync(2000);
      const later = unreferenced.lastFrame().split('\n');
      expect(later[later.indexOf('▸ junie') + 3]).toBe('701513 credits · junie');
      expect(readdirSync(scratch)).toEqual([]);
      unreferenced.press('q');
      await unreferenced.finished;
    });

    it.each<[Record<string, string>, string]>([
      [{}, '1/1 windows above 80% · next reset: none'],
      [{ DANDELION_JUNIE_REFERENCE: '' }, 'all windows below 80% · next reset: none']
    ])('counts junie credits in the fleet summary and never takes a reset from it with %j', async (env, summary) => {
      const dashboard = await settledJunie(onlyJunie(junieTree(newEvents(150000))), env);
      expect(dashboard.lastFrame().split('\n')[1]).toBe(summary);
      dashboard.press('q');
      await dashboard.finished;
    });

    it.each<[string, Record<string, string>, Record<string, string>, string, boolean]>([
      ['headroom', {}, junieTree(), 'model-g high junie', true],
      ['headroom', {}, junieTree(newEvents(0)), 'model-g high junie', true],
      ['headroom', { DANDELION_JUNIE_REFERENCE: '' }, junieTree(), 'none', false],
      ['headroom', {}, {}, 'none', false],
      ['high', {}, junieTree(newEvents(1000000)), 'none', false]
    ])('routes %s with only junie available under %j', async (mode, env, tree, line, routed) => {
      const request = { mode: mode === 'high' ? ('high' as const) : ('headroom' as const), now: JUNIE_NOW, zone: 'UTC' };
      expect(await routeWith(onlyJunie(tree), { ...JUNIE_ENV, DANDELION_STATE_FILE: statePath, ...env }, request)).toEqual({ line, routed });
    });

    it('shows junie in the route box and none in the --high box', async () => {
      const dashboard = await settledJunie(onlyJunie(), {});
      const lines = dashboard.lastFrame().split('\n');
      expect(lines.slice(3, 5)).toEqual([`| ${'model-g high'.padEnd(31)} |  | ${'none'.padEnd(31)} |`, `| ${'junie'.padEnd(31)} |  | ${'no subscription available'.padEnd(31)} |`]);
      dashboard.press('q');
      await dashboard.finished;
    });

    it('skips junie when the state file turns it off', async () => {
      writeFileSync(statePath, '{"junie": false}');
      expect(await routeWith(onlyJunie(), { ...JUNIE_ENV, DANDELION_STATE_FILE: statePath }, { mode: 'headroom', now: JUNIE_NOW, zone: 'UTC' })).toEqual({ line: 'none', routed: false });
    });
  });
});

describe('hermes panel', () => {
  const HERMES_NOW = '2026-09-18T19:00:00Z';
  const AGENT = 'qa-dummy-hermes-agent-key-016';
  const ACCESS = 'qa-dummy-hermes-access-016';
  const RESET = '2026-09-21T19:00:00.000Z';
  const WARM = '\x1b[33m';
  const ROW_75 = 'credits                             ###############-----  75% ↻ 3d0h';
  const HERMES_ENV = { ...GROK_ENV, DANDELION_HERMES_AUTH_FILE: '/auth.json', DANDELION_HERMES_PORTAL_BASE: 'http://127.0.0.1:48016' };
  type Outcome = Awaited<ReturnType<Fetcher['get']>>;

  function authJson(nous: Record<string, unknown> = {}): string {
    return JSON.stringify({
      version: 1,
      providers: {
        nous: {
          access_token: ACCESS,
          refresh_token: 'r',
          client_id: 'hermes-cli',
          portal_base_url: 'https://portal.nousresearch.com',
          agent_key: AGENT,
          agent_key_expires_at: '2026-09-19T19:00:00+00:00',
          expires_at: '2026-09-19T19:00:00+00:00',
          ...nous
        }
      },
      active_provider: 'nous'
    });
  }

  function account(
    overrides: { subscription?: Record<string, unknown>; paid_service_access?: Record<string, unknown> } = {}
  ): Record<string, unknown> {
    return {
      user: { email: 'qa@example.com' },
      organisation: { id: 'o', slug: 'o', name: 'O' },
      subscription: {
        plan: 'Plus',
        monthly_credits: 22,
        credits_remaining: 5.5,
        current_period_end: RESET,
        ...overrides.subscription
      },
      paid_service_access: { paid_access: true, ...overrides.paid_service_access }
    };
  }

  function hermesIo(accountAnswer: Outcome = { status: 200, body: JSON.stringify(account()) }, files: Record<string, string> = { '/auth.json': authJson() }) {
    const stored: Record<string, string> = { '/grok/logs/unified.jsonl': grokLog(), ...files };
    const requests: [string, Record<string, string>, number][] = [];
    const reader: FileReader = { homeDir: () => '/home/tester', read: async (path) => stored[path], isDirectory: hasWorkConfig };
    const fetcher: Fetcher = {
      get: async (url, headers, timeoutMs) => {
        if (url.includes('/api/oauth/account')) {
          requests.push([url, headers, timeoutMs]);
          return accountAnswer;
        }
        return KIMI_FETCHER.get(url, headers, timeoutMs);
      },
      post: async () => ({ failure: 'network' })
    };
    return { io: { ...routedRunner({}, HAPPY_KIMI, reader), fetcher }, requests };
  }

  function onlyHermes(accountAnswer?: Outcome, files: Record<string, string> = { '/auth.json': authJson() }) {
    const { io, requests } = hermesIo(accountAnswer, { '/grok/logs/unified.jsonl': '', ...files });
    return { io: { ...mockRunner({ stdout: '', stderr: '', failure: 'missing' }), fetcher: io.fetcher, reader: io.reader }, requests };
  }

  it('renders the credits window between junie and kilo, leaving the other panels unchanged', async () => {
    const { io } = hermesIo();
    const output = await runApp(io, { ...HERMES_ENV, NO_COLOR: '1' }, HERMES_NOW);
    const lines = output.split('\n');
    const names = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];
    expect(lines.filter((line) => names.includes(line))).toEqual(names);
    const hermes = lines.indexOf('hermes');
    expect(lines.slice(hermes - 1, hermes + 4)).toEqual(['='.repeat(72), 'hermes', ROW_75, 'Plus · $5.50 of $22 · hermes', '='.repeat(72)]);
    expect(lines[hermes + 4]).toBe('kilo');
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
    expect(output).not.toContain(AGENT);
    expect(output).not.toContain(ACCESS);
    const { io: without } = hermesIo(undefined, {});
    const missing = await runApp(without, { ...HERMES_ENV, NO_COLOR: '1' }, HERMES_NOW);
    for (const name of names.filter((each) => each !== 'hermes')) expect(panelOf(output, name)).toEqual(panelOf(missing, name));
  });

  it('renders junie at 30%, hermes at 75% and kilo at 14 of 20 under the frozen clock', async () => {
    const snapshot = JSON.stringify({
      kind: 'SessionA2uxEvent',
      completion: {
        endedAtMs: 1789736030118,
        quota: {
          type: 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.JetBrains',
          balanceLeft: 701512.73275
        }
      }
    });
    const { io } = hermesIo({ status: 200, body: JSON.stringify(account()) }, {
      '/auth.json': authJson(),
      '/junie/sessions/index.jsonl': '{"sessionId":"session-new","updatedAt":1}',
      '/junie/sessions/session-new/events.jsonl': snapshot
    });
    const output = await runApp(io, { ...HERMES_ENV, DANDELION_JUNIE_HOME: '/junie', NO_COLOR: '1' }, HERMES_NOW);
    const lines = output.split('\n');
    const names = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];
    expect(lines[0]).toMatch(/^DANDELION +19:00:00Z$/);
    expect(lines.filter((line) => names.includes(line))).toEqual(names);
    expect(panelOf(output, 'junie').slice(1)).toEqual(['credits                             ######--------------  30%', 'snapshot 6h6m old', '701513 credits · junie']);
    expect(panelOf(output, 'hermes').slice(1)).toEqual([ROW_75, 'Plus · $5.50 of $22 · hermes']);
    expect(panelOf(output, 'kilo').slice(1)).toEqual([`$14.15 ${'#'.repeat(14)}${'-'.repeat(6)}`.padEnd(72), 'api balance · kilo']);
    expect(lines.every((line) => [...line].length <= 72)).toBe(true);
    expect(output).not.toContain(AGENT);
    expect(output).not.toContain(ACCESS);
  });

  it('GETs the account once with the agent key and JSON accept', async () => {
    const { io, requests } = hermesIo();
    await runApp(io, { ...HERMES_ENV, NO_COLOR: '1' }, HERMES_NOW);
    expect(requests).toEqual([['http://127.0.0.1:48016/api/oauth/account', { Authorization: `Bearer ${AGENT}`, Accept: 'application/json' }, 15000]]);
  });

  it('colours the hermes gauge and percent warm and the caption dim', async () => {
    const { io } = hermesIo();
    const output = await runApp(io, HERMES_ENV, HERMES_NOW);
    expect(output).toContain(`\nhermes\n${'credits'.padEnd(35)} ${WARM}${'█'.repeat(15)}${'░'.repeat(5)}\x1b[0m ${WARM} 75%\x1b[0m ↻ 3d0h\n${DIM}Plus · $5.50 of $22 · hermes\x1b[0m\n`);
  });

  it.each<[string, { subscription?: Record<string, unknown>; paid_service_access?: Record<string, unknown> }, string[]]>([
    ['credits remaining above the grant', { subscription: { credits_remaining: 22.472091793333334 } }, ['credits                             --------------------   0% ↻ 3d0h', 'Plus · $22.47 of $22 · hermes']],
    ['zero remaining', { subscription: { credits_remaining: 0 } }, ['credits                             #################### 100% ↻ 3d0h', 'Plus · $0.00 of $22 · hermes']],
    ['half remaining', { subscription: { credits_remaining: 11 } }, ['credits                             ##########----------  50% ↻ 3d0h', 'Plus · $11.00 of $22 · hermes']],
    ['3.3 remaining', { subscription: { credits_remaining: 3.3 } }, ['credits                             #################---  85% ↻ 3d0h', 'Plus · $3.30 of $22 · hermes']],
    ['no plan', { subscription: { plan: '' } }, [ROW_75, 'hermes · hermes']],
    ['paid_access false', { paid_service_access: { paid_access: false } }, [ROW_75, 'Plus · $5.50 of $22 · hermes · no paid access']],
    ['no plan and paid_access false', { subscription: { plan: '' }, paid_service_access: { paid_access: false } }, [ROW_75, 'hermes · hermes · no paid access']],
    ['no current_period_end', { subscription: { current_period_end: undefined } }, ['credits                             ###############-----  75%', 'Plus · $5.50 of $22 · hermes']]
  ])('renders a body with %s', async (_case, overrides, lines) => {
    const { io } = hermesIo({ status: 200, body: JSON.stringify(account(overrides)) });
    expect(panelOf(await runApp(io, { ...HERMES_ENV, NO_COLOR: '1' }, HERMES_NOW), 'hermes').slice(1)).toEqual(lines);
  });

  it.each<[string, Outcome | undefined, Record<string, string>, string]>([
    ['a missing auth file', undefined, {}, 'no hermes auth — run hermes portal login'],
    ['an empty auth file', undefined, { '/auth.json': '' }, 'no hermes auth — run hermes portal login'],
    ['both tokens empty', undefined, { '/auth.json': authJson({ agent_key: '', access_token: '' }) }, 'no hermes auth — run hermes portal login'],
    ['an expired token', undefined, { '/auth.json': authJson({ agent_key_expires_at: '2026-09-17T19:00:00+00:00', expires_at: '2026-09-17T19:00:00+00:00' }) }, 'hermes token expired — run hermes once'],
    ['HTTP 401 echoing the token', { status: 401, body: `{"error":"bad token ${AGENT}"}` }, { '/auth.json': authJson() }, 'hermes account request failed: HTTP 401'],
    ['HTTP 500', { status: 500, body: '' }, { '/auth.json': authJson() }, 'hermes account request failed: HTTP 500'],
    ['a network failure', { failure: 'network' }, { '/auth.json': authJson() }, 'hermes account request failed'],
    ['a timeout', { failure: 'timeout' }, { '/auth.json': authJson() }, 'hermes account request timed out after 15s'],
    ['a non-JSON body', { status: 200, body: 'not json' }, { '/auth.json': authJson() }, 'Could not parse usage from response'],
    ['monthly_credits 0', { status: 200, body: JSON.stringify(account({ subscription: { monthly_credits: 0 } })) }, { '/auth.json': authJson() }, 'Could not parse usage from response']
  ])('renders a dim hermes panel for %s while the others render normally', async (_case, accountAnswer, files, reason) => {
    const { io, requests } = hermesIo(accountAnswer ?? { status: 200, body: JSON.stringify(account()) }, files);
    const output = await runApp(io, HERMES_ENV, HERMES_NOW);
    expect(output).toContain(`${DIM}${RULE}\nhermes\n${reason}\nhermes · hermes\x1b[0m\n`);
    expect(panelOf(output, 'claude')).toHaveLength(5);
    expect(panelOf(output, 'kilo')[1]).toContain('$14.15');
    expect(output).not.toContain(AGENT);
    expect(output).not.toContain(ACCESS);
    if (reason.startsWith('no hermes auth') || reason.startsWith('hermes token expired')) expect(requests).toEqual([]);
  });

  it.each([[{}], [{ DANDELION_HERMES_AUTH_FILE: '', DANDELION_HERMES_PORTAL_BASE: '' }]])('defaults the auth file and portal base for %j', async (env) => {
    const { io, requests } = hermesIo(undefined, {
      '/home/tester/.hermes/auth.json': authJson({ agent_key: 'home-hermes-agent-key' })
    });
    const output = await runApp(io, { ...GROK_ENV, NO_COLOR: '1', ...env }, HERMES_NOW);
    expect(panelOf(output, 'hermes').slice(1)).toEqual([ROW_75, 'Plus · $5.50 of $22 · hermes']);
    expect(requests[0]?.[0]).toBe('https://portal.nousresearch.com/api/oauth/account');
    expect(requests[0]?.[1].Authorization).toBe('Bearer home-hermes-agent-key');
  });

  describe('against a real auth file', () => {
    let scratch = '';

    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), 'dandelion-hermes-'));
    });

    afterEach(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    it('renders the Background auth file without writing the tokens anywhere', async () => {
      const authFile = join(scratch, 'auth.json');
      const body = authJson();
      writeFileSync(authFile, body);
      const before = readdirSync(scratch, { recursive: true, encoding: 'utf8' }).map((name) => [name, statSync(join(scratch, name)).mtimeMs]);
      const { io } = hermesIo();
      const real = { ...io, reader: realIo.reader };
      const output = await runApp(real, { ...HERMES_ENV, DANDELION_HERMES_AUTH_FILE: authFile, NO_COLOR: '1' }, HERMES_NOW);
      expect(panelOf(output, 'hermes').slice(1)).toEqual([ROW_75, 'Plus · $5.50 of $22 · hermes']);
      expect(readdirSync(scratch, { recursive: true, encoding: 'utf8' }).map((name) => [name, statSync(join(scratch, name)).mtimeMs])).toEqual(before);
      expect(readFileSync(authFile, 'utf8')).toBe(body);
      expect(output).not.toContain(AGENT);
      expect(output).not.toContain(ACCESS);
    });

    it('is unavailable when the auth path is a directory or unreadable', async () => {
      const { io } = hermesIo();
      const real = { ...io, reader: realIo.reader };
      mkdirSync(join(scratch, 'auth-dir'));
      expect(panelOf(await runApp(real, { ...HERMES_ENV, DANDELION_HERMES_AUTH_FILE: join(scratch, 'auth-dir') }, HERMES_NOW), 'hermes')[1]).toBe('no hermes auth — run hermes portal login');
      const locked = join(scratch, 'locked.json');
      writeFileSync(locked, authJson());
      chmodSync(locked, 0o000);
      const reason = panelOf(await runApp(real, { ...HERMES_ENV, DANDELION_HERMES_AUTH_FILE: locked }, HERMES_NOW), 'hermes')[1];
      expect(reason === 'no hermes auth — run hermes portal login' || process.getuid?.() === 0).toBe(true);
    });
  });

  describe('live dashboard and route', () => {
    let scratch = '';
    let statePath = '';

    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), 'dandelion-hermes-state-'));
      statePath = join(scratch, 'eligibility.json');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      vi.setSystemTime(new Date(HERMES_NOW));
    });

    afterEach(() => {
      vi.useRealTimers();
      rmSync(scratch, { recursive: true, force: true });
    });

    async function settledHermes(io: ProbeIo, env: Record<string, string>, clock?: () => string) {
      const dashboard = startDashboard({ ...io, launcher: MISSING_KIMI }, { ...HERMES_ENV, NO_COLOR: '1', DANDELION_STATE_FILE: statePath, ...env }, clock);
      for (let turn = 0; turn < 16; turn += 1) await new Promise((resolve) => setImmediate(resolve));
      return dashboard;
    }

    it('toggles hermes off with space and flashes it as not routable without auth', async () => {
      const { io } = hermesIo();
      const dashboard = await settledHermes(io, {});
      dashboard.press('k');
      dashboard.press('k');
      dashboard.press(' ');
      expect(dashboard.lastFrame().split('\n')).toContain(`▸ hermes${' '.repeat(53)}routing off`);
      expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({ hermes: false });
      dashboard.press('q');
      await dashboard.finished;
      rmSync(statePath);
      const { io: missing } = hermesIo(undefined, {});
      const unroutable = await settledHermes(missing, {});
      unroutable.press('k');
      unroutable.press('k');
      unroutable.press(' ');
      const lines = unroutable.lastFrame().split('\n');
      expect(lines[lines.indexOf('▸ hermes') + 2]).toBe('not routable (no usage windows)');
      await vi.advanceTimersByTimeAsync(2000);
      const later = unroutable.lastFrame().split('\n');
      expect(later[later.indexOf('▸ hermes') + 2]).toBe('hermes · hermes');
      expect(readdirSync(scratch)).toEqual([]);
      unroutable.press('q');
      await unroutable.finished;
    });

    it.each<[number, string]>([
      [3.3, '1/1 windows above 80% · next reset: hermes credits in 3d0h'],
      [5.5, 'all windows below 80% · next reset: hermes credits in 3d0h']
    ])('counts hermes credits in the fleet summary at remaining %s', async (remaining, summary) => {
      const { io } = onlyHermes({ status: 200, body: JSON.stringify(account({ subscription: { credits_remaining: remaining } })) });
      const dashboard = await settledHermes(io, {}, () => HERMES_NOW);
      expect(dashboard.lastFrame().split('\n')[1]).toBe(summary);
      dashboard.press('q');
      await dashboard.finished;
    });

    it.each<[string, Outcome, Record<string, string>, string, boolean]>([
      ['headroom at 75%', { status: 200, body: JSON.stringify(account()) }, { '/auth.json': authJson() }, 'vendor/model-h xhigh hermes', true],
      ['headroom at 0%', { status: 200, body: JSON.stringify(account({ subscription: { credits_remaining: 22 } })) }, { '/auth.json': authJson() }, 'vendor/model-h xhigh hermes', true],
      ['headroom at 100%', { status: 200, body: JSON.stringify(account({ subscription: { credits_remaining: 0 } })) }, { '/auth.json': authJson() }, 'vendor/model-h xhigh hermes', true],
      ['headroom without auth', { status: 200, body: JSON.stringify(account()) }, {}, 'none', false],
      ['high at 0%', { status: 200, body: JSON.stringify(account({ subscription: { credits_remaining: 22 } })) }, { '/auth.json': authJson() }, 'none', false]
    ])('routes %s with only hermes available', async (mode, accountAnswer, files, line, routed) => {
      const { io } = onlyHermes(accountAnswer, files);
      const request = { mode: mode.startsWith('high') ? ('high' as const) : ('headroom' as const), now: HERMES_NOW, zone: 'UTC' };
      expect(await routeWith(io, { ...HERMES_ENV, DANDELION_STATE_FILE: statePath }, request)).toEqual({ line, routed });
    });

    it('shows hermes in the route box and none in the --high box', async () => {
      const { io } = onlyHermes();
      const dashboard = await settledHermes(io, {});
      const lines = dashboard.lastFrame().split('\n');
      expect(lines.slice(3, 5)).toEqual([`| ${'vendor/model-h xhigh'.padEnd(31)} |  | ${'none'.padEnd(31)} |`, `| ${'hermes'.padEnd(31)} |  | ${'no subscription available'.padEnd(31)} |`]);
      dashboard.press('q');
      await dashboard.finished;
    });

    it('skips hermes when the state file turns it off', async () => {
      writeFileSync(statePath, '{"hermes": false}');
      const { io } = onlyHermes();
      expect(await routeWith(io, { ...HERMES_ENV, DANDELION_STATE_FILE: statePath }, { mode: 'headroom', now: HERMES_NOW, zone: 'UTC' })).toEqual({ line: 'none', routed: false });
    });
  });
});

