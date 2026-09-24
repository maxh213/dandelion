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
const PREFIX = 'dandelion-qa-020-';
const OUTER_TIMEOUT_MS = 60000;
const HOUR_MS = 3600000;
const AGENT = 'qa-dummy-hermes-agent-key-020';
const ACCESS = 'qa-dummy-hermes-access-020';
const QUOTA = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot';
const ENV_NAMES = { claude: 'Q_CLAUDE', work: 'Q_WORK', agy: 'Q_AGY', kimi: 'Q_KIMI' };

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
  const body = { code: 0, msg: 'success', data: { kind: 'ok', quota: { usages: {
    limit5h: { usedRatio: v[0] / 100, resetAt: iso(5) },
    limit7d: { usedRatio: v[1] / 100, resetAt: iso(Number(v[2])) }
  }, extraUsage: null } }, request_id: 'qa-020' };
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

function boxPair(leftModel, leftAccount, rightModel, rightAccount) {
  return [
    `+- route -------------------------+  +- route --high ------------------+`,
    `| ${leftModel.padEnd(31)} |  | ${rightModel.padEnd(31)} |`,
    `| ${leftAccount.padEnd(31)} |  | ${rightAccount.padEnd(31)} |`,
    `+---------------------------------+  +---------------------------------+`
  ].join('\n');
}

const CLEAR = '\x1b[H\x1b[2J';

function boxLinesOf(frame) {
  return frame.split('\n').slice(2, 6).join('\n');
}

function startLive(env) {
  const child = spawn('/usr/bin/script', ['-qfec', `'${process.execPath}' src/main.ts`, '/dev/null'], {
    cwd: rootDir,
    env: { ...env, SHELL: '/bin/sh', TERM: 'xterm', DANDELION_REFRESH_SECONDS: '3600' },
    timeout: OUTER_TIMEOUT_MS
  });
  const run = { child, output: '', stderr: '', closed: once(child, 'close') };
  child.stdout.setEncoding('utf8').on('data', (chunk) => (run.output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (run.stderr += chunk));
  return run;
}

function frames(run) {
  return run.output.replaceAll('\r\n', '\n').split(CLEAR).slice(1, -1);
}

async function waitFor(run, predicate, boundMs, what) {
  const until = Date.now() + boundMs;
  while (!predicate()) {
    assert.ok(Date.now() < until, `no ${what} within ${boundMs}ms\nlast:\n${frames(run).at(-1) ?? ''}\nstderr:\n${run.stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function quit(run) {
  run.child.stdin.write('q');
  assert.deepEqual(await run.closed, [0, null], `unexpected exit\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
}

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
    portal.requests.push(`${req.method} ${req.url}`);
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
        refresh_token: 'qa-dummy-refresh-020',
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
  await mkdir(join(dir, 'sessions', 's-new'), { recursive: true });
  await writeFile(join(dir, 'sessions', 'index.jsonl'), JSON.stringify({
    sessionId: 's-new', createdAt: now - 4000000, updatedAt: now - 3000000, taskName: 'Pong'
  }) + '\n');
  await writeFile(join(dir, 'sessions', 's-new', 'events.jsonl'), `${quotaLine(now - HOUR_MS, 'JetBrains', balance)}\n`);
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
        config: {
          creditUsagePercent: used,
          currentPeriod: {
            type: 'USAGE_PERIOD_TYPE_WEEKLY',
            start: new Date(now - 100 * HOUR_MS).toISOString(),
            end: new Date(now + hours * HOUR_MS).toISOString()
          }
        },
        subscriptionTier: 'SuperGrok'
      }
    }) + '\n');
  }
  if (usages.cursor) {
    await mkdir(join(home, '.config', 'cursor'), { recursive: true });
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-020"}');
  }
  return home;
}

