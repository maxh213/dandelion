import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { mkdtemp, writeFile, chmod, rm, readFile, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_DIR = dirname(process.execPath);
const OUTER_TIMEOUT_MS = 60000;
const PREFIX = 'allowance-qa-005-';
const CLAUDE_FIXTURE = "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'\n";
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const KIMI_FIXTURE = '#!/bin/sh\nexit 0\n';
const KILO_FIXTURE = "#!/bin/sh\n[ \"$1\" = \"profile\" ] || exit 2\necho 'Balance: $14.15'\n";
const PANEL_ORDER = ['claude', 'agy', 'kimi', 'grok', 'codex', 'kilo'];
const FIVE_HOUR_ROW = /^5h {34}#{8}-{12} {2}42% ↻ (2h30m|2h29m)$/;
const WEEKLY_ROW = /^weekly {30}#{17}-{3} {2}86% ↻ (3d0h|2d23h)$/;

const CODEX_FIXTURE = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), dir = __dirname;
const mode = process.env.CODEX_FIXTURE_MODE, a = process.argv.slice(2).join(' ');
fs.appendFileSync(path.join(dir, 'codex.calls'), a + '\\n');
if (a === 'login status') {
  if (mode === 'apikeyout') console.log('Logged in using an API key - sk-proj-***n5zQA');
  else if (mode === 'apikey') console.error('Logged in using an API key - sk-proj-***n5zQA');
  else if (mode === 'notlogged') { console.error('Not logged in'); process.exit(1); }
  else console.error('Logged in using ChatGPT');
  process.exit(0);
}
if (a !== 'app-server') process.exit(2);
fs.writeFileSync(path.join(dir, 'codex.pid'), String(process.pid));
if (mode === 'crash') process.exit(3);
if (mode === 'stubborn') process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
const s = Math.floor(Date.now() / 1000), say = (o) => console.log(JSON.stringify(o));
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === 1) say({ id: 1, result: { userAgent: 'fixture' } });
  if (m.id !== 2 || mode === 'silent') return;
  say({ method: 'remoteControl/status/changed', params: { status: 'disabled' } });
  if (mode === 'rpcerror') return say({ error: { code: -32600, message: 'chatgpt authentication required to read rate limits' }, id: 2 });
  say({ id: 2, result: { rateLimits: { limitId: 'codex', planType: 'plus',
    primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: s + 9000 },
    secondary: { usedPercent: 86, windowDurationMins: 10080, resetsAt: s + 259200 } } } });
});
`;

const temps = [];

async function tempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

async function writeExecutable(dir, name, body) {
  await writeFile(join(dir, name), body);
  await chmod(join(dir, name), 0o755);
}

async function fixtureDir() {
  const dir = await tempDir(PREFIX);
  const scripts = { claude: CLAUDE_FIXTURE, agy: AGY_FIXTURE, kimi: KIMI_FIXTURE, codex: CODEX_FIXTURE, kilo: KILO_FIXTURE };
  for (const [name, body] of Object.entries(scripts)) await writeExecutable(dir, name, body);
  return dir;
}

async function nodeBin() {
  const dir = await tempDir('allowance-nodebin-');
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  return dir;
}

function startApp(pathDir, bin, grokHome, extraEnv) {
  const { NO_COLOR, ALLOWANCE_KILO_REFERENCE, ALLOWANCE_KIMI_PORT, ALLOWANCE_GROK_HOME, CODEX_FIXTURE_MODE, ...inherited } = process.env;
  const env = { ...inherited, PATH: `${pathDir}:${bin}`, ALLOWANCE_GROK_HOME: grokHome, ...extraEnv };
  const started = performance.now();
  const result = spawnSync(join(NODE_DIR, 'npm'), ['start', '--silent'], { cwd: rootDir, env, encoding: 'utf8', timeout: OUTER_TIMEOUT_MS });
  const elapsedMs = performance.now() - started;
  assert.equal(result.error, undefined, `spawn failed or hit the outer timeout: ${result.error}`);
  assert.equal(result.status, 0, `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { stdout: result.stdout, lines: result.stdout.split('\n'), elapsedMs };
}

async function runMode(bin, mode, { color = false } = {}) {
  const dir = await fixtureDir();
  const run = startApp(dir, bin, dir, { CODEX_FIXTURE_MODE: mode, ...(color ? {} : { NO_COLOR: '1' }) });
  return { ...run, dir };
}

function lineIndex(lines, pattern, from = 0) {
  const index = lines.findIndex((line, at) => at >= from && pattern.test(line));
  assert.ok(index >= 0, `no line matches ${pattern}:\n${lines.join('\n')}`);
  return index;
}

function assertPanelOrder(lines, stdout) {
  const starts = PANEL_ORDER.map((name) => lineIndex(lines, new RegExp(`^${name}$`)));
  assert.deepEqual([...starts].sort((a, b) => a - b), starts, `panels are not in the order ${PANEL_ORDER.join(', ')}:\n${stdout}`);
}

function assertCodexPanel(run, body) {
  const codex = lineIndex(run.lines, /^codex$/);
  assert.deepEqual(run.lines.slice(codex, codex + body.length + 2), ['codex', ...body, 'codex · codex'], `codex panel:\n${run.stdout}`);
  assertPanelOrder(run.lines, run.stdout);
}

