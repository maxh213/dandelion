import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, chmod, rm, readFile, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_DIR = dirname(process.execPath);
const OUTER_TIMEOUT_MS = 60000;
const PREFIX = 'dandelion-qa-006-';
const TOKEN = 'qa-dummy-cursor-token-006';
const AUTH = JSON.stringify({ accessToken: TOKEN, refreshToken: 'qa-dummy-refresh-006' });
const USAGE_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const PLAN_PATH = '/aiserver.v1.DashboardService/GetPlanInfo';
const NO_AUTH = 'no cursor auth — run cursor-agent login';
const CLAUDE_FIXTURE = "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'\n";
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const KIMI_FIXTURE = '#!/bin/sh\nexit 0\n';
const CODEX_FIXTURE = "#!/bin/sh\necho 'Logged in using an API key - sk-proj-***n5zQA' >&2\n";
const KILO_FIXTURE = "#!/bin/sh\n[ \"$1\" = \"profile\" ] || exit 2\necho 'Balance: $14.15'\n";

const temps = [];

async function tempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

async function fixtureDir() {
  const dir = await tempDir(PREFIX);
  const scripts = { claude: CLAUDE_FIXTURE, agy: AGY_FIXTURE, kimi: KIMI_FIXTURE, codex: CODEX_FIXTURE, kilo: KILO_FIXTURE };
  for (const [name, body] of Object.entries(scripts)) {
    await writeFile(join(dir, name), body);
    await chmod(join(dir, name), 0o755);
  }
  return dir;
}

async function nodeBin() {
  const dir = await tempDir(PREFIX);
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  return dir;
}

async function startFixture(cycleEnd) {
  const requests = [];
  const usage = { billingCycleStart: '1788108306000', billingCycleEnd: cycleEnd,
    planUsage: { totalSpend: 101050, includedSpend: 40000, limit: 40000, autoPercentUsed: 32.36, apiPercentUsed: 15.81, totalPercentUsed: 31.09 } };
  const plan = { planInfo: { planName: 'Ultra', includedAmountCents: 40000, price: '$200/mo', billingCycleEnd: cycleEnd } };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, contentType: req.headers['content-type'], body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url === PLAN_PATH ? plan : usage));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, requests, base: `http://127.0.0.1:${server.address().port}` };
}

async function runApp(pathDir, bin, grokHome, base, authFile) {
  const { DANDELION_KILO_REFERENCE, DANDELION_KIMI_PORT, DANDELION_GROK_HOME, DANDELION_CURSOR_AUTH_FILE, DANDELION_CURSOR_API_BASE, CLAUDE_CONFIG_DIR, ...inherited } = process.env;
  const env = { ...inherited, PATH: `${pathDir}:${bin}`, NO_COLOR: '1', DANDELION_GROK_HOME: grokHome, DANDELION_CURSOR_API_BASE: base, DANDELION_CURSOR_AUTH_FILE: authFile, DANDELION_CLAUDE_WORK_CONFIG_DIR: await tempDir(PREFIX), DANDELION_STATE_FILE: join(grokHome, 'no-state', 'eligibility.json') };
  const child = spawn(join(NODE_DIR, 'npm'), ['start', '--silent', '--', '--once'], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const [code, signal] = await once(child, 'close');
  assert.equal(signal, null, `killed by ${signal}, likely the outer timeout\nstdout:\n${stdout}`);
  assert.equal(code, 0, `exit ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.ok(!stdout.includes(TOKEN) && !stderr.includes(TOKEN), 'the cursor token was printed');
  return { stdout, lines: stdout.split('\n') };
}

function lineIndex(lines, pattern) {
  const index = lines.findIndex((line) => pattern.test(line));
  assert.ok(index >= 0, `no line matches ${pattern}:\n${lines.join('\n')}`);
  return index;
}

function assertBetweenCodexAndKilo(run) {
  const codex = lineIndex(run.lines, /^codex$/);
  const cursor = lineIndex(run.lines, /^cursor$/);
  const kilo = lineIndex(run.lines, /^kilo$/);
  assert.ok(codex < cursor && cursor < kilo, `cursor panel is not between codex and kilo:\n${run.stdout}`);
  return { cursor, kilo };
}

function assertTwoPosts(requests) {
  const sorted = [...requests].sort((a, b) => a.url.localeCompare(b.url));
  const expected = (url) => ({ method: 'POST', url, authorization: `Bearer ${TOKEN}`, contentType: 'application/json', body: '{}' });
  assert.deepEqual(sorted, [expected(USAGE_PATH), expected(PLAN_PATH)], `fixture requests: ${JSON.stringify(requests)}`);
}

async function cursorShowsPlan(pathDir, bin, fixture) {
  const home = await tempDir(PREFIX);
  const authFile = join(home, 'auth.json');
  await writeFile(authFile, AUTH);
  const run = await runApp(pathDir, bin, home, fixture.base, authFile);
  const { cursor, kilo } = assertBetweenCodexAndKilo(run);
  const total = lineIndex(run.lines, /^total +#+-* +31% ↻ /);
  const caption = run.lines.indexOf('Ultra · $200/mo · cursor');
  assert.ok(cursor < total && total < caption && caption < kilo, `cursor rows not inside the cursor panel:\n${run.stdout}`);
  assertTwoPosts(fixture.requests);
  assert.equal(await readFile(authFile, 'utf8'), AUTH, 'the auth file changed');
}

async function cursorWithoutAuth(pathDir, bin, fixture) {
  fixture.requests.length = 0;
  const home = await tempDir(PREFIX);
  const run = await runApp(pathDir, bin, home, fixture.base, join(home, 'missing.json'));
  const { cursor } = assertBetweenCodexAndKilo(run);
  assert.deepEqual(run.lines.slice(cursor, cursor + 3), ['cursor', NO_AUTH, 'cursor · cursor'], `cursor panel is not unavailable:\n${run.stdout}`);
  assert.deepEqual(fixture.requests, [], 'the fixture received a request without auth');
}

async function noRuntimeDependencies() {
  const manifest = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies, undefined, 'package.json has a dependencies section');
}

export default async function () {
  await noRuntimeDependencies();
  const fixture = await startFixture(String(Date.now() + 3 * 86400000));
  try {
    const pathDir = await fixtureDir();
    const bin = await nodeBin();
    await cursorShowsPlan(pathDir, bin, fixture);
    await cursorWithoutAuth(pathDir, bin, fixture);
  } finally {
    fixture.server.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
}
