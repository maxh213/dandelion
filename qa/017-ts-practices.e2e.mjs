import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, readdir, stat, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'dandelion-qa-017-';
const OUTER_TIMEOUT_MS = 60000;
const HOUR_MS = 3600000;
const CLEAR = '\x1b[H\x1b[2J';
const ENTER = '\x1b[?1049h';
const NOT_ROUTABLE = 'not routable (no usage windows)';
const NO_AUTH = 'no hermes auth — run hermes portal login';
const EXPIRED = 'hermes token expired — run hermes once';
const HTTP_401 = 'hermes account request failed: HTTP 401';
const AGENT = 'qa-dummy-hermes-agent-key-016';
const ACCESS = 'qa-dummy-hermes-access-016';
const CAPTION = 'Plus · $5.50 of $22 · hermes';
const HELP = 'keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help';
const KILO_GAUGE = `$14.15 ${'#'.repeat(14)}${'-'.repeat(6)}`;
const NAMES = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];
const QUOTA = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot';
const ACCOUNT_GET = `GET /api/oauth/account Bearer ${AGENT} application/json`;
const RESET = /(3d0h|2d23h)/;
const BARE_PANELS = [
  ['claude', 'claude CLI not found in PATH', 'claude · personal · claude'],
  ['claude-work', 'claude CLI not found in PATH', 'claude · work · claude-work'],
  ['agy', 'agy CLI not found in PATH', 'agy · agy'],
  ['kimi', 'kimi CLI not found in PATH', 'kimi code · kimi'],
  ['grok', 'no grok billing snapshot — run grok once', 'grok · grok'],
  ['codex', 'codex CLI not found in PATH', 'codex · codex'],
  ['cursor', 'no cursor auth — run cursor-agent login', 'cursor · cursor'],
  ['junie', 'no junie quota snapshot — run junie once', 'junie · junie'],
  ['hermes', 'no hermes auth — run hermes portal login', 'hermes · hermes'],
  ['kilo', 'kilo CLI not found in PATH', 'api balance · kilo']
];

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
  }, extraUsage: null } }, request_id: 'qa-018' };
  http.createServer((req, res) => res.end(JSON.stringify(body))).listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/#token=t'));
} else process.exit(2);
`;

const ENV_NAMES = { claude: 'Q_CLAUDE', work: 'Q_WORK', agy: 'Q_AGY', kimi: 'Q_KIMI' };
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

function creditsRow(pct) {
  const filled = Math.round((pct / 100) * 20);
  return `${'credits'.padEnd(35)} ${'#'.repeat(filled)}${'-'.repeat(20 - filled)} ${`${pct}%`.padStart(4)}`;
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

async function writeAuth(path, { past = false } = {}) {
  const exp = expiry(past);
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

async function writeJunieHome(dir, balance, { newestAgoMs = HOUR_MS } = {}) {
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
    quotaLine(now - newestAgoMs, 'JetBrains', balance)
  ].join('\n') + '\n';
  await writeFile(join(dir, 'sessions', 's-new', 'events.jsonl'), newest);
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
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-017"}');
  }
  return home;
}

async function envFor(ctx, usages, { state, extraEnv = {}, junieHome, color = false, authFile, path } = {}) {
  if (usages.cursor) ctx.cursor.usage = usages.cursor;
  const vars = Object.fromEntries(Object.entries(ENV_NAMES)
    .filter(([name]) => usages[name])
    .map(([name, variable]) => [variable, usages[name].join(',')]));
  const home = await homeFor(usages, state);
  return {
    HOME: home,
    TZ: ctx.zone,
    PATH: path ?? ctx.bin,
    SHELL: '/bin/sh',
    TERM: 'xterm',
    DANDELION_STATE_FILE: join(home, 'state', 'eligibility.json'),
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${ctx.cursor.address().port}`,
    DANDELION_JUNIE_HOME: junieHome ?? ctx.empty,
    DANDELION_HERMES_AUTH_FILE: authFile ?? ctx.auth,
    DANDELION_HERMES_PORTAL_BASE: `http://127.0.0.1:${ctx.portal.server.address().port}`,
    DANDELION_REFRESH_SECONDS: '3600',
    ...(color ? {} : { NO_COLOR: '1' }),
    ...vars,
    ...extraEnv
  };
}

async function collect(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const [status, signal] = await once(child, 'close');
  return { stdout, stderr, status, signal };
}

