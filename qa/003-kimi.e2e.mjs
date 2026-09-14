import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_DIR = dirname(process.execPath);
let nodeBinDir = '';
const OUTER_TIMEOUT_MS = 60000;
const NO_TOKEN_BOUND_MS = 30000;
const CLAUDE_FIXTURE = "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'\n";
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const KILO_FIXTURE = "#!/bin/sh\n[ \"$1\" = \"profile\" ] || exit 2\necho 'Balance: $14.15'\n";

const KIMI_OK = `#!/usr/bin/env node
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
fs.writeFileSync(path.join(__dirname, 'kimi.pid'), String(process.pid));
const a = process.argv.slice(2), port = Number(a[a.indexOf('--port') + 1]);
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

const KIMI_NO_TOKEN = `#!/usr/bin/env node
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'kimi.pid'), String(process.pid));
`;

async function writeExecutable(dir, name, body) {
  await writeFile(join(dir, name), body);
  await chmod(join(dir, name), 0o755);
}

async function fixtureDir(kimi) {
  const dir = await mkdtemp(join(tmpdir(), 'allowance-qa-003-'));
  const scripts = { claude: CLAUDE_FIXTURE, agy: AGY_FIXTURE, kimi, kilo: KILO_FIXTURE };
  for (const [name, body] of Object.entries(scripts)) await writeExecutable(dir, name, body);
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

async function runApp(dir) {
  const { NO_COLOR, ALLOWANCE_KILO_REFERENCE, ALLOWANCE_KIMI_PORT, ALLOWANCE_CURSOR_API_BASE, ...inherited } = process.env;
  const env = { ...inherited, PATH: `${dir}:${nodeBinDir}`, NO_COLOR: '1', ALLOWANCE_KIMI_PORT: String(await freePort()), ALLOWANCE_CURSOR_AUTH_FILE: join(dir, 'no-cursor-auth.json') };
  const started = Date.now();
  const result = spawnSync(join(NODE_DIR, 'npm'), ['start', '--silent', '--', '--once'], { cwd: rootDir, env, encoding: 'utf8', timeout: OUTER_TIMEOUT_MS });
  const elapsed = Date.now() - started;
  assert.equal(result.error, undefined, `spawn failed or hit the outer timeout: ${result.error}`);
  assert.equal(result.status, 0, `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { stdout: result.stdout, elapsed };
}

function lineIndex(lines, pattern) {
  const index = lines.findIndex((line) => pattern.test(line));
  assert.ok(index >= 0, `no line matches ${pattern}:\n${lines.join('\n')}`);
  return index;
}

function assertKimiBetweenAgyAndKilo(stdout) {
  const lines = stdout.split('\n');
  const claude = lineIndex(lines, /^claude$/);
  const agy = lineIndex(lines, /^agy$/);
  const kimi = lineIndex(lines, /^kimi$/);
  const kilo = lineIndex(lines, /^kilo$/);
  assert.ok(claude < agy && agy < kimi && kimi < kilo, `panels out of order:\n${stdout}`);
  return { lines, kimi, kilo };
}

async function assertKimiGone(dir) {
  const pid = Number(await readFile(join(dir, 'kimi.pid'), 'utf8'));
  assert.ok(pid > 0, `no pid in the kimi pid file of ${dir}`);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `kimi fixture pid ${pid} is still running`);
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes('allowance-qa'), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

async function kimiServesUsage() {
  const dir = await fixtureDir(KIMI_OK);
  try {
    const { stdout } = await runApp(dir);
    const { lines, kimi, kilo } = assertKimiBetweenAgyAndKilo(stdout);
    const weekly = lineIndex(lines, /^weekly {30}#{12}-{8} {2}59% ↻ (5d0h|4d23h)$/);
    const fiveHour = lineIndex(lines, /^5h {34}#{8}-{12} {2}42%$/);
    const caption = lines.indexOf('kimi code · kimi');
    assert.ok(kimi < weekly && weekly < fiveHour && fiveHour < caption && caption < kilo, `kimi rows not inside the kimi panel:\n${stdout}`);
    await assertKimiGone(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function kimiExitsWithoutToken() {
  const dir = await fixtureDir(KIMI_NO_TOKEN);
  try {
    const { stdout, elapsed } = await runApp(dir);
    assert.ok(elapsed < NO_TOKEN_BOUND_MS, `no-token run took ${elapsed}ms`);
    assertKimiBetweenAgyAndKilo(stdout);
    assert.ok(stdout.includes('\nkimi\nkimi web exited without printing a token\nkimi code · kimi\n'), `kimi panel is not unavailable:\n${stdout}`);
    await assertKimiGone(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function nodeBin() {
  const dir = await mkdtemp(join(tmpdir(), 'allowance-nodebin-'));
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  return dir;
}

export default async function () {
  nodeBinDir = await nodeBin();
  try {
    await kimiServesUsage();
    await kimiExitsWithoutToken();
    await assertNoQaProcessLeft();
  } finally {
    await rm(nodeBinDir, { recursive: true, force: true });
  }
}
