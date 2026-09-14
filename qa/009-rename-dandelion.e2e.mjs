import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, readdir, stat, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { rootDir, NPM, startLive, completeFrames, waitWithin, assertClosed } from './live-session.mjs';

const PREFIX = 'dandelion-qa-009-';
const OUTER_TIMEOUT_MS = 60000;
const IDS = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];
const NO_WORK_CONFIG = 'no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude';
const NO_GROK = 'no grok billing snapshot — run grok once';
const NO_CURSOR = 'no cursor auth — run cursor-agent login';
const BAD_PORT = 'DANDELION_KIMI_PORT must be an integer from 1 to 65535';
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const CODEX_FIXTURE = "#!/bin/sh\necho 'Logged in using an API key - sk-proj-***n5zQA' >&2\n";
const KIMI_EXITS = '#!/bin/sh\nexit 0\n';

const KIMI_OK = `#!/usr/bin/env node
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const a = process.argv.slice(2), port = Number(a[a.indexOf('--port') + 1]);
fs.writeFileSync(path.join(__dirname, 'kimi.args'), a.join(' '));
if (a[0] !== 'web' || !a.includes('--no-open') || !port) process.exit(2);
const reset = new Date(Date.now() + 7205 * 60000).toISOString().replace(/\\.\\d{3}Z$/, 'Z');
const body = JSON.stringify({ data: {
  summary: { used: 590, limit: 1000, reset_at: reset },
  limits: [{ used: 42, limit: 100, window: { unit: 'hour', value: 5 } }],
} });
http.createServer((req, res) => {
  const ok = req.headers.authorization === 'Bearer test-token' && req.url === '/api/v1/oauth/usage';
  res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
  res.end(ok ? body : '{}');
}).listen(port, '127.0.0.1', () => console.log('kimi web ready: http://127.0.0.1:' + port + '/?token=test-token'));
`;

const temps = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), PREFIX));
  temps.push(dir);
  return dir;
}

function claudeFixture(dir) {
  return [
    '#!/bin/sh',
    `echo "\${CLAUDE_CONFIG_DIR:--}" >> '${join(dir, 'claude.calls')}'`,
    "printf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'",
    ''
  ].join('\n');
}

function kiloFixture(balance) {
  return `#!/bin/sh\n[ "$1" = "profile" ] || exit 2\necho 'Balance: $${balance}'\n`;
}

