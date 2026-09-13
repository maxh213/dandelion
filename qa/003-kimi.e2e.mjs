import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_DIR = dirname(process.execPath);
const OUTER_TIMEOUT_MS = 40000;

const KIMI_FIXTURE = `#!/usr/bin/env node
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const dir = __dirname, mode = fs.readFileSync(path.join(dir, 'mode'), 'utf8').trim();
fs.writeFileSync(path.join(dir, 'kimi.pid'), String(process.pid));
const a = process.argv.slice(2), port = Number(a[a.indexOf('--port') + 1]);
if (a[0] !== 'web' || !a.includes('--no-open') || !port) process.exit(2);
if (mode === 'notoken') process.exit(0);
setInterval(() => {}, 1000);
const reset = new Date(Date.now() + 7205 * 60000).toISOString().replace(/\\.\\d{3}Z$/, 'Z');
const body = JSON.stringify({ data: { summary: { used: 590, limit: 1000, reset_at: reset },
  limits: [{ used: 42, limit: 100, window: { unit: 'hour', value: 5 } }] } });
http.createServer((req, res) => {
  const ok = req.headers.authorization === 'Bearer test-token' && req.url === '/api/v1/oauth/usage';
  res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
  res.end(ok ? body : '{}');
}).listen(port, '127.0.0.1', () => console.log('kimi web ready: http://127.0.0.1:' + port + '/?token=test-token'));
`;

const SHELL_FIXTURES = {
  claude: "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used'\n",
  agy: "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t40%%\\t2030-01-01T00:00:00Z\\n'\n",
  kilo: "#!/bin/sh\necho 'Balance: $14.15'\n",
};

async function writeExecutable(dir, name, body) {
  await writeFile(join(dir, name), body);
  await chmod(join(dir, name), 0o755);
}

async function fixtureDir(mode) {
  const dir = await mkdtemp(join(tmpdir(), 'allowance-qa-003-'));
  for (const [name, body] of Object.entries({ ...SHELL_FIXTURES, kimi: KIMI_FIXTURE })) {
    await writeExecutable(dir, name, body);
  }
  await writeFile(join(dir, 'mode'), mode);
  return dir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function runApp(dir) {
  const { NO_COLOR, ALLOWANCE_KILO_REFERENCE, ALLOWANCE_KIMI_PORT, ...inherited } = process.env;
  const env = { ...inherited, PATH: `${dir}:${NODE_DIR}`, NO_COLOR: '1', ALLOWANCE_KIMI_PORT: String(await freePort()) };
  const started = Date.now();
  const result = spawnSync('npm', ['start'], { cwd: rootDir, env, encoding: 'utf8', timeout: OUTER_TIMEOUT_MS });
  assert.equal(result.error, undefined, `spawn failed or hit the outer timeout: ${result.error}`);
  assert.equal(result.status, 0, `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { stdout: result.stdout, elapsedMs: Date.now() - started };
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function assertFixtureGone(dir) {
  const pid = Number(await readFile(join(dir, 'kimi.pid'), 'utf8'));
  assert.ok(pid > 0, 'fixture pid file is empty');
  assert.equal(isRunning(pid), false, `kimi fixture ${pid} is still running`);
}

async function commandLinesContaining(marker) {
  const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
  const lines = await Promise.all(pids.map((pid) => readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')));
  return lines.filter((line) => line.includes(marker));
}

function panelLines(stdout) {
  const lines = stdout.split('\n');
  const kimi = lines.indexOf('kimi');
  assert.ok(lines.indexOf('agy') < kimi && kimi < lines.indexOf('kilo'), `kimi panel not between agy and kilo:\n${stdout}`);
  return lines.slice(kimi, lines.indexOf('kimi code · kimi') + 1);
}

async function servesKimiWindows() {
  const dir = await fixtureDir('ok');
  try {
    const { stdout } = await runApp(dir);
    const panel = panelLines(stdout);
    assert.match(panel[1], /^weekly {30}#{12}-{8} {2}59% ↻ (5d0h|4d23h)$/, `weekly row:\n${stdout}`);
    assert.equal(panel[2], `5h${' '.repeat(34)}${'#'.repeat(8)}${'-'.repeat(12)}  42%`, `5h row:\n${stdout}`);
    await assertFixtureGone(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function exitsWithoutToken() {
  const dir = await fixtureDir('notoken');
  try {
    const { stdout, elapsedMs } = await runApp(dir);
    assert.ok(elapsedMs < OUTER_TIMEOUT_MS, `took ${elapsedMs}ms`);
    assert.deepEqual(panelLines(stdout), ['kimi', 'kimi web exited without printing a token', 'kimi code · kimi']);
    await assertFixtureGone(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export default async function () {
  await servesKimiWindows();
  await exitsWithoutToken();
  assert.deepEqual(await commandLinesContaining(join(tmpdir(), 'allowance-qa')), [], 'an allowance-qa process is still running');
  const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'package.json gained runtime dependencies');
}
