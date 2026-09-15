import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, readdir, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'dandelion-qa-012-';
const OUTER_TIMEOUT_MS = 60000;
const HOUR_MS = 3600000;

const FIXTURE = `#!/usr/bin/env node
const http = require('node:http'), path = require('node:path');
const me = path.basename(process.argv[1]), a = process.argv.slice(2);
const q = (n) => process.env[n] && process.env[n].split(',');
const at = (h) => new Date(Date.now() + h * 3600000), iso = (h) => at(h).toISOString();
const M = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const txt = (h) => { const d = at(h), H = d.getUTCHours(); return M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + (H % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0') + (H < 12 ? 'am' : 'pm') + ' (UTC)'; };
if (me === 'codex') { console.error('Logged in using an API key - sk-proj-***n5zQA'); process.exit(0); }
if (me === 'kilo') { console.log('Balance: $14.15'); process.exit(0); }
if (me === 'claude') { const work = Boolean(process.env.CLAUDE_CONFIG_DIR), h = q(work ? 'H_WORK' : 'H_CLAUDE'), v = h ? [h[0], h[1], 72] : q(work ? 'Q_WORK' : 'Q_CLAUDE'); if (!v) process.exit(1);
  const fable = h && h[2] !== '-' ? '\\nCurrent week (Fable): ' + h[2] + '% used · resets ' + txt(72) : '';
  console.log('Current session: ' + v[0] + '% used · resets ' + txt(4) + '\\nCurrent week (all models): ' + v[1] + '% used · resets ' + txt(Number(v[2])) + fable); process.exit(0); }
if (me === 'agy') { const v = q('Q_AGY'); if (!v) process.exit(1);
  console.log('Gemini Models\\tFive Hour Limit Remaining\\t' + (100 - v[0]) + '%\\t' + iso(4) + '\\nGemini Models\\tWeekly Limit Remaining\\t' + (100 - v[1]) + '%\\t' + iso(Number(v[2]))); process.exit(0); }
if (me === 'kimi') { const v = q('Q_KIMI'); if (!v) process.exit(1); const port = Number(a[a.indexOf('--port') + 1]);
  const data = { summary: { used: v[1] * 10, limit: 1000, reset_at: iso(Number(v[2])) }, limits: [{ used: Number(v[0]), limit: 100, window: { unit: 'hour', value: 5 } }] };
  http.createServer((req, res) => res.end(JSON.stringify({ data }))).listen(port, '127.0.0.1', () => console.log('kimi web ready: http://127.0.0.1:' + port + '/?token=t'));
} else process.exit(2);
`;

const cursor = (pct) => [pct, pct, pct, 72];

const HIGH_ROWS = [
  ['personal Fable tripped, all-models not', { claude: [3, 86, 100], work: [0, 12, 23] }, undefined, 'claude-fable-5-1 max claude-work', 0],
  ['higher left on gating windows wins', { claude: [85, 10, 40], work: [10, 10, 70] }, undefined, 'claude-fable-5-1 max claude-work', 0],
  ['pops back to personal', { claude: [85, 10, 40], work: [10, 10, 95] }, undefined, 'claude-fable-5-1 max claude', 0],
  ['equal left goes to personal', { claude: [20, 10, 20], work: [20, 60, 0] }, undefined, 'claude-fable-5-1 max claude', 0],
  ['no Fable line counts as 0', { claude: [10, 50, '-'] }, undefined, 'claude-fable-5-1 max claude', 0],
  ['all-models does not gate fable', { claude: [10, 95, 10], cursor: cursor(10) }, undefined, 'claude-fable-5-1 max claude', 0],
  ['session gates fable', { claude: [90, 10, 10], cursor: cursor(10) }, undefined, 'kimi-k3-max cursor', 0],
  ['both Fable windows tripped', { claude: [10, 10, 90], work: [10, 10, 95], cursor: cursor(50) }, undefined, 'kimi-k3-max cursor', 0],
  ['one cursor window trips cursor', { claude: [10, 40, 95], work: [10, 95, 95], cursor: [10, 90, 10, 72] }, undefined, 'claude-opus-5 max claude', 0],
  ['opus: higher left wins', { claude: [10, 70, 95], work: [10, 40, 90], cursor: cursor(90) }, undefined, 'claude-opus-5 max claude-work', 0],
  ['claude and cursor tripped, grok 60', { claude: [95, 10, 10], cursor: cursor(95), grok: [60, 72] }, undefined, 'grok-4.6 xhigh grok', 0],
  ['grok tripped, agy left', { grok: [90, 72], agy: [10, 20, 72] }, undefined, 'gemini-3.8-flash-high high agy', 0],
  ['quality before headroom', { claude: [10, 50, '-'], agy: [0, 0, 72] }, undefined, 'claude-fable-5-1 max claude', 0],
  ['ineligible work skipped', { claude: [10, 10, 95], work: [10, 10, 10], cursor: cursor(50) }, '{"claude-work": false}', 'kimi-k3-max cursor', 0],
  ['kimi is never in the chain', { kimi: [0, 0, 72] }, undefined, 'none', 1],
  ['everything tripped or unavailable', { claude: [90, 90, 90], cursor: cursor(99), grok: [90, 72], agy: [10, 90, 72], kimi: [0, 0, 72] }, undefined, 'none', 1]
];

