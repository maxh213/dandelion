import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
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

const CODEX_FIXTURE = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), dir = __dirname;
const mode = process.env.CODEX_FIXTURE_MODE, a = process.argv.slice(2).join(' ');
fs.appendFileSync(path.join(dir, 'codex.calls'), a + '\\n');
if (a === 'login status') {
  if (mode === 'apikey') console.error('Logged in using an API key - sk-proj-***n5zQA');
  else console.error('Logged in using ChatGPT');
  process.exit(0);
}
if (a !== 'app-server') process.exit(2);
fs.writeFileSync(path.join(dir, 'codex.pid'), String(process.pid));
setInterval(() => {}, 1000);
const s = Math.floor(Date.now() / 1000), say = (o) => console.log(JSON.stringify(o));
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === 1) say({ id: 1, result: { userAgent: 'fixture' } });
  if (m.id !== 2) return;
  say({ method: 'remoteControl/status/changed', params: { status: 'disabled' } });
  say({ id: 2, result: { rateLimits: { limitId: 'codex', planType: 'plus',
    primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: s + 9000 },
    secondary: { usedPercent: 86, windowDurationMins: 10080, resetsAt: s + 259200 } } } });
});
`;

async function writeExecutable(dir, name, body) {
  await writeFile(join(dir, name), body);
  await chmod(join(dir, name), 0o755);
}

async function fixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), PREFIX));
  const scripts = { claude: CLAUDE_FIXTURE, agy: AGY_FIXTURE, kimi: KIMI_FIXTURE, codex: CODEX_FIXTURE, kilo: KILO_FIXTURE };
  for (const [name, body] of Object.entries(scripts)) await writeExecutable(dir, name, body);
  return dir;
}

async function nodeBin() {
  const dir = await mkdtemp(join(tmpdir(), 'allowance-nodebin-'));
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  return dir;
}

async function runApp(dir, bin, mode) {
  await rm(join(dir, 'codex.calls'), { force: true });
  await rm(join(dir, 'codex.pid'), { force: true });
  const { NO_COLOR, ALLOWANCE_KILO_REFERENCE, ALLOWANCE_KIMI_PORT, ALLOWANCE_GROK_HOME, ...inherited } = process.env;
  const env = { ...inherited, PATH: `${dir}:${bin}`, NO_COLOR: '1', ALLOWANCE_GROK_HOME: dir, CODEX_FIXTURE_MODE: mode };
  const result = spawnSync(join(NODE_DIR, 'npm'), ['start', '--silent'], { cwd: rootDir, env, encoding: 'utf8', timeout: OUTER_TIMEOUT_MS });
  assert.equal(result.error, undefined, `spawn failed or hit the outer timeout: ${result.error}`);
  assert.equal(result.status, 0, `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result.stdout;
}

function lineIndex(lines, pattern, from = 0) {
  const index = lines.findIndex((line, at) => at >= from && pattern.test(line));
  assert.ok(index >= 0, `no line matches ${pattern}:\n${lines.join('\n')}`);
  return index;
}

async function codexCalls(dir) {
  return (await readFile(join(dir, 'codex.calls'), 'utf8')).split('\n').filter(Boolean);
}

async function apiKeyShowsCaption(dir, bin) {
  const stdout = await runApp(dir, bin, 'apikey');
  const lines = stdout.split('\n');
  const grok = lineIndex(lines, /^grok$/);
  const codex = lineIndex(lines, /^codex$/);
  const kilo = lineIndex(lines, /^kilo$/);
  assert.deepEqual(lines.slice(codex, codex + 3), ['codex', 'api-key billing · no usage windows', 'codex · codex'], `api-key codex panel:\n${stdout}`);
  assert.ok(grok < codex && codex < kilo, `codex panel is not between grok and kilo:\n${stdout}`);
  assert.deepEqual(await codexCalls(dir), ['login status'], 'codex app-server was started in API-key mode');
}

async function assertAppServerGone(dir) {
  const pid = Number(await readFile(join(dir, 'codex.pid'), 'utf8'));
  assert.ok(pid > 0, `no pid in the codex pid file of ${dir}`);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `codex app-server pid ${pid} is still running`);
}

async function chatGptShowsWindows(dir, bin) {
  const stdout = await runApp(dir, bin, 'chatgpt');
  const lines = stdout.split('\n');
  const codex = lineIndex(lines, /^codex$/);
  const fiveHour = lineIndex(lines, /^5h {34}#{8}-{12} {2}42% ↻ /, codex);
  const weekly = lineIndex(lines, /^weekly {30}#{17}-{3} {2}86% ↻ /, codex);
  const caption = lines.indexOf('codex · codex');
  assert.ok(codex < fiveHour && fiveHour < weekly && weekly < caption && caption < lineIndex(lines, /^kilo$/), `codex rows not inside the codex panel:\n${stdout}`);
  assert.deepEqual(await codexCalls(dir), ['login status', 'app-server']);
  await assertAppServerGone(dir);
}

async function noRuntimeDependencies() {
  const manifest = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies, undefined, 'package.json has a dependencies section');
}

export default async function () {
  await noRuntimeDependencies();
  const dir = await fixtureDir();
  const bin = await nodeBin();
  try {
    await apiKeyShowsCaption(dir, bin);
    await chatGptShowsWindows(dir, bin);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
}
