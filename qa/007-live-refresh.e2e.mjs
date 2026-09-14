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
const FRAME_BOUND_MS = 20000;
const REAP_BOUND_MS = 7000;
const PREFIX = 'allowance-qa-007-';
const ENTER = '\x1b[?1049h';
const CLEAR = '\x1b[H\x1b[2J';
const RESTORE = '\x1b[?25h\x1b[?1049l';
const IDS = ['claude', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];
const CLAUDE_FIXTURE = "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'\n";
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const CODEX_FIXTURE = "#!/bin/sh\necho 'Logged in using an API key - sk-proj-***n5zQA' >&2\n";
const KILO_FIXTURE = "#!/bin/sh\n[ \"$1\" = \"profile\" ] || exit 2\necho 'Balance: $14.15'\n";
const KIMI_EXITS = '#!/bin/sh\nexit 0\n';
const KIMI_STAYS = `#!/usr/bin/env node
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'kimi.pid'), String(process.pid));
setInterval(() => {}, 1000);
`;

const temps = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), PREFIX));
  temps.push(dir);
  return dir;
}

async function fixtureDir(kimi) {
  const dir = await tempDir();
  const scripts = { claude: CLAUDE_FIXTURE, agy: AGY_FIXTURE, kimi, codex: CODEX_FIXTURE, kilo: KILO_FIXTURE };
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

async function appEnv(pathDir, bin) {
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

function launch(command, args, env) {
  const child = spawn(command, args, { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  const run = { child, output: '', stderr: '', closed: once(child, 'close') };
  child.stdout.setEncoding('utf8').on('data', (chunk) => (run.output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (run.stderr += chunk));
  return run;
}

function startLive(env) {
  return launch('/usr/bin/script', ['-qfec', `'${NPM}' start --silent`, '/dev/null'], env);
}

function completeFrames(run) {
  return run.output.replaceAll('\r\n', '\n').split(CLEAR).slice(1, -1);
}

async function waitFor(run, predicate, boundMs, what) {
  const deadline = Date.now() + boundMs;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function pidWithin(run, pidFile, boundMs) {
  const deadline = Date.now() + boundMs;
  for (;;) {
    const pid = Number(await readFile(pidFile, 'utf8').catch(() => '0'));
    if (pid > 0) return pid;
    assert.ok(Date.now() < deadline, `no pid in ${pidFile}\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function assertExitZero(run) {
  const [code, signal] = await run.closed;
  assert.equal(signal, null, `killed by ${signal}, likely the outer timeout\noutput:\n${run.output}`);
  assert.equal(code, 0, `exit ${code}\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
}

function settledIndex(run) {
  return completeFrames(run).findIndex((frame) => !frame.includes('probing…'));
}

function refreshedAfterSettle(run) {
  const settled = settledIndex(run);
  return settled >= 0 && completeFrames(run).slice(settled + 1).some((frame) => frame.split('\n')[0].includes('refreshing…'));
}

async function liveFramesThenQuit(bin) {
  const run = startLive(await appEnv(await fixtureDir(KIMI_EXITS), bin));
  await waitFor(run, () => settledIndex(run) >= 0, FRAME_BOUND_MS, 'a frame with no probing…');
  await waitFor(run, () => refreshedAfterSettle(run), FRAME_BOUND_MS, 'a later frame whose banner has refreshing…');
  run.child.stdin.write('q');
  await assertExitZero(run);
  assert.ok(run.output.includes(ENTER), 'the alternate screen was never entered');
  assert.ok(run.output.lastIndexOf(RESTORE) > run.output.lastIndexOf(CLEAR), `no terminal restore after the last frame:\n${JSON.stringify(run.output.slice(-200))}`);
}

async function quitReapsKimi(bin) {
  const dir = await fixtureDir(KIMI_STAYS);
  const run = startLive(await appEnv(dir, bin));
  const pid = await pidWithin(run, join(dir, 'kimi.pid'), FRAME_BOUND_MS);
  const quitAt = Date.now();
  run.child.stdin.write('q');
  await assertExitZero(run);
  const elapsed = Date.now() - quitAt;
  assert.ok(elapsed < REAP_BOUND_MS, `quit took ${elapsed}ms`);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `kimi fixture pid ${pid} is still running`);
}

async function pipedRunsOnce(bin) {
  const run = launch(NPM, ['start', '--silent'], await appEnv(await fixtureDir(KIMI_EXITS), bin));
  try {
    await assertExitZero(run);
  } finally {
    run.child.stdin.destroy();
  }
  const lines = run.output.split('\n');
  assert.match(lines[0], /^ALLOWANCE +\d{2}:\d{2}:\d{2}Z$/, `not once-mode output:\n${run.output}`);
  assert.deepEqual(lines.filter((line) => IDS.includes(line)), IDS, `panels missing or out of order:\n${run.output}`);
  assert.equal(run.output.split('ALLOWANCE').length, 2, 'more than one dashboard was printed');
  assert.ok(!run.output.includes('probing…') && !run.output.includes(ENTER), `live output in once mode:\n${run.output}`);
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

async function noRuntimeDependencies() {
  const manifest = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies, undefined, 'package.json has a dependencies section');
}

export default async function () {
  await noRuntimeDependencies();
  try {
    const bin = await nodeBin();
    await liveFramesThenQuit(bin);
    await quitReapsKimi(bin);
    await pipedRunsOnce(bin);
    await assertNoQaProcessLeft();
  } finally {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
}