async function envFor(ctx, usages, { authFile, junieHome, extraEnv = {} } = {}) {
  if (usages.cursor) ctx.cursor.usage = usages.cursor;
  const vars = Object.fromEntries(Object.entries(ENV_NAMES)
    .filter(([name]) => usages[name])
    .map(([name, variable]) => [variable, usages[name].join(',')]));
  const home = await homeFor(usages);
  return {
    HOME: home,
    TZ: ctx.zone,
    PATH: ctx.bin,
    DANDELION_STATE_FILE: join(home, 'state', 'eligibility.json'),
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${ctx.cursor.address().port}`,
    DANDELION_JUNIE_HOME: junieHome ?? ctx.empty,
    DANDELION_HERMES_AUTH_FILE: authFile ?? join(home, 'missing-hermes.json'),
    DANDELION_HERMES_PORTAL_BASE: `http://127.0.0.1:${ctx.portal.server.address().port}`,
    NO_COLOR: '1',
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

async function run(ctx, args, usages, options = {}) {
  const env = await envFor(ctx, usages, options);
  return collect(spawn(process.execPath, [join(rootDir, 'src', 'main.ts'), ...args.split(' ')], {
    cwd: rootDir,
    env,
    timeout: OUTER_TIMEOUT_MS
  }));
}

function describe(label, result) {
  return `${label}\nexit ${result.status}\nstdout:\n${JSON.stringify(result.stdout)}\nstderr:\n${JSON.stringify(result.stderr)}`;
}

function configure(portal, remaining = 5.5, hours = 72) {
  portal.remaining = remaining;
  portal.hours = hours;
  portal.requests.length = 0;
}

async function movedLines(ctx) {
  const rows = [
    ['kimi free on both', 'route', { kimi: [10, 10, 72], grok: [50, 72] }, 'kimi-code/k3 max kimi', 0],
    ['grok alone', 'route', { grok: [50, 72] }, 'grok-4.7 xhigh grok', 0],
    ['--high rank 4 grok', 'route --high', { claude: [95, 10, 10], cursor: [95, 95, 95, 72], grok: [60, 72] }, 'grok-4.7 xhigh grok', 0],
    ['kimi 5h tripped', 'route', { kimi: [90, 10, 72], grok: [50, 72] }, 'grok-4.7 xhigh grok', 0],
    ['kimi weekly evaporates', 'route', { kimi: [0, 95, 2], agy: [0, 0, 72] }, 'kimi-code/k3 max kimi', 0]
  ];
  for (const [label, args, usages, line, code] of rows) {
    const result = await run(ctx, args, usages);
    assert.deepEqual(
      { stdout: result.stdout, stderr: result.stderr, status: result.status },
      { stdout: `${line}\n`, stderr: '', status: code },
      describe(label, result)
    );
  }
}

async function hermesLines(ctx) {
  configure(ctx.portal, 5.5, 72);
  const grok = await run(ctx, 'route', liveCase(100), { junieHome: ctx.junie, authFile: ctx.auth });
  assert.deepEqual(
    { stdout: grok.stdout, stderr: grok.stderr, status: grok.status },
    { stdout: 'grok-4.7 xhigh grok\n', stderr: '', status: 0 },
    describe('hx hermes 75%', grok)
  );

  configure(ctx.portal, 22, 72);
  const hermes = await run(ctx, 'route', liveCase(100), { junieHome: ctx.junie, authFile: ctx.auth });
  assert.deepEqual(
    { stdout: hermes.stdout, stderr: hermes.stderr, status: hermes.status },
    { stdout: 'x-ai/grok-4.7 xhigh hermes\n', stderr: '', status: 0 },
    describe('hx hermes 0%', hermes)
  );
}

async function routeBoxes(ctx) {
  const env = await envFor(ctx, { kimi: [0, 0, 72], claude: [0, 20, 72], grok: [9, 130] });
  const session = startLive(env);
  try {
    await waitFor(session, () => frames(session).some((frame) => !frame.includes('probing…')), 30000, 'settled frame');
    const settled = frames(session).find((frame) => !frame.includes('probing…'));
    assert.ok(settled, 'no settled frame');
    const head = settled.split('\n').slice(0, 15).join('\n');
    assert.equal(boxLinesOf(settled), boxPair('kimi-code/k3 max', 'kimi', 'claude-fable-5-1 max', 'claude'), head);
    assert.ok(!head.includes('kimi-for-coding-highspeed'), head);
    assert.ok(!head.includes('grok-4.6'), head);
    await quit(session);
  } finally {
    session.child.kill();
  }
}

async function readmePins() {
  const readme = await readFile(join(rootDir, 'README.md'), 'utf8');
  assert.ok(readme.includes('| kimi | `kimi-code/k3 max` | `kimi-code/k3 max` |'), 'README kimi row');
  assert.ok(readme.includes('| grok | `grok-4.7 xhigh` | `grok-4.7 xhigh` |'), 'README grok row');
  assert.ok(readme.includes('| hermes | `x-ai/grok-4.7 xhigh` | `x-ai/grok-4.7 xhigh` |'), 'README hermes row');
  assert.ok(readme.includes('| 4 | grok | (all) | `grok-4.7 xhigh` |'), 'README --high rank 4');
}

async function livingSurfacesUnderQa() {
  const files = (await readdir(join(rootDir, 'qa')))
    .filter((name) => /^01[02345678]-/.test(name) && (name.endsWith('.md') || name.endsWith('.e2e.mjs')));
  for (const name of files) {
    const text = await readFile(join(rootDir, 'qa', name), 'utf8');
    assert.ok(!/kimi-for-coding-highspeed|grok-4\.6 xhigh|x-ai\/grok-4\.6/.test(text), `old line still in qa/${name}`);
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
  const cursor = await cursorApi();
  const portal = await hermesPortal();
  try {
    const empty = await tempDir();
    const hermesDir = await tempDir();
    const auth = join(hermesDir, 'auth.json');
    await writeAuth(auth);
    const junie = await tempDir();
    await writeJunieHome(junie, 701512.73275);
    const ctx = {
      empty,
      bin: await fixtureDir(),
      cursor,
      portal,
      auth,
      junie,
      zone: localElevenZone()
    };
    await movedLines(ctx);
    await hermesLines(ctx);
    await routeBoxes(ctx);
    await readmePins();
    await livingSurfacesUnderQa();
  } finally {
    portal.server.close();
    cursor.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