async function fixtureDir({ kimi = KIMI_EXITS, balance = '14.15' } = {}) {
  const dir = await tempDir();
  const scripts = { claude: claudeFixture(dir), agy: AGY_FIXTURE, kimi, codex: CODEX_FIXTURE, kilo: kiloFixture(balance) };
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

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.on('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function assertKimiOnDefaultPort(kimi, defaultPortFree) {
  assert.notEqual(kimi[1], BAD_PORT);
  if (!defaultPortFree) {
    console.log('  note: port 59177 is busy, so the 003 kimi rows are not checked; --port 59177 is');
    return;
  }
  assert.match(kimi[1], /^weekly +#+-+ +59%/);
  assert.match(kimi[2], /^5h +#+-+ +42%$/);
}

function cleanEnv() {
  const drop = (name) => /^(DANDELION|ALLOWANCE)_/.test(name) || ['NO_COLOR', 'CLAUDE_CONFIG_DIR', 'CODEX_FIXTURE_MODE'].includes(name);
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !drop(name)));
}

async function exec(command, args, env) {
  const child = spawn(command, args, { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const [status] = await once(child, 'close');
  assert.equal(status, 0, `${command} ${args.join(' ')} exited ${status}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  return { stdout, lines: stdout.split('\n') };
}

function panel(run, name) {
  const starts = IDS.map((id) => run.lines.indexOf(id));
  assert.ok(starts.every((at) => at >= 0), `a panel is missing:\n${run.stdout}`);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts, `panels are not in the order ${IDS.join(', ')}:\n${run.stdout}`);
  const at = IDS.indexOf(name);
  const end = at + 1 < IDS.length ? starts[at + 1] - 1 : run.lines.length;
  return run.lines.slice(starts[at], end).filter((line) => line !== '');
}

function assertDandelionDashboard(run) {
  assert.match(run.lines[0], /^DANDELION +\d{2}:\d{2}:\d{2}Z$/);
  assert.equal([...run.lines[0]].length, 72, `banner width: ${JSON.stringify(run.lines[0])}`);
  panel(run, 'kilo');
  assert.ok(!/allowance/i.test(run.stdout), `old name in output:\n${run.stdout}`);
}

function comparable(run) {
  return run.lines.slice(1).map((line) => line.replace(/ ↻ \S+$/, '')).join('\n');
}

async function assertManifest() {
  const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dandelion');
  assert.deepEqual(pkg.bin, { dandelion: 'src/main.ts' });
  assert.equal(pkg.dependencies, undefined, 'package.json has runtime dependencies');
  const main = join(rootDir, 'src', 'main.ts');
  assert.equal((await readFile(main, 'utf8')).split('\n')[0], '#!/usr/bin/env node');
  assert.ok(((await stat(main)).mode & 0o111) !== 0, 'src/main.ts is not executable');
}

async function everyEntryRunsTheDashboard(bin) {
  const dir = await fixtureDir();
  const binDir = await tempDir();
  await symlink(join(rootDir, 'src', 'main.ts'), join(binDir, 'dandelion'));
  const env = {
    ...cleanEnv(),
    PATH: `${binDir}:${dir}:${bin}`,
    NO_COLOR: '1',
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_GROK_HOME: await tempDir(),
    DANDELION_CURSOR_AUTH_FILE: join(dir, 'missing-auth.json'),
    DANDELION_CLAUDE_WORK_CONFIG_DIR: await tempDir()
  };
  const npm = await exec(NPM, ['start', '--silent', '--', '--once'], env);
  assertDandelionDashboard(npm);
  assert.ok(npm.lines.every((line) => [...line].length <= 72), `a line is over 72 columns:\n${npm.stdout}`);
  const others = [
    await exec(process.execPath, ['src/main.ts', '--once'], env),
    await exec('dandelion', ['--once'], env),
    await exec('./src/main.ts', ['--once'], env)
  ];
  for (const run of others) {
    assertDandelionDashboard(run);
    assert.equal(comparable(run), comparable(npm));
  }
}

async function newNamesWork(bin) {
  const dir = await fixtureDir({ kimi: KIMI_OK, balance: '5.00' });
  const env = {
    ...cleanEnv(),
    PATH: `${dir}:${bin}`,
    NO_COLOR: '1',
    DANDELION_KILO_REFERENCE: '10',
    DANDELION_KIMI_PORT: 'abc',
    DANDELION_GROK_HOME: await tempDir(),
    DANDELION_CURSOR_AUTH_FILE: join(dir, 'missing-auth.json'),
    DANDELION_CLAUDE_WORK_CONFIG_DIR: join(dir, 'no-such-dir')
  };
  const run = await exec(NPM, ['start', '--silent', '--', '--once'], env);
  assertDandelionDashboard(run);
  assert.match(panel(run, 'kilo')[1], /^\$5\.00 #{10}-{10} /);
  assert.equal(panel(run, 'kimi')[1], BAD_PORT);
  await assert.rejects(readFile(join(dir, 'kimi.args')), 'kimi was started');
  assert.equal(panel(run, 'grok')[1], NO_GROK);
  assert.equal(panel(run, 'cursor')[1], NO_CURSOR);
  assert.equal(panel(run, 'claude-work')[1], NO_WORK_CONFIG);
}

function grokSnapshot() {
  return JSON.stringify({
    ts: new Date(Date.now() - 3600 * 1000).toISOString(),
    msg: 'billing: fetched credits config',
    ctx: {
      config: { creditUsagePercent: 75.0, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T21:15:36Z', end: '2026-09-13T21:15:36Z' } },
      subscriptionTier: 'SuperGrok Heavy'
    }
  }) + '\n';
}

async function cursorFixture() {
  const server = createHttpServer((req, res) => {
    server.requests += 1;
    res.writeHead(401).end('{}');
  });
  server.requests = 0;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function oldNamesAreIgnored(bin) {
  const dir = await fixtureDir({ kimi: KIMI_OK, balance: '5.00' });
  const grokHome = await tempDir();
  await mkdir(join(grokHome, 'logs'));
  await writeFile(join(grokHome, 'logs', 'unified.jsonl'), grokSnapshot());
  const authFile = join(dir, 'auth.json');
  await writeFile(authFile, JSON.stringify({ accessToken: 'qa-dummy-cursor-token' }));
  const cursor = await cursorFixture();
  const defaultPortFree = await portFree(59177);
  try {
    const env = {
      ...cleanEnv(),
      HOME: await tempDir(),
      PATH: `${dir}:${bin}`,
      NO_COLOR: '1',
      DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${cursor.address().port}`,
      ALLOWANCE_KILO_REFERENCE: '10',
      ALLOWANCE_KIMI_PORT: 'abc',
      ALLOWANCE_GROK_HOME: grokHome,
      ALLOWANCE_CURSOR_AUTH_FILE: authFile,
      ALLOWANCE_CLAUDE_WORK_CONFIG_DIR: await tempDir()
    };
    const run = await exec(NPM, ['start', '--silent', '--', '--once'], env);
    assertDandelionDashboard(run);
    assert.match(panel(run, 'kilo')[1], /^\$5\.00 #{5}-{15} /);
    assert.match(await readFile(join(dir, 'kimi.args'), 'utf8'), /--port 59177\b/);
    assertKimiOnDefaultPort(panel(run, 'kimi'), defaultPortFree);
    assert.equal(panel(run, 'grok')[1], NO_GROK);
    assert.equal(panel(run, 'cursor')[1], NO_CURSOR);
    assert.equal(cursor.requests, 0, 'the cursor fixture received a request');
    assert.equal(panel(run, 'claude-work')[1], NO_WORK_CONFIG);
    assert.deepEqual((await readFile(join(dir, 'claude.calls'), 'utf8')).split('\n').filter(Boolean), ['-']);
  } finally {
    cursor.close();
  }
}

async function liveIgnoresOldRefreshName(bin) {
  const dir = await fixtureDir();
  const env = {
    ...cleanEnv(),
    PATH: `${dir}:${bin}`,
    SHELL: '/bin/sh',
    NO_COLOR: '1',
    ALLOWANCE_REFRESH_SECONDS: '1',
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_GROK_HOME: await tempDir(),
    DANDELION_CURSOR_AUTH_FILE: join(dir, 'missing-auth.json'),
    DANDELION_CLAUDE_WORK_CONFIG_DIR: await tempDir()
  };
  const run = startLive(env);
  const settled = () => completeFrames(run).some((frame) => !frame.includes('probing…'));
  await waitWithin(run, settled, 20000, 'frame with no probing…');
  await new Promise((resolve) => setTimeout(resolve, 5000));
  run.child.stdin.write('q');
  await assertClosed(run);
  assert.match(completeFrames(run)[0], /^DANDELION /);
  assert.ok(!run.output.includes('refreshing…'), `refreshed with the old name:\n${run.output}`);
  assert.equal((await readFile(join(dir, 'claude.calls'), 'utf8')).split('\n').filter(Boolean).length, 2, 'claude calls');
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

export default async function () {
  await assertManifest();
  try {
    const bin = await nodeBin();
    await everyEntryRunsTheDashboard(bin);
    await newNamesWork(bin);
    await oldNamesAreIgnored(bin);
    await liveIgnoresOldRefreshName(bin);
  } finally {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