async function codexCalls(dir) {
  return (await readFile(join(dir, 'codex.calls'), 'utf8')).split('\n').filter(Boolean);
}

async function appServerPid(dir) {
  return readFile(join(dir, 'codex.pid'), 'utf8').then(Number, () => undefined);
}

async function assertAppServerGone(dir) {
  const pid = await appServerPid(dir);
  assert.ok(pid > 0, `no pid in the codex pid file of ${dir}`);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `codex app-server pid ${pid} is still running`);
}

async function assertNoAppServer(dir) {
  assert.equal(await appServerPid(dir), undefined, 'codex app-server was started');
  assert.deepEqual(await codexCalls(dir), ['login status']);
}

async function chatGptShowsWindows(bin) {
  const run = await runMode(bin, 'chatgpt');
  const codex = lineIndex(run.lines, /^codex$/);
  assert.match(run.lines[codex + 1], FIVE_HOUR_ROW, `5h row:\n${run.stdout}`);
  assert.match(run.lines[codex + 2], WEEKLY_ROW, `weekly row:\n${run.stdout}`);
  assert.equal(run.lines[codex + 3], 'codex · codex');
  assertPanelOrder(run.lines, run.stdout);
  for (const line of run.lines) assert.ok([...line].length <= 72, `line over 72 columns: ${line}`);
  assert.deepEqual(await codexCalls(run.dir), ['login status', 'app-server']);
  await assertAppServerGone(run.dir);
  return run.elapsedMs;
}

async function chatGptColours(bin) {
  const run = await runMode(bin, 'chatgpt', { color: true });
  assert.ok(run.lines.some((line) => /^5h +\x1b\[32m█{8}░{12}\x1b\[0m \x1b\[32m 42%\x1b\[0m ↻ /.test(line)), `5h is not calm:\n${run.stdout}`);
  assert.ok(run.lines.some((line) => /^weekly +\x1b\[31m█{17}░{3}\x1b\[0m \x1b\[31m 86%\x1b\[0m ↻ /.test(line)), `weekly is not hot:\n${run.stdout}`);
  assert.ok(run.lines.includes('\x1b[90mcodex · codex\x1b[0m'), `codex caption is not dim:\n${run.stdout}`);
  await assertAppServerGone(run.dir);
}

async function apiKeyShowsCaption(bin, mode) {
  const run = await runMode(bin, mode);
  assertCodexPanel(run, ['api-key billing · no usage windows']);
  assert.doesNotMatch(run.lines.slice(lineIndex(run.lines, /^codex$/), lineIndex(run.lines, /^kilo$/)).join('\n'), /[#%]/, `api-key panel has a gauge:\n${run.stdout}`);
  await assertNoAppServer(run.dir);
}

async function failsDim(bin, mode, reason, { maxMs = 5000, minMs = 0 } = {}) {
  const run = await runMode(bin, mode);
  assertCodexPanel(run, [reason]);
  assert.ok(run.elapsedMs < maxMs && run.elapsedMs >= minMs, `${mode} took ${Math.round(run.elapsedMs)}ms, expected ${minMs}-${maxMs}ms`);
  return run;
}

async function stubbornIsKilled(bin, chatGptMs) {
  const run = await runMode(bin, 'stubborn');
  const codex = lineIndex(run.lines, /^codex$/);
  assert.match(run.lines[codex + 1], FIVE_HOUR_ROW, `5h row:\n${run.stdout}`);
  assert.match(run.lines[codex + 2], WEEKLY_ROW, `weekly row:\n${run.stdout}`);
  assert.ok(run.elapsedMs >= chatGptMs + 4000 && run.elapsedMs < chatGptMs + 10000, `stubborn took ${Math.round(run.elapsedMs)}ms against ${Math.round(chatGptMs)}ms for chatgpt`);
  await assertAppServerGone(run.dir);
}

async function noCliOnPath(bin) {
  const run = startApp(await tempDir(PREFIX), bin, await tempDir(PREFIX), { NO_COLOR: '1' });
  assertCodexPanel(run, ['codex CLI not found in PATH']);
}

async function noRuntimeDependencies() {
  const manifest = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies, undefined, 'package.json has a dependencies section');
}

export default async function () {
  await noRuntimeDependencies();
  try {
    const bin = await nodeBin();
    const chatGptMs = await chatGptShowsWindows(bin);
    await chatGptColours(bin);
    await apiKeyShowsCaption(bin, 'apikey');
    await apiKeyShowsCaption(bin, 'apikeyout');
    await assertAppServerGone((await failsDim(bin, 'rpcerror', 'chatgpt authentication required to read rate limits')).dir);
    await assertNoAppServer((await failsDim(bin, 'notlogged', 'codex is not logged in')).dir);
    await assertAppServerGone((await failsDim(bin, 'crash', 'codex app-server exited without answering')).dir);
    await assertAppServerGone((await failsDim(bin, 'silent', 'codex app-server did not answer within 30s', { minMs: 30000, maxMs: 40000 })).dir);
    await stubbornIsKilled(bin, chatGptMs);
    await noCliOnPath(bin);
  } finally {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
}