const ARGUMENT_USAGES = { claude: [10, 50, '-'], agy: [0, 0, 72] };

const ARGUMENT_ROWS = [
  ['route --high', 'claude-fable-5-1 max claude'],
  ['route extra --high', 'claude-fable-5-1 max claude'],
  ['route', 'gemini-3.1-pro-high medium agy'],
  ['route --High', 'gemini-3.1-pro-high medium agy']
];

const PLAIN_ROWS = [
  [{ qclaude: [0, 86, 2], agy: [0, 0, 72] }, 'claude-opus-5 max claude'],
  [{ qclaude: [20, 30, 72], qwork: [10, 5, 72], agy: [15, 20, 72] }, 'claude-opus-5 high claude-work'],
  [{ agy: [0, 90, 2], kimi: [0, 90, 2] }, 'gemini-3.1-pro-high high agy'],
  [{ kimi: [10, 10, 72], grok: [50, 72] }, 'kimi-code/kimi-for-coding-highspeed kimi'],
  [{ kimi: [90, 10, 72], grok: [50, 72] }, 'grok-4.6 grok'],
  [{ qclaude: [0, 86, 2], cursor: [60, 60, 60, 2] }, 'kimi-k3-max cursor']
];

const ENV_NAMES = { claude: 'H_CLAUDE', work: 'H_WORK', qclaude: 'Q_CLAUDE', qwork: 'Q_WORK', agy: 'Q_AGY', kimi: 'Q_KIMI' };

const temps = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), PREFIX));
  temps.push(dir);
  return dir;
}

async function fixtureDir() {
  const dir = await tempDir();
  await writeFile(join(dir, 'q'), FIXTURE);
  await chmod(join(dir, 'q'), 0o755);
  for (const name of ['claude', 'agy', 'kimi', 'codex', 'kilo']) await symlink('q', join(dir, name));
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  await symlink(join(rootDir, 'src', 'main.ts'), join(dir, 'dandelion'));
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

function localElevenZone() {
  const offset = new Date().getUTCHours() - 11;
  return `Etc/GMT${offset < 0 ? '-' : '+'}${Math.abs(offset)}`;
}

async function cursorApi() {
  const server = createHttpServer((req, res) => {
    const [total, auto, api, hours] = server.usage;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith('/GetPlanInfo')
      ? { planInfo: { planName: 'Ultra' } }
      : { billingCycleEnd: String(Date.now() + hours * HOUR_MS), planUsage: { totalPercentUsed: total, autoPercentUsed: auto, apiPercentUsed: api } }));
  });
  server.usage = cursor(0);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function homeFor(usages, state) {
  const home = await tempDir();
  await mkdir(join(home, '.claude-work'));
  if (state !== undefined) {
    await mkdir(join(home, 'state'));
    await writeFile(join(home, 'state', 'eligibility.json'), state);
  }
  if (usages.grok) {
    const [used, hours] = usages.grok;
    const now = Date.now();
    await mkdir(join(home, '.grok', 'logs'), { recursive: true });
    await writeFile(join(home, '.grok', 'logs', 'unified.jsonl'), JSON.stringify({
      ts: new Date(now).toISOString(),
      msg: 'billing: fetched credits config',
      ctx: {
        config: { creditUsagePercent: used, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: new Date(now - 100 * HOUR_MS).toISOString(), end: new Date(now + hours * HOUR_MS).toISOString() } },
        subscriptionTier: 'SuperGrok'
      }
    }) + '\n');
  }
  if (usages.cursor) {
    await mkdir(join(home, '.config', 'cursor'), { recursive: true });
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-012"}');
  }
  return home;
}

