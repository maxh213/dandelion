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
const PREFIX = 'dandelion-qa-014-';
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
if (me === 'claude') { const v = q(process.env.CLAUDE_CONFIG_DIR ? 'Q_WORK' : 'Q_CLAUDE'); if (!v) process.exit(1);
  const fable = v.length > 3 ? '\\nCurrent week (Fable): ' + v[3] + '% used · resets ' + txt(Number(v[4])) : '';
  console.log('Current session: ' + v[0] + '% used · resets ' + txt(3.2) + '\\nCurrent week (all models): ' + v[1] + '% used · resets ' + txt(Number(v[2])) + fable); process.exit(0); }
if (me === 'agy') { const v = q('Q_AGY'); if (!v) process.exit(1);
  console.log('Gemini Models\\tFive Hour Limit Remaining\\t' + (100 - v[0]) + '%\\t' + iso(4) + '\\nGemini Models\\tWeekly Limit Remaining\\t' + (100 - v[1]) + '%\\t' + iso(Number(v[2]))); process.exit(0); }
if (me === 'kimi') { const v = q('Q_KIMI'); if (!v) process.exit(1); const port = Number(a[a.indexOf('--port') + 1]);
  const data = { summary: { used: v[1] * 10, limit: 1000, reset_at: iso(Number(v[2])) }, limits: [{ used: Number(v[0]), limit: 100, window: { unit: 'hour', value: 5 } }] };
  http.createServer((req, res) => res.end(JSON.stringify({ data }))).listen(port, '127.0.0.1', () => console.log('kimi web ready: http://127.0.0.1:' + port + '/?token=t'));
} else process.exit(2);
`;

const ENV_NAMES = { claude: 'Q_CLAUDE', work: 'Q_WORK', agy: 'Q_AGY', kimi: 'Q_KIMI' };

const WORK_OFF = '{"claude-work": false}';

const TRIP_ROWS = [
  ['tripped evaporator loses to untripped one', { claude: [10, 80, 2], work: [95, 52, 2] }, undefined, 'claude-opus-5 max claude', 0],
  ['work session 89: under the trip', { claude: [2, 13, 130], work: [89, 72, 5.35], grok: [9, 130] }, undefined, 'claude-opus-5 max claude-work', 0],
  ['work session 90: the trip is inclusive', { claude: [2, 13, 130], work: [90, 72, 5.35], grok: [9, 130] }, undefined, 'grok-4.6 xhigh grok', 0],
  ['tripped agy never evaporates', { agy: [95, 50, 2], claude: [0, 20, 72] }, undefined, 'claude-opus-5 high claude', 0],
  ['kimi 5h at 95 loses rule 2 to a lower binding', { kimi: [95, 0, 72], grok: [97, 72] }, undefined, 'grok-4.6 xhigh grok', 0],
  ['agy Five Hour at 90 loses rule 2', { agy: [90, 0, 72], claude: [10, 92, 72] }, undefined, 'claude-opus-5 high claude', 0],
  ['claude session at 90 loses rule 2', { claude: [90, 0, 72], grok: [95, 72] }, undefined, 'grok-4.6 xhigh grok', 0],
  ['a weekly at 95 does not trip (rule 1)', { kimi: [0, 95, 2], agy: [0, 0, 72] }, undefined, 'kimi-code/kimi-for-coding-highspeed kimi', 0],
  ['a weekly at 92 does not trip (rule 2)', { grok: [92, 72] }, undefined, 'grok-4.6 xhigh grok', 0],
  ['every routable account tripped', { claude: [90, 0, 72], agy: [99, 0, 72], kimi: [100, 0, 72] }, undefined, 'none', 1],
  ['ineligible work and tripped claude', { claude: [95, 80, 2], work: [0, 80, 2], agy: [10, 10, 72] }, WORK_OFF, 'gemini-3.1-pro-high medium agy', 0],
  ['only ineligible or tripped claude accounts', { claude: [95, 80, 2], work: [0, 80, 2] }, WORK_OFF, 'none', 1]
];

function liveCase(session) {
  return {
    claude: [2, 13, 130, 2, 130],
    work: [session, 72, 5.35, 52, 5.33],
    agy: [0, 17, 126],
    kimi: [0, 95, 73],
    grok: [9, 130],
    cursor: [36, 36, 33, 365]
  };
}

const LIVE_ROWS = [
  ['live case, work session 100%', 'route', 100, 'grok-4.6 xhigh grok'],
  ['live case, work session 89%', 'route', 89, 'claude-opus-5 max claude-work'],
  ['live case, work session 90%', 'route', 90, 'grok-4.6 xhigh grok'],
  ['live case, route --high', 'route --high', 100, 'claude-fable-5-1 max claude']
];

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
    const [total, auto, api, hours] = server.usage;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith('/GetPlanInfo')
      ? { planInfo: { planName: 'Ultra' } }
      : { billingCycleEnd: String(Date.now() + hours * HOUR_MS), planUsage: { totalPercentUsed: total, autoPercentUsed: auto, apiPercentUsed: api } }));
  });
  server.usage = [0, 0, 0, 72];
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
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-014"}');
  }
  return home;
}

async function envFor(ctx, usages, state) {
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
    ...vars
  };
}

async function run(ctx, args, usages, state) {
  const env = await envFor(ctx, usages, state);
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

async function routeSkipsTrippedAccounts(ctx) {
  for (const [label, usages, state, line, code] of TRIP_ROWS) {
    const result = await run(ctx, 'route', usages, state);
    assert.deepEqual(result, { stdout: `${line}\n`, stderr: '', status: code }, describe(label, result));
  }
}

async function liveCaseRoutesAroundTheSession(ctx) {
  for (const [label, args, session, line] of LIVE_ROWS) {
    const result = await run(ctx, args, liveCase(session));
    assert.deepEqual(result, { stdout: `${line}\n`, stderr: '', status: 0 }, describe(label, result));
  }
}

async function assertNoQaProcessLeft(dirs) {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!dirs.some((dir) => cmdline.includes(dir)), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

export default async function () {
  const zone = localElevenZone();
  assertLocalTimeNearEleven(zone);
  const server = await cursorApi();
  const dirs = [];
  try {
    const ctx = { zone, cursor: server, bin: await fixtureDir() };
    await routeSkipsTrippedAccounts(ctx);
    await liveCaseRoutesAroundTheSession(ctx);
  } finally {
    server.close();
    dirs.push(...temps);
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft(dirs);
}
