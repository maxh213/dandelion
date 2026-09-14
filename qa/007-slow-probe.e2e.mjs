import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const NPM = join(dirname(process.execPath), 'npm');
const OUTER_TIMEOUT_MS = 60000;
const OTHERS_BOUND_MS = 5000;
const TIMEOUT_BOUND_MS = 30000;
const PREFIX = 'allowance-qa-007-';
const CLEAR = '\x1b[H\x1b[2J';
const CLAUDE_FIXTURE = "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'\n";
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const KIMI_FIXTURE = '#!/bin/sh\nexit 0\n';
const CODEX_FIXTURE = "#!/bin/sh\necho 'Logged in using an API key - sk-proj-***n5zQA' >&2\n";
const SLOW_KILO = '#!/usr/bin/env node\nsetTimeout(() => console.log("Balance: $14.15"), 60000);\n';
const OTHER_PANELS = [
  /\nclaude\nweekly +#+-* +86%( ↻ \S+)?\nclaude code · claude\n/,
  /\nagy\nGemini Models · Weekly Limit +-+ +0%( ↻ \S+)?\nagy · agy\n/,
  /\nkimi\nkimi web exited without printing a token\nkimi code · kimi\n/,
  /\ngrok\nno grok billing snapshot — run grok once\ngrok · grok\n/,
  /\ncodex\napi-key billing · no usage windows\ncodex · codex\n/,
  /\ncursor\nno cursor auth — run cursor-agent login\ncursor · cursor\n/
];
const KILO_PENDING = /\nkilo\n\S probing…$/;
const KILO_TIMED_OUT = '\nkilo\nCommand timed out after 20s\napi balance · kilo';

const temps = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), PREFIX));
  temps.push(dir);
  return dir;
}

async function fixtureDir() {
  const dir = await tempDir();
  const scripts = { claude: CLAUDE_FIXTURE, agy: AGY_FIXTURE, kimi: KIMI_FIXTURE, codex: CODEX_FIXTURE, kilo: SLOW_KILO };
  for (const [name, body] of Object.entries(scripts)) {
    await writeFile(join(dir, name), body);
    await chmod(join(dir, name), 0o755);
  }
  return dir;
}

async function nodeBin() {
  const dir = await tempDir();
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  return dir;
}

async function appEnv() {
  const pathDir = await fixtureDir();
  const bin = await nodeBin();
  const grokHome = await tempDir();
  const { ALLOWANCE_KILO_REFERENCE, ALLOWANCE_KIMI_PORT, ALLOWANCE_CURSOR_API_BASE, ...inherited } = process.env;
  return {
    ...inherited,
    PATH: `${pathDir}:${bin}`,
    SHELL: '/bin/sh',
    NO_COLOR: '1',
    ALLOWANCE_REFRESH_SECONDS: '1',
    ALLOWANCE_GROK_HOME: grokHome,
    ALLOWANCE_CURSOR_AUTH_FILE: join(grokHome, 'missing-auth.json')
  };
}

function startLive(env) {
  const child = spawn('/usr/bin/script', ['-qfec', `'${NPM}' start --silent`, '/dev/null'], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  const run = { child, output: '', stderr: '', started: Date.now(), closed: once(child, 'close') };
  child.stdout.setEncoding('utf8').on('data', (chunk) => (run.output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (run.stderr += chunk));
  return run;
}

function completeFrames(run) {
  return run.output.replaceAll('\r\n', '\n').split(CLEAR).slice(1, -1);
}

async function waitWithin(run, predicate, boundMs, what) {
  while (!predicate()) {
    const elapsed = Date.now() - run.started;
    assert.ok(elapsed < boundMs, `no ${what} within ${boundMs}ms\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function othersDoneKiloPending(frame) {
  return OTHER_PANELS.every((panel) => panel.test(frame)) && KILO_PENDING.test(frame);
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

async function hangingKiloNeverDelaysTheOthers() {
  const run = startLive(await appEnv());
  await waitWithin(run, () => completeFrames(run).some(othersDoneKiloPending), OTHERS_BOUND_MS, 'frame with six settled panels and a pending kilo');
  await waitWithin(run, () => completeFrames(run).some((frame) => frame.includes(KILO_TIMED_OUT)), TIMEOUT_BOUND_MS, 'kilo timeout reason');
  run.child.stdin.write('q');
  const [code, signal] = await run.closed;
  assert.equal(signal, null, `killed by ${signal}, likely the outer timeout\noutput:\n${run.output}`);
  assert.equal(code, 0, `exit ${code}\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
}

async function noRuntimeDependencies() {
  const manifest = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies, undefined, 'package.json has a dependencies section');
}

export default async function () {
  await noRuntimeDependencies();
  try {
    await hangingKiloNeverDelaysTheOthers();
    await assertNoQaProcessLeft();
  } finally {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
}
