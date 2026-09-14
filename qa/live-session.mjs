import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NPM = join(dirname(process.execPath), 'npm');
export const ENTER = '\x1b[?1049h';
export const CLEAR = '\x1b[H\x1b[2J';
export const RESTORE = '\x1b[?25h\x1b[?1049l';
export const IDS = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];
export const KIMI_EXITS = '#!/bin/sh\nexit 0\n';
export const OTHER_PANELS = [
  /\nclaude\nweekly +#+-* +86%( ↻ \S+)?\nclaude · personal · claude\n/,
  /\nclaude-work\nweekly +#+-* +86%( ↻ \S+)?\nclaude · work · claude-work\n/,
  /\nagy\nGemini Models · Weekly Limit +-+ +0%( ↻ \S+)?\nagy · agy\n/,
  /\nkimi\nkimi web exited without printing a token\nkimi code · kimi\n/,
  /\ngrok\nno grok billing snapshot — run grok once\ngrok · grok\n/,
  /\ncodex\napi-key billing · no usage windows\ncodex · codex\n/,
  /\ncursor\nno cursor auth — run cursor-agent login\ncursor · cursor\n/
];
const OUTER_TIMEOUT_MS = 60000;
const PREFIX = 'dandelion-qa-007-';
const CLAUDE_FIXTURE = "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'\n";
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const CODEX_FIXTURE = "#!/bin/sh\necho 'Logged in using an API key - sk-proj-***n5zQA' >&2\n";
const KILO_FIXTURE = "#!/bin/sh\n[ \"$1\" = \"profile\" ] || exit 2\necho 'Balance: $14.15'\n";

const temps = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), PREFIX));
  temps.push(dir);
  return dir;
}

export async function fixtureDir(kimi, kilo = KILO_FIXTURE) {
  const dir = await tempDir();
  const scripts = { claude: CLAUDE_FIXTURE, agy: AGY_FIXTURE, kimi, codex: CODEX_FIXTURE, kilo };
  for (const [name, body] of Object.entries(scripts)) {
    await writeFile(join(dir, name), body);
    await chmod(join(dir, name), 0o755);
  }
  return dir;
}

export async function appEnv(pathDir) {
  const bin = await tempDir();
  await symlink(process.execPath, join(bin, 'node'));
  await symlink('/bin/sh', join(bin, 'sh'));
  const grokHome = await tempDir();
  const workConfigDir = await tempDir();
  const { DANDELION_KILO_REFERENCE, DANDELION_KIMI_PORT, DANDELION_CURSOR_API_BASE, CLAUDE_CONFIG_DIR, ...inherited } = process.env;
  return {
    ...inherited,
    PATH: `${pathDir}:${bin}`,
    SHELL: '/bin/sh',
    NO_COLOR: '1',
    DANDELION_REFRESH_SECONDS: '1',
    DANDELION_GROK_HOME: grokHome,
    DANDELION_CURSOR_AUTH_FILE: join(grokHome, 'missing-auth.json'),
    DANDELION_CLAUDE_WORK_CONFIG_DIR: workConfigDir
  };
}

export function launch(command, args, env) {
  const child = spawn(command, args, { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  const run = { child, output: '', stderr: '', started: Date.now(), closed: once(child, 'close') };
  child.stdout.setEncoding('utf8').on('data', (chunk) => (run.output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (run.stderr += chunk));
  return run;
}

export function startLive(env) {
  return launch('/usr/bin/script', ['-qfec', `'${NPM}' start --silent`, '/dev/null'], env);
}

export function completeFrames(run) {
  return run.output.replaceAll('\r\n', '\n').split(CLEAR).slice(1, -1);
}

export async function waitWithin(run, predicate, boundMs, what) {
  while (!predicate()) {
    assert.ok(Date.now() - run.started < boundMs, `no ${what} within ${boundMs}ms\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function assertClosed(run, expected = [0, null]) {
  assert.deepEqual(await run.closed, expected, `unexpected exit\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

export async function cleanUp() {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  await assertNoQaProcessLeft();
  const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'package.json has runtime dependencies');
}

export async function inSession(check) {
  try {
    await check();
  } finally {
    await cleanUp();
  }
}
