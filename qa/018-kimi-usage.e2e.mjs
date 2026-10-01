import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, readdir, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ROUTES_FILE } from './routes-fixture.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'dandelion-qa-018-';
const OUTER_TIMEOUT_MS = 60000;
const FAST_MS = 8000;
const HOUR_MS = 3600000;
const WARM = '\x1b[33m';
const CALM = '\x1b[32m';
const DIM = '\x1b[90m';
const PARSE = 'Could not parse usage from response';
const CAPTION = 'kimi code · kimi';
const AGENT = 'qa-dummy-hermes-agent-key-016';
const ACCESS = 'qa-dummy-hermes-access-016';
const NAMES = ['claude', 'claude-work', 'claude-deepseek', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];
const QUOTA = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot';
const ENV_NAMES = { claude: 'Q_CLAUDE', work: 'Q_WORK', agy: 'Q_AGY', kimi: 'Q_KIMI' };

const K2_FIXTURE = `#!/usr/bin/env node
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const dir = __dirname, mode = fs.readFileSync(path.join(dir, 'mode'), 'utf8').trim();
fs.writeFileSync(path.join(dir, 'kimi.pid'), String(process.pid));
const a = process.argv.slice(2), port = Number(a[a.indexOf('--port') + 1]);
if (a[0] !== 'web' || !a.includes('--no-open') || !port) process.exit(2);
if (mode === 'notoken') process.exit(0);
setInterval(() => {}, 1000);
if (mode === 'silent') return;
if (mode === 'stubborn') process.on('SIGTERM', () => {});
const ready = 'Local: http://127.0.0.1:' + port + '/#token=test-token';
if (mode === 'nohttp') return console.log(ready);
const reset = new Date(Date.now() + 7205 * 60000).toISOString().replace(/\\.\\d{3}Z$/, 'Z');
const env = (w, r, extra) => ({ code: 0, msg: 'success', data: { kind: 'ok', quota: { usages: {
  limit5h: { usedRatio: r, resetAt: reset }, limit7d: { usedRatio: w, resetAt: reset }
}, extraUsage: null } }, request_id: '01M2WR59QVZ5WJFMF4A6TWESJB', ...extra });
const live = { code: 0, msg: 'success', data: { kind: 'ok', quota: { usages: {
  limit5h: { usedRatio: 0, resetAt: '2026-09-19T14:58:50Z' },
  limit7d: { usedRatio: 0, resetAt: '2026-09-25T12:58:50Z' }
}, extraUsage: null } }, request_id: '01M2WR59QVZ5WJFMF4A6TWESJB' };
const bodies = {
  ok: env(0.59, 0.42), round: env(0.595, 0.42), live,
  denied: { ...env(0.59, 0.42), code: 1, msg: 'quota denied' },
  nouse: env(0.59, 0.42, { data: { kind: 'ok', quota: {} } }),
  kinderr: env(0.59, 0.42, { data: { kind: 'error', quota: { usages: {} } } }),
  stratio: env('0.59', '0.42'),
  old: { data: { summary: { used: 590, limit: 1000, reset_at: reset }, limits: [{ used: 42, limit: 100, window: { unit: 'hour', value: 5 } }] } }
};
http.createServer((req, res) => {
  if (mode === 'hang') return;
  const ok = req.headers.authorization === 'Bearer test-token' && req.url === '/api/v1/oauth/usage';
  const status = mode === '500' ? 500 : ok ? 200 : 401;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(status !== 200 ? '{}' : mode === 'badjson' ? '{"data":' : JSON.stringify(bodies[mode] ?? bodies.ok));
}).listen(port, '127.0.0.1', () => console.log(ready));
`;

const Q_FIXTURE = `#!/usr/bin/env node
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
  const body = { code: 0, msg: 'success', data: { kind: 'ok', quota: { usages: {
    limit5h: { usedRatio: v[0] / 100, resetAt: iso(5) },
    limit7d: { usedRatio: v[1] / 100, resetAt: iso(Number(v[2])) }
  }, extraUsage: null } }, request_id: 'qa-018' };
  http.createServer((req, res) => res.end(JSON.stringify(body))).listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/#token=t'));
} else process.exit(2);
`;

const temps = [];

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

function quotaLine(endedAtMs, kind, balance) {
  const quota = { type: `${QUOTA}.${kind}`, balanceUnit: 'CREDITS' };
  if (balance !== undefined) quota.balanceLeft = balance;
  return JSON.stringify({ kind: 'SessionA2uxEvent', event: { state: 'IN_PROGRESS' }, completion: { endedAtMs, taskCostUsd: 0.03, quota }, timestampMs: endedAtMs });
}

