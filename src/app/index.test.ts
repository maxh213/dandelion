import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { runApp, realCommandRunner, realIo } from './index.ts';
import type { CommandRunner, CommandRunnerResult, Fetcher, FileReader, LaunchedProcess, Launcher, ProbeIo } from '../probes/index.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const PROFILE = 'Name: Max\nEmail: yeti213@googlemail.com\nTeam: Personal\nBalance: $14.15\n';
const KIMI_BODY = JSON.stringify({
  data: {
    summary: { used: 590, limit: 1000, reset_at: '2026-09-18T10:00:00Z' },
    limits: [{ used: 42, limit: 100, window: { unit: 'hour', value: 5 } }]
  }
});
const MISSING_KIMI: Launcher = { launch: async () => undefined };
const KIMI_CHILD: LaunchedProcess = {
  output: async () => 'kimi web ready: http://127.0.0.1:48123/?token=test-token',
  hasExited: () => false,
  stop: async () => undefined
};
const HAPPY_KIMI: Launcher = { launch: async () => KIMI_CHILD };
const KIMI_FETCHER: Fetcher = { get: async () => ({ status: 200, body: KIMI_BODY }) };
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

function grokReader(log: string | undefined): FileReader {
  return { homeDir: () => '/home/tester', read: async (path) => (path === '/grok/logs/unified.jsonl' ? log : undefined) };
}

const LONG_UNUSABLE = Array.from({ length: 50000 }, () => '{"msg":"billing: fetched credits config","ts":"x"}').join('\n');
const GROK_ENV = { ALLOWANCE_GROK_HOME: '/grok' };
const NO_GROK = grokReader(undefined);

