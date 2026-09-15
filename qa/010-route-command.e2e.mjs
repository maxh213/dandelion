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
const PREFIX = 'dandelion-qa-010-';
const OUTER_TIMEOUT_MS = 60000;
const HOUR_MS = 3600000;

const FIXTURE = `#!/usr/bin/env node
const http = require('node:http'), path = require('node:path');
const me = path.basename(process.argv[1]), a = process.argv.slice(2);
const q = (n) => process.env[n] && process.env[n].split(',').map(Number);
const at = (h) => new Date(Date.now() + h * 3600000), iso = (h) => at(h).toISOString();
const M = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const txt = (h) => { const d = at(h), H = d.getUTCHours(); return M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + (H % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0') + (H < 12 ? 'am' : 'pm') + ' (UTC)'; };
if (me === 'codex') { console.error('Logged in using an API key - sk-proj-***n5zQA'); process.exit(0); }
if (me === 'kilo') { console.log('Balance: $14.15'); process.exit(0); }
if (me === 'claude') { const v = q(process.env.CLAUDE_CONFIG_DIR ? 'Q_WORK' : 'Q_CLAUDE'); if (!v) process.exit(1);
  console.log('Current session: ' + v[0] + '% used · resets ' + txt(4) + '\\nCurrent week (all models): ' + v[1] + '% used · resets ' + txt(v[2])); process.exit(0); }
if (me === 'agy') { const v = q('Q_AGY'); if (!v) process.exit(1);
  console.log('Gemini Models\\tFive Hour Limit Remaining\\t' + (100 - v[0]) + '%\\t' + iso(4) + '\\nGemini Models\\tWeekly Limit Remaining\\t' + (100 - v[1]) + '%\\t' + iso(v[2])); process.exit(0); }
if (me === 'kimi') { const v = q('Q_KIMI'); if (!v) process.exit(1); const port = Number(a[a.indexOf('--port') + 1]);
  const data = { summary: { used: v[1] * 10, limit: 1000, reset_at: iso(v[2]) }, limits: [{ used: v[0], limit: 100, window: { unit: 'hour', value: 5 } }] };
  http.createServer((req, res) => res.end(JSON.stringify({ data }))).listen(port, '127.0.0.1', () => console.log('kimi web ready: http://127.0.0.1:' + port + '/?token=t'));
} else process.exit(2);
`;

const ROUTE_ROWS = [
  ['evaporation beats perfect headroom', 'route', { claude: [0, 86, 2], agy: [0, 0, 72] }, 'claude-opus-5 max claude'],
  ['highest evaporation score wins', 'route', { claude: [0, 86, 2], cursor: [60, 2] }, 'kimi-k3-max cursor'],
  ['evaporation tie goes to dashboard order', 'route', { agy: [0, 90, 2], kimi: [0, 90, 2] }, 'gemini-3.1-pro-high high agy'],
  ['an untouched weekly (97 left) never evaporates', 'route', { claude: [0, 3, 2], agy: [10, 10, 72] }, 'claude-opus-5 high claude'],
  ['a reset after local midnight never evaporates', 'route', { claude: [0, 86, 14], agy: [10, 10, 72] }, 'gemini-3.1-pro-high medium agy'],
  ['most headroom, claude-work highest', 'route', { claude: [20, 30, 72], work: [10, 5, 72], agy: [15, 20, 72] }, 'claude-opus-5 high claude-work'],
  ['most headroom, agy highest', 'route', { claude: [20, 30, 72], agy: [5, 5, 72] }, 'gemini-3.1-pro-high medium agy'],
  ['kimi bound by its 5h window', 'route', { kimi: [90, 10, 72], agy: [50, 50, 72] }, 'gemini-3.1-pro-high medium agy'],
  ['a missing rolling kind counts as 100', 'route', { kimi: [90, 10, 72], grok: [50, 72] }, 'grok-4.6 xhigh grok'],
  ['kimi free on both', 'route', { kimi: [10, 10, 72], grok: [50, 72] }, 'kimi-code/kimi-for-coding-highspeed kimi'],
  ['headroom tie goes to dashboard order', 'route', { agy: [20, 20, 72], kimi: [20, 20, 72] }, 'gemini-3.1-pro-high medium agy'],
  ['an unavailable candidate is skipped', 'route', { cursor: [40, 72] }, 'kimi-k3-max cursor'],
  ['later arguments are ignored', 'route extra', { claude: [0, 86, 2] }, 'claude-opus-5 max claude']
];