function expiry(past) {
  return new Date(Date.now() + (past ? -HOUR_MS : 24 * HOUR_MS)).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), PREFIX));
  temps.push(dir);
  return dir;
}

async function k2Dir() {
  const dir = await tempDir();
  await writeFile(join(dir, 'kimi'), K2_FIXTURE);
  await chmod(join(dir, 'kimi'), 0o755);
  await writeFile(join(dir, 'mode'), 'ok\n');
  return dir;
}

async function fixtureDir() {
  const dir = await tempDir();
  await writeFile(join(dir, 'q'), Q_FIXTURE);
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

async function hermesPortal() {
  const portal = { mode: 'ok', remaining: 5.5, hours: 72, requests: [] };
  const server = createHttpServer((req, res) => {
    portal.requests.push(`${req.method} ${req.url} ${req.headers.authorization} ${req.headers.accept}`);
    if (portal.mode === 'unauthorized') {
      res.writeHead(401).end(JSON.stringify({ error: `bad token ${req.headers.authorization}` }));
      return;
    }
    const end = new Date(Date.now() + portal.hours * HOUR_MS).toISOString();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      user: { email: 'qa@example.com' },
      organisation: { id: 'o', slug: 'o', name: 'O' },
      subscription: {
        plan: 'Plus',
        tier: 2,
        monthly_charge: 20,
        monthly_credits: 22,
        current_period_end: end,
        credits_remaining: portal.remaining,
        rollover_credits: 6.591792646666667
      },
      purchased_credits_remaining: 0,
      tool_access: { enabled: false },
      managed_tools: false,
      paid_service_access: {
        allowed: true,
        paid_access: true,
        reason: 'usable_credits',
        subscription_credits_remaining: portal.remaining,
        purchased_credits_remaining: 0,
        total_usable_credits: portal.remaining
      }
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  portal.server = server;
  return portal;
}

async function writeAuth(path) {
  const exp = expiry(false);
  await writeFile(path, JSON.stringify({
    version: 1,
    providers: {
      nous: {
        access_token: ACCESS,
        refresh_token: 'qa-dummy-refresh-016',
        client_id: 'hermes-cli',
        portal_base_url: 'https://portal.nousresearch.com',
        agent_key: AGENT,
        agent_key_expires_at: exp,
        expires_at: exp
      }
    },
    active_provider: 'nous'
  }) + '\n');
}

async function writeJunieHome(dir, balance) {
  const now = Date.now();
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'sessions', 's-old'), { recursive: true });
  await mkdir(join(dir, 'sessions', 's-new'), { recursive: true });
  const index = [
    JSON.stringify({ sessionId: 's-old', createdAt: now - 11000000, updatedAt: now - 10000000, status: 'Sending LLM request' }),
    'not json at all',
    JSON.stringify({ sessionId: 's-new', createdAt: now - 4000000, updatedAt: now - 3000000, taskName: 'Pong' })
  ].join('\n') + '\n';
  await writeFile(join(dir, 'sessions', 'index.jsonl'), index);
  await writeFile(join(dir, 'sessions', 's-old', 'events.jsonl'), `${quotaLine(now - 3 * HOUR_MS, 'JetBrains', 900000)}\n`);
  const newest = [
    '{"kind":"SessionA2uxEvent","event":{"state":"IN_PROGRESS"},"timestampMs":1}',
    '{"kind":"Other"}',
    quotaLine(now - 3700000, 'Unknown'),
    'not json at all',
    quotaLine(now - HOUR_MS, 'JetBrains', balance)
  ].join('\n') + '\n';
  await writeFile(join(dir, 'sessions', 's-new', 'events.jsonl'), newest);
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
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-018"}');
  }
  return home;
}

async function collect(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const [status, signal] = await once(child, 'close');
  return { stdout, stderr, status, signal };
}

function describe(label, result) {
  return `${label}\nexit ${result.status} signal ${result.signal} elapsed ${result.elapsed}\nstdout:\n${JSON.stringify(result.stdout)}\nstderr:\n${JSON.stringify(result.stderr)}`;
}

function panelLines(stdout, id) {
  const lines = stdout.split('\n');
  const header = lines.findIndex((line) => line.replace(/^▸ /, '').replace(/ +routing off$/, '') === id);
  assert.ok(header >= 0, `no ${id} panel in:\n${stdout}`);
  const end = lines.findIndex((line, index) => index > header && /^=+$/.test(line));
  return lines.slice(header, end < 0 ? lines.length : end);
}