function ioOf(runner: CommandRunner, launcher: Launcher = MISSING_KIMI, reader: FileReader = NO_GROK): ProbeIo {
  return { runner, launcher, fetcher: KIMI_FETCHER, reader };
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
const HAPPY: Record<string, CommandRunnerResult> = {
  claude: { stdout: CLAUDE_USAGE, stderr: '' },
  agy: { stdout: AGY_USAGE, stderr: '' },
  kilo: { stdout: PROFILE, stderr: '' }
};
const DIM = '\x1b[90m';
const RULE = '━'.repeat(72);

function routedRunner(overrides: Record<string, CommandRunnerResult> = {}, launcher = HAPPY_KIMI, reader = grokReader(grokLog())): ProbeIo {
  const results = { ...HAPPY, ...overrides };
  return ioOf({ run: async (command) => results[command] }, launcher, reader);
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
  it('renders claude, agy, kimi, grok and kilo panels in fixed order with captions', async () => {
    const output = await runApp(routedRunner(), GROK_ENV, NOW);
    const lines = plain(output).split('\n');
    expect(lines[0]).toMatch(/^ALLOWANCE +10:00:00Z$/);
    expect(lines.filter((line) => line === RULE)).toHaveLength(5);
    expect(['claude', 'agy', 'kimi', 'grok', 'kilo'].map((name) => lines.indexOf(name))).toEqual([2, 8, 15, 20, 25]);
    expect(lines[1]).toBe(RULE);
    expect(panelOf(output, 'claude').at(-1)).toBe('claude code · claude');
    expect(panelOf(output, 'agy').at(-1)).toBe('agy · agy');
    expect(output).toContain(`${DIM}claude code · claude\x1b[0m`);
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
      'claude code · claude'
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
    expect(new Set(output.replaceAll(/[\x20-\x7e\n]/g, ''))).toEqual(new Set(['↻', '·', '…']));
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
    expect(output).toContain(`${DIM}${RULE}\nclaude\n${reason}\nclaude code · claude\x1b[0m`);
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
    const resumeAllOnFourth = () => {
      if (release.length === 4) release.reverse().forEach((resume) => resume());
    };
    const runner: CommandRunner = {
      run: () =>
        new Promise((resolve) => {
          release.push(() => resolve({ stdout: '', stderr: '', failure: 'timeout' }));
          resumeAllOnFourth();
        })
    };
    const silentKimi: LaunchedProcess = { output: async () => '', hasExited: () => true, stop: async () => undefined };
    const launcher: Launcher = {
      launch: () =>
        new Promise((resolve) => {
          release.push(() => resolve(silentKimi));
          resumeAllOnFourth();
        })
    };
    const output = plain(await runApp(ioOf(runner, launcher), {}, NOW));
    expect(output).toContain(
      [
        'claude\nCommand timed out after 90s\nclaude code · claude',
        'agy\nCommand timed out after 60s\nagy · agy',
        'kimi\nkimi web exited without printing a token\nkimi code · kimi',
        'grok\nno grok billing snapshot — run grok once\ngrok · grok',
        'kilo\nCommand timed out after 20s\napi balance · kilo'
      ].join(`\n${RULE}\n`)
    );
  });

  it('renders five unavailable panels when no CLI is on the PATH and grok home is empty', async () => {
    const output = await runApp(mockRunner({ stdout: '', stderr: '', failure: 'missing' }), {}, NOW);
    expect(output).toContain(
      [
        `${DIM}${RULE}\nclaude\nclaude CLI not found in PATH\nclaude code · claude\x1b[0m`,
        `${DIM}${RULE}\nagy\nagy CLI not found in PATH\nagy · agy\x1b[0m`,
        `${DIM}${RULE}\nkimi\nkimi CLI not found in PATH\nkimi code · kimi\x1b[0m`,
        `${DIM}${RULE}\ngrok\nno grok billing snapshot — run grok once\ngrok · grok\x1b[0m`,
        `${DIM}${RULE}\nkilo\nkilo CLI not found in PATH\napi balance · kilo\x1b[0m`
      ].join('\n')
    );
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
      'kilo'
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
    expect(output).toContain(`${DIM}claude code · claude\x1b[0m`);
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
    scratch = mkdtempSync(join(tmpdir(), 'allowance-grok-'));
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
    const output = await runApp(io, { ALLOWANCE_GROK_HOME: home, NO_COLOR: '1' }, NOW);
    expect(output).toContain('\ngrok\ncredits                             ###############-----  75% ↻ 11h15m\n');
    expect(tree(home)).toEqual(before);
    const empty = join(home, 'empty');
    mkdirSync(empty);
    const emptyBefore = tree(empty);
    expect(await runApp(io, { ALLOWANCE_GROK_HOME: empty }, NOW)).toContain('grok\nno grok billing snapshot — run grok once');
    expect(tree(empty)).toEqual(emptyBefore);
    expect(await runApp(io, { ALLOWANCE_GROK_HOME: join(home, 'missing') }, NOW)).toContain('grok\nno grok billing snapshot — run grok once');
    expect(readdirSync(home).sort()).toEqual(['empty', 'logs']);
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
    const scratch = mkdtempSync(join(tmpdir(), 'allowance-test-'));
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

describe('real fetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
  it('displays kilo balance with default reference', async () => {
    const output = await runApp(profileRunner(PROFILE), {}, NOW);
    expect(output).toContain('ALLOWANCE');
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
    const output = await runApp(profileRunner('Balance: $14.15'), { ALLOWANCE_KILO_REFERENCE: '' }, NOW);
    expect(output).toContain('$14.15 ░░░░░░░░░░░░░░░░░░░░');
  });

  it('uses a custom reference', async () => {
    const output = await runApp(profileRunner('Balance: $5.00'), { ALLOWANCE_KILO_REFERENCE: '10' }, NOW);
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
    expect(output).toContain('ALLOWANCE');
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

  it('probes claude, agy and kilo with their commands and timeouts', async () => {
    const calls: [string, string[], number][] = [];
    const runner: CommandRunner = {
      run: async (command, args, timeoutMs) => {
        calls.push([command, args, timeoutMs]);
        return { stdout: PROFILE, stderr: '' };
      }
    };
    await runApp(ioOf(runner), {}, NOW);
    expect(calls).toEqual([
      ['claude', ['-p', '/usage'], 90000],
      ['agy', ['-p', '/usage'], 60000],
      ['kilo', ['profile'], 20000]
    ]);
  });

  it('realCommandRunner executes commands successfully', async () => {
    const result = await realCommandRunner.run('node', ['-e', 'console.log("hello")'], 2000);
    expect(result.stdout).toContain('hello');
    expect(result.failure).toBeUndefined();
  });

  it('realCommandRunner reports a missing binary', async () => {
    const result = await realCommandRunner.run('thiscommanddoesnotexist', [], 2000);
    expect(result.failure).toBe('missing');
  });

  it('realCommandRunner reports a timeout', async () => {
    const result = await realCommandRunner.run('node', ['-e', 'setTimeout(() => {}, 5000)'], 100);
    expect(result.failure).toBe('timeout');
  });

  it('realCommandRunner reports a non-zero exit', async () => {
    const result = await realCommandRunner.run('node', ['-e', 'process.exit(2)'], 2000);
    expect(result.failure).toBe('exit');
  });

  it('realCommandRunner reports a self-inflicted SIGTERM as an exit', async () => {
    const result = await realCommandRunner.run('node', ['-e', 'process.kill(process.pid, "SIGTERM")'], 2000);
    expect(result.failure).toBe('exit');
  });
});
