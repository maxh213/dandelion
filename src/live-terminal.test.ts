import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';

const NPM = join(dirname(process.execPath), 'npm');
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const OUTER_TIMEOUT_MS = 60000;
const PREFIX = 'dandelion-qa-007-';
const ENTER = '\x1b[?1049h';
const CLEAR = '\x1b[H\x1b[2J';
const RESTORE = '\x1b[?25h\x1b[?1049l';
const IDS = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];
const CLAUDE_FIXTURE = "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'\n";
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const CODEX_FIXTURE = "#!/bin/sh\necho 'Logged in using an API key - sk-proj-***n5zQA' >&2\n";
const KILO_FIXTURE = "#!/bin/sh\n[ \"$1\" = \"profile\" ] || exit 2\necho 'Balance: $14.15'\n";
const SLOW_KILO = '#!/usr/bin/env node\nsetTimeout(() => console.log("Balance: $14.15"), 60000);\n';
const KIMI_EXITS = '#!/bin/sh\nexit 0\n';
const KIMI_STAYS = `#!/usr/bin/env node
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'kimi.pid'), String(process.pid));
setInterval(() => {}, 1000);
`;
const OTHER_PANELS = [
  /\nclaude\nweekly +#+-* +86%( ↻ \S+)?\nclaude · personal · claude\n/,
  /\nclaude-work\nweekly +#+-* +86%( ↻ \S+)?\nclaude · work · claude-work\n/,
  /\nagy\nGemini Models · Weekly Limit +-+ +0%( ↻ \S+)?\nagy · agy\n/,
  /\nkimi\nkimi web exited without printing a token\nkimi code · kimi\n/,
  /\ngrok\nno grok billing snapshot — run grok once\ngrok · grok\n/,
  /\ncodex\napi-key billing · no usage windows\ncodex · codex\n/,
  /\ncursor\nno cursor auth — run cursor-agent login\ncursor · cursor\n/
];
const KILO_PENDING = /\nkilo\n\S probing…$/;
const KILO_TIMED_OUT = '\nkilo\nCommand timed out after 20s\napi balance · kilo';

interface Run {
  child: ChildProcess;
  output: string;
  stderr: string;
  started: number;
  closed: Promise<unknown[]>;
}

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), PREFIX));
  temps.push(dir);
  return dir;
}

function fixtureDir(kimi: string, kilo = KILO_FIXTURE): string {
  const dir = tempDir();
  const scripts = { claude: CLAUDE_FIXTURE, agy: AGY_FIXTURE, kimi, codex: CODEX_FIXTURE, kilo };
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

function appEnv(pathDir: string): NodeJS.ProcessEnv {
  const bin = tempDir();
  symlinkSync(process.execPath, join(bin, 'node'));
  symlinkSync('/bin/sh', join(bin, 'sh'));
  const grokHome = tempDir();
  const inherited = { ...process.env };
  delete inherited.DANDELION_KILO_REFERENCE;
  delete inherited.DANDELION_KIMI_PORT;
  delete inherited.DANDELION_CURSOR_API_BASE;
  delete inherited.CLAUDE_CONFIG_DIR;
  return {
    ...inherited,
    PATH: `${pathDir}:${bin}`,
    SHELL: '/bin/sh',
    NO_COLOR: '1',
    DANDELION_REFRESH_SECONDS: '1',
    DANDELION_GROK_HOME: grokHome,
    DANDELION_CLAUDE_WORK_CONFIG_DIR: grokHome,
    DANDELION_CURSOR_AUTH_FILE: join(grokHome, 'missing-auth.json'),
    DANDELION_STATE_FILE: join(grokHome, 'state', 'eligibility.json')
  };
}

function launch(command: string, args: string[], env: NodeJS.ProcessEnv): Run {
  const child = spawn(command, args, { env, timeout: OUTER_TIMEOUT_MS });
  const run: Run = { child, output: '', stderr: '', started: Date.now(), closed: once(child, 'close') };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (run.output += chunk));
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (run.stderr += chunk));
  return run;
}