function assertWidth(stdout) {
  for (const line of stdout.replaceAll(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    assert.ok([...line].length <= 72, `line wider than 72 columns: ${JSON.stringify(line)}`);
  }
}

function assertOrder(stdout) {
  const lines = stdout.split('\n');
  const starts = NAMES.map((name) => lines.indexOf(name));
  assert.ok(starts.every((at) => at >= 0), `a panel is missing:\n${stdout}`);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts, `panels are not in the order ${NAMES.join(', ')}:\n${stdout}`);
}

function assertNoToken(result) {
  for (const text of [result.stdout, result.stderr]) {
    assert.equal((text.match(/test-token/g) || []).length, 0, `test-token leaked:\n${text}`);
    assert.equal((text.match(/qa-dummy-hermes-(agent-key|access)-016/g) || []).length, 0, `a dummy token leaked:\n${text}`);
  }
}

function assertOkRows(kimi, weeklyPct, rollingPct) {
  const filled = (pct) => Math.round((pct / 100) * 20);
  const gauge = (pct) => `${'#'.repeat(filled(pct))}${'-'.repeat(20 - filled(pct))}`;
  const percent = (pct) => `${pct}%`.padStart(4);
  const weekly = kimi[1];
  const rolling = kimi[2];
  assert.match(weekly, new RegExp(`^weekly {30}${gauge(weeklyPct)} ${percent(weeklyPct)} ↻ (5d0h|4d23h)$`), `weekly: ${JSON.stringify(weekly)}`);
  assert.match(rolling, new RegExp(`^5h {34}${gauge(rollingPct)} ${percent(rollingPct)} ↻ (5d0h|4d23h)$`), `5h: ${JSON.stringify(rolling)}`);
  assert.equal(kimi[3], CAPTION);
}

function assertDim(kimi, reason) {
  assert.deepEqual(kimi.slice(0, 3), ['kimi', reason, CAPTION]);
  assert.ok(!kimi.some((line) => line.includes('#') || / \d+%/.test(line)), `dim kimi has a gauge:\n${kimi.join('\n')}`);
}

async function pidState(k2) {
  const raw = await readFile(join(k2, 'kimi.pid'), 'utf8').catch(() => '');
  const pid = Number(raw);
  if (!pid) return 'NONE';
  try {
    process.kill(pid, 0);
    return 'ALIVE';
  } catch {
    return 'GONE';
  }
}