async function spawnApp(command, args, env) {
  const child = spawn(command, args, { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  return collect(child);
}

async function run(ctx, args, usages, options = {}) {
  const env = await envFor(ctx, usages, options);
  const argv = args === '' ? [] : args.split(' ');
  return spawnApp(process.execPath, [join(rootDir, 'src', 'main.ts'), ...argv], env);
}

function describe(label, result) {
  return `${label}\nexit ${result.status} signal ${result.signal}\nstdout:\n${JSON.stringify(result.stdout)}\nstderr:\n${JSON.stringify(result.stderr)}`;
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

function assertNoTokens(...texts) {
  for (const text of texts) {
    assert.equal((text.match(/qa-dummy-hermes-(agent-key|access)-016/g) || []).length, 0, `a dummy token leaked:\n${text}`);
  }
}

function assertCredits(line, pct) {
  assert.match(line, new RegExp(`^${creditsRow(pct)} ↻ ${RESET.source}$`), `credits row: ${JSON.stringify(line)}`);
}

function assertAccountGet(portal) {
  assert.deepEqual(portal.requests, [ACCOUNT_GET], `fixture requests: ${JSON.stringify(portal.requests)}`);
}

function configure(portal, remaining = 5.5, hours = 72, mode = 'ok') {
  portal.remaining = remaining;
  portal.hours = hours;
  portal.mode = mode;
  portal.requests.length = 0;
}

function withoutClock(stdout) {
  return stdout.split('\n').slice(1).map((line) => line.replace(/ ↻ \S+$/, '')).join('\n');
}

function boxPair(leftModel, leftAccount, rightModel, rightAccount) {
  return [
    `+- route -------------------------+  +- route --high ------------------+`,
    `| ${leftModel.padEnd(31)} |  | ${rightModel.padEnd(31)} |`,
    `| ${leftAccount.padEnd(31)} |  | ${rightAccount.padEnd(31)} |`,
    `+---------------------------------+  +---------------------------------+`
  ].join('\n');
}

function boxLinesOf(frame) {
  return frame.split('\n').slice(2, 6).join('\n');
}

function startLive(env) {
  const child = spawn('/usr/bin/script', ['-qfec', `'${process.execPath}' src/main.ts`, '/dev/null'], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  const run = { child, output: '', stderr: '', frameStarts: [], started: Date.now(), closed: once(child, 'close') };
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    run.output += chunk;
    const count = run.output.split(CLEAR).length - 1;
    while (run.frameStarts.length < count) run.frameStarts.push(Date.now());
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => (run.stderr += chunk));
  return run;
}

function frames(run) {
  return run.output.replaceAll('\r\n', '\n').split(CLEAR).slice(1, -1);
}

function lastFrame(run) {
  return frames(run).at(-1) ?? '';
}

async function waitFor(run, predicate, boundMs, what) {
  const until = Date.now() + boundMs;
  while (!predicate()) {
    assert.ok(Date.now() < until, `no ${what} within ${boundMs}ms\nlast frame:\n${lastFrame(run)}\nstderr:\n${run.stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitSettled(run) {
  await waitFor(run, () => frames(run).some((frame) => !frame.includes('probing…')), 30000, 'settled frame');
}

async function quit(run) {
  run.child.stdin.write('q');
  assert.deepEqual(await run.closed, [0, null], `unexpected exit\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
}

async function onceDashboard(ctx) {
  const before = await readFile(ctx.auth, 'utf8');
  configure(ctx.portal);
  const result = await run(ctx, '--once', {}, { junieHome: ctx.junie });
  assert.equal(result.status, 0, describe('happy --once', result));
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.length > 0, 'empty --once stdout');
  assert.ok(!result.stdout.includes(ENTER), describe('once wrote alternate screen', result));
  const banner = result.stdout.split('\n')[0];
  assert.match(banner, /^DANDELION +\d{2}:\d{2}:\d{2}Z$/);
  assert.equal([...banner].length, 72, `banner width: ${JSON.stringify(banner)}`);
  assertOrder(result.stdout);
  const junie = panelLines(result.stdout, 'junie');
  assert.equal(junie[1], creditsRow(30), describe('junie 30%', result));
  assert.match(junie[2], /^snapshot 1h[01]m old$/);
  assert.equal(junie[3], '701513 credits · junie');
  const hermes = panelLines(result.stdout, 'hermes');
  assert.equal(hermes[0], 'hermes');
  assertCredits(hermes[1], 75);
  assert.equal(hermes[2], CAPTION);
  const kilo = panelLines(result.stdout, 'kilo');
  assert.equal(kilo[1], KILO_GAUGE.padEnd(72));
  assert.equal(kilo[2], 'api balance · kilo');
  assert.equal(panelLines(result.stdout, 'codex')[1], 'api-key billing · no usage windows');
  assertWidth(result.stdout);
  assert.equal(await readFile(ctx.auth, 'utf8'), before, 'the auth file changed');
  assertNoTokens(result.stdout, result.stderr);
  assertAccountGet(ctx.portal);
  return result;
}

async function dandelionOnceMatches(ctx, nodeOnce) {
  configure(ctx.portal);
  const again = await run(ctx, '--once', {}, { junieHome: ctx.junie });
  assert.equal(again.status, 0, describe('second --once', again));
  assert.equal(withoutClock(again.stdout), withoutClock(nodeOnce.stdout), describe('second --once drifted', again));

  configure(ctx.portal);
  const env = await envFor(ctx, {}, { junieHome: ctx.junie });
  const named = await spawnApp('dandelion', ['--once'], env);
  assert.equal(named.status, 0, describe('dandelion --once', named));
  assert.ok(named.stdout.length > 0, 'empty dandelion --once stdout');
  assert.ok(!named.stdout.includes(ENTER), describe('dandelion wrote alternate screen', named));
  assert.match(named.stdout.split('\n')[0], /^DANDELION +\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(withoutClock(named.stdout), withoutClock(nodeOnce.stdout), describe('dandelion --once drifted', named));
  assertNoTokens(named.stdout, named.stderr);
}

async function routeCases(ctx) {
  const rows = [
    ['live case junie 30% hermes 75%', 'route', liveCase(100), { junieHome: ctx.junie }, 5.5, 72, 'grok-4.7 xhigh grok', 0],
    ['live case hermes 0%', 'route', liveCase(100), { junieHome: ctx.junie }, 22, 72, 'x-ai/grok-4.7 xhigh hermes', 0],
    ['live case junie 0% hermes 0%', 'route', liveCase(100), { junieHome: ctx.full }, 22, 72, 'gemini-3.8-flash high junie', 0],
    ['live case --high', 'route --high', liveCase(100), { junieHome: ctx.junie }, 5.5, 72, 'claude-fable-5-1 max claude', 0],
    ['--high never uses hermes', 'route --high', {}, {}, 22, 72, 'none', 1],
    ['nothing windowed is available', 'route', {}, { authFile: join(ctx.hermesDir, 'missing.json') }, 5.5, 72, 'none', 1]
  ];
  for (const [label, args, usages, options, remaining, hours, line, code] of rows) {
    configure(ctx.portal, remaining, hours);
    const result = await run(ctx, args, usages, options);
    assert.deepEqual(
      { stdout: result.stdout, stderr: result.stderr, status: result.status },
      { stdout: `${line}\n`, stderr: '', status: code },
      describe(label, result)
    );
    assertNoTokens(result.stdout, result.stderr);
  }
}

async function dashboardNotRoute(ctx) {
  for (const args of ['--once route', 'routes']) {
    configure(ctx.portal);
    const result = await run(ctx, args, liveCase(100), { junieHome: ctx.junie });
    assert.equal(result.status, 0, describe(args, result));
    const first = result.stdout.split('\n')[0];
    assert.match(first, /^DANDELION +\d{2}:\d{2}:\d{2}Z$/, describe(args, result));
    assert.ok(!result.stdout.includes(ENTER), describe(`${args} wrote alternate screen`, result));
    assert.ok(!result.stdout.startsWith('grok-4.6'), describe(args, result));
    assert.ok(!result.stdout.startsWith('claude-fable'), describe(args, result));
    assert.ok(!result.stdout.startsWith('none\n'), describe(args, result));
  }
}

async function liveBoxesKeysKiloAndClaude(ctx) {
  configure(ctx.portal);
  const env = await envFor(ctx, liveCase(100), { junieHome: ctx.junie });
  const session = startLive(env);
  try {
    await waitSettled(session);
    const settled = frames(session).find((frame) => !frame.includes('probing…'));
    assert.ok(settled.split('\n')[0].startsWith('DANDELION'), settled);
    assert.equal(boxLinesOf(settled), boxPair('grok-4.7 xhigh', 'grok', 'claude-fable-5-1 max', 'claude'), settled);
    session.child.stdin.write('?');
    await waitFor(session, () => lastFrame(session).includes(HELP), 10000, 'help footer');
    session.child.stdin.write('k');
    await waitFor(session, () => panelLines(lastFrame(session), 'kilo')[0] === '▸ kilo', 10000, 'selected kilo');
    const pressedAt = Date.now();
    const firstAfter = session.frameStarts.length;
    session.child.stdin.write(' ');
    const caption = (frame) => panelLines(frame, 'kilo')[2];
    const indexWhere = (from, text) => frames(session).findIndex((frame, index) => index >= from && caption(frame) === text);
    await waitFor(session, () => indexWhere(firstAfter, NOT_ROUTABLE) >= 0, 10000, 'kilo not routable flash');
    const flashed = indexWhere(firstAfter, NOT_ROUTABLE);
    await waitFor(session, () => indexWhere(flashed, 'api balance · kilo') >= 0, 10000, 'kilo caption back');
    const back = indexWhere(flashed, 'api balance · kilo');
    const flashDelay = session.frameStarts[flashed] - pressedAt;
    const backDelay = session.frameStarts[back] - pressedAt;
    assert.ok(flashDelay < 1000, `the flash took ${flashDelay}ms to draw`);
    assert.ok(backDelay >= 1900 && backDelay <= 3000, `the caption came back after ${backDelay}ms`);
    assert.ok(frames(session).slice(firstAfter).every((frame) => !frame.includes('routing off')), 'a header shows routing off');
    await assert.rejects(stat(env.DANDELION_STATE_FILE), 'the kilo toggle wrote state');
    await quit(session);
  } finally {
    session.child.kill();
  }

  configure(ctx.portal);
  const toggleEnv = await envFor(ctx, liveCase(100), { junieHome: ctx.junie });
  const toggle = startLive(toggleEnv);
  try {
    await waitSettled(toggle);
    toggle.child.stdin.write('j');
    await waitFor(toggle, () => panelLines(lastFrame(toggle), 'claude')[0] === '▸ claude', 10000, 'selected claude');
    toggle.child.stdin.write(' ');
    const off = `▸ claude${' '.repeat(53)}routing off`;
    await waitFor(toggle, () => panelLines(lastFrame(toggle), 'claude')[0] === off, 10000, 'claude routing off');
    assert.equal([...off].length, 72);
    assert.deepEqual(JSON.parse(await readFile(toggleEnv.DANDELION_STATE_FILE, 'utf8')), { claude: false });
    await quit(toggle);
  } finally {
    toggle.child.kill();
  }
}

async function hermesOnlyFleet(ctx) {
  configure(ctx.portal, 3.3);
  const hotEnv = await envFor(ctx, {});
  const hot = startLive(hotEnv);
  try {
    await waitSettled(hot);
    const settled = frames(hot).find((frame) => !frame.includes('probing…'));
    assertCredits(panelLines(settled, 'hermes')[1], 85);
    assert.match(settled.split('\n')[1], /^1\/1 windows above 80% · next reset: hermes credits in (3d0h|2d23h)$/, settled);
    assert.equal(boxLinesOf(settled), boxPair('x-ai/grok-4.7 xhigh', 'hermes', 'none', 'no subscription available'), settled);
    await quit(hot);
  } finally {
    hot.child.kill();
  }

  configure(ctx.portal, 5.5);
  const calmEnv = await envFor(ctx, {});
  const calm = startLive(calmEnv);
  try {
    await waitSettled(calm);
    const settled = frames(calm).find((frame) => !frame.includes('probing…'));
    assertCredits(panelLines(settled, 'hermes')[1], 75);
    assert.match(settled.split('\n')[1], /^all windows below 80% · next reset: hermes credits in (3d0h|2d23h)$/, settled);
    await quit(calm);
  } finally {
    calm.child.kill();
  }
}

async function tenUnavailablePanels(ctx) {
  const home = await tempDir();
  await mkdir(join(home, '.claude-work'));
  const env = {
    HOME: home,
    PATH: ctx.nodeOnly,
    NO_COLOR: '1',
    DANDELION_GROK_HOME: ctx.empty,
    DANDELION_JUNIE_HOME: ctx.empty,
    DANDELION_CURSOR_AUTH_FILE: join(home, 'missing-cursor.json'),
    DANDELION_HERMES_AUTH_FILE: join(home, 'missing-hermes.json'),
    DANDELION_CLAUDE_WORK_CONFIG_DIR: join(home, '.claude-work')
  };
  const started = Date.now();
  const result = await spawnApp(process.execPath, [join(rootDir, 'src', 'main.ts'), '--once'], env);
  const elapsed = Date.now() - started;
  assert.equal(result.status, 0, describe('bare --once', result));
  assert.ok(elapsed < 5000, `bare --once took ${elapsed}ms`);
  assertOrder(result.stdout);
  for (const [id, reason, caption] of BARE_PANELS) {
    const lines = panelLines(result.stdout, id);
    assert.deepEqual(lines.slice(0, 3), [id, reason, caption], describe(`bare ${id}`, result));
    assert.ok(!lines.some((line) => line.includes('#') || / \d+%/.test(line)), `bare ${id} has a gauge:\n${lines.join('\n')}`);
  }
}

async function failuresExpiredMissing401(ctx) {
  await writeAuth(ctx.auth, { past: true });
  configure(ctx.portal);
  const expired = await run(ctx, '--once', {});
  assert.equal(expired.status, 0, describe('expired token', expired));
  assert.deepEqual(panelLines(expired.stdout, 'hermes').slice(0, 3), ['hermes', EXPIRED, 'hermes · hermes']);
  assert.deepEqual(ctx.portal.requests, [], 'expired token still requested the portal');
  assertNoTokens(expired.stdout, expired.stderr, EXPIRED);

  configure(ctx.portal);
  const missing = await run(ctx, '--once', {}, { authFile: join(ctx.hermesDir, 'missing.json') });
  assert.equal(missing.status, 0, describe('missing auth', missing));
  assert.deepEqual(panelLines(missing.stdout, 'hermes').slice(0, 3), ['hermes', NO_AUTH, 'hermes · hermes']);
  assert.deepEqual(ctx.portal.requests, [], 'missing auth still requested the portal');
  assertNoTokens(missing.stdout, missing.stderr, NO_AUTH);

  await writeAuth(ctx.auth);
  configure(ctx.portal, 5.5, 72, 'unauthorized');
  const started = Date.now();
  const unauthorized = await run(ctx, '--once', {});
  const elapsed = Date.now() - started;
  assert.equal(unauthorized.status, 0, describe('HTTP 401', unauthorized));
  assert.ok(elapsed < 5000, `401 took ${elapsed}ms`);
  assert.deepEqual(panelLines(unauthorized.stdout, 'hermes').slice(0, 3), ['hermes', HTTP_401, 'hermes · hermes']);
  assertNoTokens(unauthorized.stdout, unauthorized.stderr, HTTP_401);
  assert.equal((unauthorized.stdout.match(/qa-dummy-hermes-(agent-key|access)-016/g) || []).length, 0);
  assertAccountGet(ctx.portal);
  configure(ctx.portal);
}

async function readmeAndPackageJson() {
  const readme = await readFile(join(rootDir, 'README.md'), 'utf8');
  const providers = readme.split('\n').filter((line) => /^- `(claude|claude-work|agy|kimi|grok|codex|cursor|junie|hermes|kilo)` /.test(line));
  assert.deepEqual(providers.map((line) => line.split('`')[1]), NAMES);
  assert.ok(readme.includes('All ten probes run in parallel'));
  assert.ok(readme.includes('`--high` does not use hermes'));
  const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dandelion');
  assert.deepEqual(pkg.bin, { dandelion: 'src/main.ts' });
  assert.deepEqual(pkg.scripts, { start: 'node src/main.ts', test: 'vitest run', qa: 'node qa/e2e.mjs' });
  assert.equal(pkg.dependencies, undefined, 'package.json has a dependencies section');
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
    const hermesDir = await tempDir();
    const auth = join(hermesDir, 'auth.json');
    await writeAuth(auth);
    const junie = await tempDir();
    const empty = await tempDir();
    const full = await tempDir();
    const nodeOnly = await tempDir();
    await symlink(process.execPath, join(nodeOnly, 'node'));
    await symlink('/bin/sh', join(nodeOnly, 'sh'));
    await writeJunieHome(junie, 701512.73275);
    await writeJunieHome(full, 1000000);
    const ctx = { zone: localElevenZone(), cursor, portal, bin: await fixtureDir(), hermesDir, auth, junie, empty, full, nodeOnly };
    const nodeOnce = await onceDashboard(ctx);
    await dandelionOnceMatches(ctx, nodeOnce);
    await routeCases(ctx);
    await dashboardNotRoute(ctx);
    await liveBoxesKeysKiloAndClaude(ctx);
    await hermesOnlyFleet(ctx);
    await tenUnavailablePanels(ctx);
    await failuresExpiredMissing401(ctx);
    await readmeAndPackageJson();
  } finally {
    cursor.close();
    portal.server.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