function startLive(env: NodeJS.ProcessEnv): Run {
  return launch('/usr/bin/script', ['-qfec', `'${NPM}' start --silent`, '/dev/null'], env);
}

function completeFrames(run: Run): string[] {
  return run.output.replaceAll('\r\n', '\n').split(CLEAR).slice(1, -1);
}

async function waitWithin(run: Run, predicate: () => boolean, boundMs: number, what: string): Promise<void> {
  while (!predicate()) {
    if (Date.now() - run.started >= boundMs) {
      throw new Error(`no ${what} within ${boundMs}ms\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function pidIn(pidFile: string): number {
  try {
    return Number(readFileSync(pidFile, 'utf8'));
  } catch {
    return 0;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function settledIndex(run: Run): number {
  return completeFrames(run).findIndex((frame) => !frame.includes('probing…'));
}

function refreshedAfterSettle(run: Run): boolean {
  const settled = settledIndex(run);
  return settled >= 0 && completeFrames(run).slice(settled + 1).some((frame) => frame.split('\n')[0].includes('refreshing…'));
}

function qaProcessesLeft(): string[] {
  return readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)
    .map((entry) => {
      try {
        return readFileSync(join('/proc', entry, 'cmdline'), 'utf8');
      } catch {
        return '';
      }
    })
    .filter((cmdline) => cmdline.includes(PREFIX));
}

afterEach(() => {
  expect(qaProcessesLeft()).toEqual([]);
  temps.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  expect(JSON.parse(readFileSync('package.json', 'utf-8')).dependencies).toBeUndefined();
});

describe('live mode on a real terminal', () => {
  it('liveFramesThenQuit: settles, refreshes, quits on q and restores the terminal after the last frame', async () => {
    const run = startLive(appEnv(fixtureDir(KIMI_EXITS)));
    await waitWithin(run, () => settledIndex(run) >= 0, 20000, 'frame with no probing…');
    await waitWithin(run, () => refreshedAfterSettle(run), 40000, 'later frame whose banner has refreshing…');
    run.child.stdin?.write('q');
    expect(await run.closed).toEqual([0, null]);
    expect(run.output).toContain(ENTER);
    expect(run.output.lastIndexOf(RESTORE)).toBeGreaterThan(run.output.lastIndexOf(CLEAR));
  }, 60000);

  it('quitReapsKimi: q during an in-flight kimi probe exits 0 within 7 seconds and reaps the child', async () => {
    const dir = fixtureDir(KIMI_STAYS);
    const run = startLive(appEnv(dir));
    const pidFile = join(dir, 'kimi.pid');
    await waitWithin(run, () => pidIn(pidFile) > 0, 20000, 'kimi pid file');
    const pid = pidIn(pidFile);
    const quitAt = Date.now();
    run.child.stdin?.write('q');
    expect(await run.closed).toEqual([0, null]);
    expect(Date.now() - quitAt).toBeLessThan(7000);
    expect(isRunning(pid)).toBe(false);
  }, 60000);

  it('pipedRunsOnce: with stdout piped and stdin open it prints one once-mode dashboard and exits 0', async () => {
    const run = launch(NPM, ['start', '--silent'], appEnv(fixtureDir(KIMI_EXITS)));
    const status = await run.closed;
    run.child.stdin?.destroy();
    expect(status).toEqual([0, null]);
    const lines = run.output.split('\n');
    expect(lines[0]).toMatch(/^DANDELION +\d{2}:\d{2}:\d{2}Z$/);
    expect(lines.filter((line) => IDS.includes(line))).toEqual(IDS);
    expect(run.output.split('DANDELION')).toHaveLength(2);
    expect(run.output).not.toContain('probing…');
    expect(run.output).not.toContain(ENTER);
  }, 60000);

  it('hangingKiloNeverDelaysTheOthers: six panels land within 5 seconds, kilo times out within 30, then q exits 0', async () => {
    const run = startLive(appEnv(fixtureDir(KIMI_EXITS, SLOW_KILO)));
    const othersDoneKiloPending = (frame: string) => OTHER_PANELS.every((panel) => panel.test(frame)) && KILO_PENDING.test(frame);
    await waitWithin(run, () => completeFrames(run).some(othersDoneKiloPending), 5000, 'frame with six settled panels and a pending kilo');
    await waitWithin(run, () => completeFrames(run).some((frame) => frame.includes(KILO_TIMED_OUT)), 30000, 'kilo timeout reason');
    run.child.stdin?.write('q');
    expect(await run.closed).toEqual([0, null]);
  }, 60000);
});

function lastFrame(run: Run): string {
  return completeFrames(run).at(-1) ?? '';
}

function send(run: Run, key: string): void {
  run.child.stdin?.write(key);
}

describe('route eligibility on a real terminal', () => {
  it('toggleWritesState: j then space writes claude false and tags its header; space again flips it back', async () => {
    const env = appEnv(fixtureDir(KIMI_EXITS));
    const statePath = String(env.DANDELION_STATE_FILE);
    const run = startLive(env);
    await waitWithin(run, () => settledIndex(run) >= 0, 20000, 'frame with no probing…');
    send(run, 'j');
    await waitWithin(run, () => lastFrame(run).includes('\n▸ claude\n'), 20000, 'selected claude');
    send(run, ' ');
    await waitWithin(run, () => lastFrame(run).includes(`\n▸ claude${' '.repeat(53)}routing off\n`), 20000, 'claude routing off tag');
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({ claude: false });
    send(run, ' ');
    await waitWithin(run, () => lastFrame(run).includes('\n▸ claude\n'), 20000, 'claude tag gone');
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({ claude: true });
    send(run, 'q');
    expect(await run.closed).toEqual([0, null]);
  }, 60000);
});

const SCREEN_ESCAPES = ['\x1b[?1049h', '\x1b[?25l', '\x1b[H', '\x1b[2J', '\x1b[?25h', '\x1b[?1049l'];

function splitRoute(line: string): string[] {
  if (line === 'none') return ['none', 'no subscription available'];
  return [line.slice(0, line.lastIndexOf(' ')), line.slice(line.lastIndexOf(' ') + 1)];
}

function boxText(frame: string, box: number): string[] {
  const rows = frame.split('\n').slice(2, 6);
  return [rows[1].slice(box * 37 + 2, box * 37 + 33).trimEnd(), rows[2].slice(box * 37 + 2, box * 37 + 33).trimEnd()];
}

async function cliLine(env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  const run = launch(process.execPath, [MAIN, ...args], env);
  await run.closed;
  return run.output.trimEnd();
}

describe('route boxes on a real terminal', () => {
  it('settledBoxesMatchTheCli: the settled boxes equal the route and route --high lines split, with only screen escapes', async () => {
    const env = appEnv(fixtureDir(KIMI_EXITS));
    const run = startLive(env);
    await waitWithin(run, () => settledIndex(run) >= 0, 20000, 'frame with no probing…');
    const frame = lastFrame(run);
    send(run, 'q');
    expect(await run.closed).toEqual([0, null]);
    expect(frame.split('\n')[2]).toBe('+- route -------------------------+  +- route --high ------------------+');
    expect(frame.split('\n')[5]).toBe('+---------------------------------+  +---------------------------------+');
    expect(boxText(frame, 0)).toEqual(splitRoute(await cliLine(env, ['route'])));
    expect(boxText(frame, 1)).toEqual(splitRoute(await cliLine(env, ['route', '--high'])));
    let stripped = run.output;
    for (const sequence of SCREEN_ESCAPES) stripped = stripped.split(sequence).join('');
    expect(stripped).not.toContain(String.fromCharCode(27));
  }, 60000);
});