async function runPanel(ctx, { mode, color = false, port } = {}) {
  await writeFile(join(ctx.k2, 'mode'), `${mode}\n`);
  await rm(join(ctx.k2, 'kimi.pid'), { force: true });
  const env = {
    HOME: ctx.home,
    PATH: `${ctx.k2}:${ctx.nodebin}`,
    SHELL: '/bin/sh',
    TERM: 'xterm',
    DANDELION_KIMI_PORT: port ?? String(await freePort()),
    DANDELION_GROK_HOME: ctx.empty,
    DANDELION_JUNIE_HOME: ctx.empty,
    DANDELION_CURSOR_AUTH_FILE: join(ctx.home, 'missing-cursor.json'),
    DANDELION_HERMES_AUTH_FILE: join(ctx.home, 'missing-hermes.json'),
    DANDELION_CLAUDE_WORK_CONFIG_DIR: join(ctx.home, '.claude-work'),
    DANDELION_STATE_FILE: join(ctx.home, 'no-state', 'eligibility.json'),
    ...(color ? {} : { NO_COLOR: '1' })
  };
  const started = Date.now();
  const child = spawn(process.execPath, [join(rootDir, 'src', 'main.ts'), '--once'], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  const result = await collect(child);
  return { ...result, elapsed: Date.now() - started, child: await pidState(ctx.k2) };
}

async function envFor(ctx, usages, { junieHome, authFile } = {}) {
  if (usages.cursor) ctx.cursor.usage = usages.cursor;
  const vars = Object.fromEntries(Object.entries(ENV_NAMES)
    .filter(([name]) => usages[name])
    .map(([name, variable]) => [variable, usages[name].join(',')]));
  const home = await homeFor(usages);
  return {
    HOME: home,
    TZ: ctx.zone,
    PATH: ctx.bin,
    SHELL: '/bin/sh',
    TERM: 'xterm',
    NO_COLOR: '1',
    DANDELION_STATE_FILE: join(home, 'state', 'eligibility.json'),
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${ctx.cursor.address().port}`,
    DANDELION_JUNIE_HOME: junieHome ?? ctx.empty,
    DANDELION_HERMES_AUTH_FILE: authFile ?? join(home, 'missing-hermes.json'),
    DANDELION_ROUTES_FILE: ROUTES_FILE,
    DANDELION_HERMES_PORTAL_BASE: `http://127.0.0.1:${ctx.portal.server.address().port}`,
    ...vars
  };
}

async function runRoute(ctx, args, usages, options = {}) {
  const env = await envFor(ctx, usages, options);
  const argv = args.split(' ');
  const child = spawn(process.execPath, [join(rootDir, 'src', 'main.ts'), ...argv], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  return collect(child);
}

function configure(portal, remaining = 5.5, hours = 72) {
  portal.remaining = remaining;
  portal.hours = hours;
  portal.mode = 'ok';
  portal.requests.length = 0;
}

async function panelHappy(ctx) {
  const result = await runPanel(ctx, { mode: 'ok' });
  assert.equal(result.status, 0, describe('ok', result));
  assert.equal(result.child, 'GONE', describe('ok child', result));
  assert.equal(result.stderr, '');
  assertOrder(result.stdout);
  const kimi = panelLines(result.stdout, 'kimi');
  assert.equal(kimi[0], 'kimi');
  assertOkRows(kimi, 59, 42);
  assertWidth(result.stdout);
  assertNoToken(result);
  assert.ok(!result.stdout.includes(PARSE), describe('ok parse failure', result));
  ctx.okElapsed = result.elapsed;
}

async function panelColour(ctx) {
  const result = await runPanel(ctx, { mode: 'ok', color: true });
  assert.equal(result.status, 0, describe('colour', result));
  assert.equal(result.child, 'GONE', describe('colour child', result));
  assert.ok(result.stdout.includes(`${WARM}${'█'.repeat(12)}${'░'.repeat(8)}\x1b[0m ${WARM} 59%\x1b[0m`), `weekly gauge is not warm:\n${result.stdout}`);
  assert.ok(result.stdout.includes(`${CALM}${'█'.repeat(8)}${'░'.repeat(12)}\x1b[0m ${CALM} 42%\x1b[0m`), `5h gauge is not calm:\n${result.stdout}`);
  assert.ok(result.stdout.includes(`${DIM}${CAPTION}\x1b[0m`), `caption is not dim:\n${result.stdout}`);
  assertNoToken(result);
}

async function panelLive(ctx) {
  const result = await runPanel(ctx, { mode: 'live' });
  assert.equal(result.status, 0, describe('live', result));
  assert.equal(result.child, 'GONE', describe('live child', result));
  const kimi = panelLines(result.stdout, 'kimi');
  assert.match(kimi[1], /^weekly {30}-{20} {3}0% ↻ \S+$/, `live weekly: ${JSON.stringify(kimi[1])}`);
  assert.match(kimi[2], /^5h {34}-{20} {3}0% ↻ 0h0m$/, `live 5h: ${JSON.stringify(kimi[2])}`);
  assert.equal(kimi[3], CAPTION);
  assert.ok(!result.stdout.includes(PARSE), describe('live parse failure', result));
  assertNoToken(result);
}

async function panelRound(ctx) {
  const result = await runPanel(ctx, { mode: 'round' });
  assert.equal(result.status, 0, describe('round', result));
  assert.equal(result.child, 'GONE', describe('round child', result));
  assertOkRows(panelLines(result.stdout, 'kimi'), 60, 42);
  assertNoToken(result);
}

async function panelFailures(ctx) {
  const rows = [
    ['denied', 'kimi usage request failed: quota denied'],
    ['nouse', PARSE],
    ['kinderr', PARSE],
    ['badjson', PARSE],
    ['stratio', PARSE],
    ['old', PARSE]
  ];
  for (const [mode, reason] of rows) {
    const result = await runPanel(ctx, { mode });
    assert.equal(result.status, 0, describe(mode, result));
    assert.equal(result.child, 'GONE', describe(`${mode} child`, result));
    assert.ok(result.elapsed < FAST_MS, `${mode} took ${result.elapsed}ms`);
    assertDim(panelLines(result.stdout, 'kimi'), reason);
    assertOrder(result.stdout);
    assertNoToken(result);
  }
}

async function panelQuickFailures(ctx) {
  const rows = [
    ['notoken', 'kimi web exited without printing a token'],
    ['500', 'kimi usage request failed: HTTP 500'],
    ['nohttp', 'kimi usage request failed']
  ];
  for (const [mode, reason] of rows) {
    const result = await runPanel(ctx, { mode });
    assert.equal(result.status, 0, describe(mode, result));
    assert.equal(result.child, 'GONE', describe(`${mode} child`, result));
    assert.ok(result.elapsed < FAST_MS, `${mode} took ${result.elapsed}ms`);
    assertDim(panelLines(result.stdout, 'kimi'), reason);
    assertNoToken(result);
  }
}

async function panelStubborn(ctx) {
  const result = await runPanel(ctx, { mode: 'stubborn' });
  assert.equal(result.status, 0, describe('stubborn', result));
  assert.equal(result.child, 'GONE', describe('stubborn child', result));
  assert.ok(result.elapsed >= 4000, `stubborn returned in ${result.elapsed}ms`);
  assertOkRows(panelLines(result.stdout, 'kimi'), 59, 42);
  assertNoToken(result);
}

async function panelBadPort(ctx) {
  const result = await runPanel(ctx, { mode: 'ok', port: 'abc' });
  assert.equal(result.status, 0, describe('abc port', result));
  assert.equal(result.child, 'NONE', describe('abc port child', result));
  assertDim(panelLines(result.stdout, 'kimi'), 'DANDELION_KIMI_PORT must be an integer from 1 to 65535');
  assertNoToken(result);
}

async function routeRows(ctx) {
  const rows = [
    ['kimi headroom', 'route', { kimi: [10, 10, 72], grok: [50, 72] }, 'model-d kimi', 0],
    ['5h at 90 trips', 'route', { kimi: [90, 10, 72], grok: [50, 72] }, 'model-e xhigh grok', 0],
    ['weekly 95 evaporates', 'route', { kimi: [0, 95, 2], agy: [0, 0, 72] }, 'model-d max kimi', 0],
    ['kimi only', 'route', { kimi: [0, 0, 72] }, 'model-d kimi', 0],
    ['--high skips kimi', 'route --high', { kimi: [0, 0, 72] }, 'none', 1]
  ];
  for (const [label, args, usages, line, code] of rows) {
    const result = await runRoute(ctx, args, usages);
    assert.deepEqual(
      { stdout: result.stdout, stderr: result.stderr, status: result.status },
      { stdout: `${line}\n`, stderr: '', status: code },
      describe(label, result)
    );
    assertNoToken(result);
  }
}

async function liveCaseRows(ctx) {
  configure(ctx.portal, 5.5, 72);
  const grok = await runRoute(ctx, 'route', liveCase(100), { junieHome: ctx.junie, authFile: ctx.auth });
  assert.deepEqual(
    { stdout: grok.stdout, stderr: grok.stderr, status: grok.status },
    { stdout: 'model-e xhigh grok\n', stderr: '', status: 0 },
    describe('014 live case', grok)
  );
  assertNoToken(grok);

  configure(ctx.portal, 22, 72);
  const hermes = await runRoute(ctx, 'route', liveCase(100), { junieHome: ctx.junie, authFile: ctx.auth });
  assert.deepEqual(
    { stdout: hermes.stdout, stderr: hermes.stderr, status: hermes.status },
    { stdout: 'vendor/model-h xhigh hermes\n', stderr: '', status: 0 },
    describe('014 live case hermes 0%', hermes)
  );
  assertNoToken(hermes);
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

export default async function () {
  const cursor = await cursorApi();
  const portal = await hermesPortal();
  try {
    const home = await tempDir();
    await mkdir(join(home, '.claude-work'));
    const empty = await tempDir();
    const nodebin = await tempDir();
    await symlink(process.execPath, join(nodebin, 'node'));
    await symlink('/bin/sh', join(nodebin, 'sh'));
    const hermesDir = await tempDir();
    const auth = join(hermesDir, 'auth.json');
    await writeAuth(auth);
    const junie = await tempDir();
    await writeJunieHome(junie, 701512.73275);
    const ctx = {
      home,
      empty,
      nodebin,
      k2: await k2Dir(),
      bin: await fixtureDir(),
      cursor,
      portal,
      auth,
      junie,
      zone: localElevenZone()
    };
    await panelHappy(ctx);
    await panelColour(ctx);
    await panelLive(ctx);
    await panelRound(ctx);
    await panelFailures(ctx);
    await panelQuickFailures(ctx);
    await panelStubborn(ctx);
    await panelBadPort(ctx);
    await routeRows(ctx);
    await liveCaseRows(ctx);
  } finally {
    cursor.close();
    portal.server.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