const DASHBOARD_ARGS = ['--once route', 'routes'];

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

function assertLocalTimeNearEleven(zone) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  assert.ok(hour >= 10 && hour <= 13, `TZ ${zone} puts local time at ${hour}:xx`);
}

async function cursorApi() {
  const server = createHttpServer((req, res) => {
    const [used, hours] = server.usage;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith('/GetPlanInfo')
      ? { planInfo: { planName: 'Ultra' } }
      : { billingCycleEnd: String(Date.now() + hours * HOUR_MS), planUsage: { totalPercentUsed: used, autoPercentUsed: used, apiPercentUsed: used } }));
  });
  server.usage = [0, 72];
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function homeFor(usages) {
  const home = await tempDir();
  await mkdir(join(home, '.claude-work'));
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
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-010"}');
  }
  return home;
}

async function run(ctx, args, usages, extraEnv = {}) {
  if (usages.cursor) ctx.cursor.usage = usages.cursor;
  const q = Object.fromEntries(['claude', 'work', 'agy', 'kimi']
    .filter((name) => usages[name])
    .map((name) => [`Q_${name.toUpperCase()}`, usages[name].join(',')]));
  const home = await homeFor(usages);
  const env = {
    HOME: home,
    DANDELION_STATE_FILE: join(home, 'no-state', 'eligibility.json'),
    TZ: ctx.zone,
    PATH: ctx.bin,
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${ctx.cursor.address().port}`,
    ...q,
    ...extraEnv
  };
  const child = spawn(process.execPath, [join(rootDir, 'src', 'main.ts'), ...args.split(' ')], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const [status] = await once(child, 'close');
  return { stdout, stderr, status };
}

function describe(label, result) {
  return `${label}\nexit ${result.status}\nstdout:\n${JSON.stringify(result.stdout)}\nstderr:\n${JSON.stringify(result.stderr)}`;
}

async function routeRowsPrintOneLine(ctx) {
  for (const [label, args, usages, line] of ROUTE_ROWS) {
    const result = await run(ctx, args, usages);
    assert.deepEqual(result, { stdout: `${line}\n`, stderr: '', status: 0 }, describe(label, result));
  }
}

async function nothingToRoute(ctx) {
  const result = await run(ctx, 'route', {});
  assert.deepEqual(result, { stdout: 'none\n', stderr: '', status: 1 }, describe('Nothing to route', result));
}

async function routeAnywhereButFirstKeepsTheDashboard(ctx) {
  for (const args of DASHBOARD_ARGS) {
    const result = await run(ctx, args, { claude: [0, 86, 2] }, { NO_COLOR: '1' });
    assert.equal(result.status, 0, describe(args, result));
    const first = result.stdout.split('\n')[0];
    assert.ok(first.startsWith('DANDELION'), describe(args, result));
    assert.match(first, /^DANDELION +\d{2}:\d{2}:\d{2}Z$/, describe(args, result));
    assert.ok(!result.stdout.includes('claude-opus-5'), describe(args, result));
  }
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

export default async function () {
  const zone = localElevenZone();
  assertLocalTimeNearEleven(zone);
  const cursor = await cursorApi();
  try {
    const ctx = { zone, cursor, bin: await fixtureDir() };
    await routeRowsPrintOneLine(ctx);
    await nothingToRoute(ctx);
    await routeAnywhereButFirstKeepsTheDashboard(ctx);
  } finally {
    cursor.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