async function envFor(ctx, usages, state, extraEnv) {
  if (usages.cursor) ctx.cursor.usage = usages.cursor;
  const vars = Object.fromEntries(Object.entries(ENV_NAMES)
    .filter(([name]) => usages[name])
    .map(([name, variable]) => [variable, usages[name].join(',')]));
  const home = await homeFor(usages, state);
  return {
    HOME: home,
    DANDELION_STATE_FILE: join(home, 'state', 'eligibility.json'),
    TZ: ctx.zone,
    PATH: ctx.bin,
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${ctx.cursor.address().port}`,
    ...vars,
    ...extraEnv
  };
}

async function collect(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const [status] = await once(child, 'close');
  return { stdout, stderr, status };
}

async function run(ctx, args, usages, { state, extraEnv = {} } = {}) {
  const env = await envFor(ctx, usages, state, extraEnv);
  return collect(spawn(process.execPath, [join(rootDir, 'src', 'main.ts'), ...args.split(' ')], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS }));
}

function describe(label, result) {
  return `${label}\nexit ${result.status}\nstdout:\n${JSON.stringify(result.stdout)}\nstderr:\n${JSON.stringify(result.stderr)}`;
}

async function highWalksTheChain(ctx) {
  for (const [label, usages, state, line, code] of HIGH_ROWS) {
    const result = await run(ctx, 'route --high', usages, { state });
    assert.deepEqual(result, { stdout: `${line}\n`, stderr: '', status: code }, describe(label, result));
  }
}

async function argumentsPickTheMode(ctx) {
  for (const [args, line] of ARGUMENT_ROWS) {
    const result = await run(ctx, args, ARGUMENT_USAGES, { extraEnv: { NO_COLOR: '1' } });
    assert.deepEqual(result, { stdout: `${line}\n`, stderr: '', status: 0 }, describe(args, result));
  }
  const dashboard = await run(ctx, '--once route --high', ARGUMENT_USAGES, { extraEnv: { NO_COLOR: '1' } });
  assert.equal(dashboard.status, 0, describe('--once route --high', dashboard));
  assert.ok(dashboard.stdout.split('\n')[0].startsWith('DANDELION'), describe('--once route --high', dashboard));
}

async function plainRoutePrintsTheToken(ctx) {
  for (const [usages, line] of PLAIN_ROWS) {
    const result = await run(ctx, 'route', usages);
    assert.deepEqual(result, { stdout: `${line}\n`, stderr: '', status: 0 }, describe(line, result));
  }
}

async function terminalStillPrintsOneLine(ctx) {
  const env = await envFor(ctx, { claude: [10, 50, '-'] }, undefined, { TERM: 'xterm', SHELL: '/bin/sh' });
  const child = spawn('/usr/bin/script', ['-qfec', 'dandelion route --high', '/dev/null'], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  const result = await collect(child);
  assert.deepEqual(result, { stdout: 'claude-fable-5-1 max claude\r\n', stderr: '', status: 0 }, describe('terminal', result));
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

export default async function () {
  const server = await cursorApi();
  try {
    const ctx = { zone: localElevenZone(), cursor: server, bin: await fixtureDir() };
    await highWalksTheChain(ctx);
    await argumentsPickTheMode(ctx);
    await plainRoutePrintsTheToken(ctx);
    await terminalStillPrintsOneLine(ctx);
  } finally {
    server.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
