import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, readdir, symlink, cp, copyFile, realpath } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ROUTES_FILE } from './routes-fixture.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'dandelion-qa-021-';
const OUTER_TIMEOUT_MS = 60000;
const HOUR_MS = 3600000;
const AGENT = 'qa-dummy-hermes-agent-key-021';
const ACCESS = 'qa-dummy-hermes-access-021';
const QUOTA = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot';
const ENV_NAMES = { claude: 'Q_CLAUDE', work: 'Q_WORK', agy: 'Q_AGY', kimi: 'Q_KIMI' };
const CLEAR = '\x1b[H\x1b[2J';
const DIM = '\x1b[90m';
const RESET = '\x1b[0m';
const ERROR_ROW = `| routes file error${' '.repeat(15)}|`;

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
  }, extraUsage: null } }, request_id: 'qa-021' };
  http.createServer((req, res) => res.end(JSON.stringify(body))).listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/#token=t'));
} else process.exit(2);
`;

const LIVE_CASE = {
  claude: [2, 13, 130, 2, 130],
  work: [100, 72, 5.35, 52, 5.33],
  agy: [0, 17, 126],
  kimi: [0, 95, 73],
  grok: [9, 130],
  cursor: [36, 36, 33, 365]
};

const FULL = { claude: [3, 86, 72, 100, 72], work: [0, 12, 72, 23, 72], agy: [50, 50, 72], kimi: [85, 85, 72], grok: [90, 72], cursor: [80, 80, 80, 72] };

const high = (session, weekly, fable) => [session, weekly, 72, fable, 72];
const cursor = (used) => [used, used, used, 72];

const ROUTE_ROWS = [
  ['claude evaporates', { claude: [0, 86, 2], agy: [0, 0, 72] }, {}, 'model-a max claude', 0],
  ['claude headroom', { claude: [0, 3, 2], agy: [10, 10, 72] }, {}, 'model-a high claude', 0],
  ['claude-work headroom', { claude: [20, 30, 72], work: [10, 5, 72], agy: [15, 20, 72] }, {}, 'model-b high claude-work', 0],
  ['agy evaporates, tie', { agy: [0, 90, 2], kimi: [0, 90, 2] }, {}, 'model-c max agy', 0],
  ['one-word kimi line', { kimi: [10, 10, 72], grok: [50, 72] }, {}, 'model-d kimi', 0],
  ['grok', { grok: [50, 72] }, {}, 'model-e xhigh grok', 0],
  ['cursor', { cursor: cursor(40) }, {}, 'model-f cursor', 0],
  ['junie tie-breaker', {}, { junie: 0, hermes: 0 }, 'model-g high junie', 0],
  ['hermes', {}, { hermes: 75 }, 'vendor/model-h xhigh hermes', 0],
  ['014 live case', LIVE_CASE, { junie: 30, hermes: 75 }, 'model-e xhigh grok', 0],
  ['nothing routable', {}, {}, 'none', 1]
];

const HIGH_ROWS = [
  ['rank 1', { claude: high(3, 86, 10) }, 'model-h1 max claude', 0],
  ['rank 2', { claude: high(95, 10, 10), cursor: cursor(60) }, 'model-h2 cursor', 0],
  ['rank 3', { claude: high(10, 10, 95) }, 'model-h3 max claude', 0],
  ['rank 4', { claude: high(95, 10, 10), cursor: cursor(95), grok: [60, 72] }, 'model-h4 xhigh grok', 0],
  ['rank 5', { agy: [10, 10, 72] }, 'model-h5 high agy', 0],
  ['nothing on the chain', {}, 'none', 1]
];

const KEY_ORDER_ROWS = [
  ['route', { agy: [0, 90, 2], kimi: [0, 90, 2] }, {}, 'model-c max agy'],
  ['route', {}, { junie: 0, hermes: 0 }, 'model-g high junie'],
  ['route --high', { claude: high(3, 86, 10), agy: [10, 10, 72] }, {}, 'model-h1 max claude'],
  ['route --high', { claude: high(10, 10, 95), grok: [60, 72] }, {}, 'model-h3 max claude']
];

const KEY_FAULTS = [
  ['provider missing', (f) => delete f.route.hermes, 'hermes'],
  ['high entry missing', (f) => delete f.high.opus, 'opus'],
  ['max missing', (f) => delete f.route.agy.max, 'agy'],
  ['entry not an object', (f) => (f.route.claude = 'model-a high'), 'claude'],
  ['empty line', (f) => (f.route.kimi.standard = ''), 'kimi'],
  ['not a string', (f) => (f.high.grok = 4), 'grok'],
  ['provider typo', (f) => (f.route['claude-wrok'] = f.route.claude), 'claude-wrok'],
  ['codex is not routed', (f) => (f.route.codex = f.route.cursor), 'codex'],
  ['unknown high name', (f) => (f.high.sonnet = 'model-x'), 'sonnet'],
  ['unknown top-level key', (f) => (f.extra = {}), 'extra'],
  ['unknown entry key', (f) => (f.route.cursor.maxx = 'model-f'), 'maxx'],
  ['three words', (f) => (f.route.claude.max = 'model-a max extra'), 'claude'],
  ['leading space', (f) => (f.high.fable = ' model-h1 max'), 'fable'],
  ['trailing space', (f) => (f.route.grok.standard = 'model-e xhigh '), 'grok'],
  ['two spaces', (f) => (f.route.junie.max = 'model-g  high'), 'junie'],
  ['tab', (f) => (f.route.hermes.standard = 'vendor/model-h\txhigh'), 'hermes'],
  ['route not an object', (f) => (f.route = []), 'route'],
  ['high not an object', (f) => (f.high = 'x'), 'high']
];

const ROUTED = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'cursor', 'junie', 'hermes'];
const CHAIN = ['fable', 'cursor', 'opus', 'grok', 'agy'];

const temps = [];
const sessions = [];

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
  const portal = { remaining: 5.5 };
  const server = createHttpServer((req, res) => {
    const end = new Date(Date.now() + 72 * HOUR_MS).toISOString();
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
  const exp = new Date(Date.now() + 24 * HOUR_MS).toISOString().replace(/\.\d{3}Z$/, '+00:00');
  await writeFile(path, JSON.stringify({
    version: 1,
    providers: {
      nous: {
        access_token: ACCESS,
        refresh_token: 'qa-dummy-refresh-021',
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

async function junieHome(balance) {
  const dir = await tempDir();
  const now = Date.now();
  const quota = { type: `${QUOTA}.JetBrains`, balanceUnit: 'CREDITS', balanceLeft: balance };
  await mkdir(join(dir, 'sessions', 's-new'), { recursive: true });
  await writeFile(join(dir, 'sessions', 'index.jsonl'), JSON.stringify({
    sessionId: 's-new', createdAt: now - 4000000, updatedAt: now - 3000000, taskName: 'Pong'
  }) + '\n');
  await writeFile(join(dir, 'sessions', 's-new', 'events.jsonl'), JSON.stringify({
    kind: 'SessionA2uxEvent', event: { state: 'IN_PROGRESS' }, completion: { endedAtMs: now - HOUR_MS, taskCostUsd: 0.03, quota }, timestampMs: now - HOUR_MS
  }) + '\n');
  return dir;
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
          currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: new Date(now - 100 * HOUR_MS).toISOString(), end: new Date(now + hours * HOUR_MS).toISOString() }
        },
        subscriptionTier: 'SuperGrok'
      }
    }) + '\n');
  }
  if (usages.cursor) {
    await mkdir(join(home, '.config', 'cursor'), { recursive: true });
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-021"}');
  }
  return home;
}

async function envFor(ctx, usages, { credits = {}, routes = ROUTES_FILE, path = ctx.bin, color = false } = {}) {
  if (usages.cursor) ctx.cursor.usage = usages.cursor;
  if (credits.hermes !== undefined) ctx.portal.remaining = 22 * (1 - credits.hermes / 100);
  const vars = Object.fromEntries(Object.entries(ENV_NAMES)
    .filter(([name]) => usages[name])
    .map(([name, variable]) => [variable, usages[name].join(',')]));
  const home = await homeFor(usages);
  const env = {
    HOME: home,
    TZ: ctx.zone,
    PATH: path,
    SHELL: '/bin/sh',
    TERM: 'xterm',
    DANDELION_STATE_FILE: join(home, 'state', 'eligibility.json'),
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${ctx.cursor.address().port}`,
    DANDELION_JUNIE_HOME: credits.junie === undefined ? ctx.empty : ctx.junie[credits.junie],
    DANDELION_HERMES_AUTH_FILE: credits.hermes === undefined ? join(home, 'missing-hermes.json') : ctx.auth,
    DANDELION_HERMES_PORTAL_BASE: `http://127.0.0.1:${ctx.portal.server.address().port}`,
    DANDELION_REFRESH_SECONDS: '3600',
    ...(color ? {} : { NO_COLOR: '1' }),
    ...vars
  };
  if (routes !== null) env.DANDELION_ROUTES_FILE = routes;
  return env;
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
  const { main = join(rootDir, 'src', 'main.ts'), cwd = rootDir, ...rest } = options;
  const env = await envFor(ctx, usages, rest);
  return collect(spawn(process.execPath, [main, ...args.split(' ')], { cwd, env, timeout: OUTER_TIMEOUT_MS }));
}

function describe(label, result) {
  return `${label}\nexit ${result.status}\nstdout:\n${JSON.stringify(result.stdout)}\nstderr:\n${JSON.stringify(result.stderr)}`;
}

function assertLine(label, result, line, code = 0) {
  assert.deepEqual(result, { stdout: `${line}\n`, stderr: '', status: code }, describe(label, result));
}

function assertFault(label, result, path, names) {
  assert.equal(result.status, 2, describe(label, result));
  assert.equal(result.stdout, '', describe(label, result));
  assert.ok(result.stderr.startsWith(`dandelion: routes file ${path}: `), describe(label, result));
  assert.ok(result.stderr.endsWith('\n') && result.stderr.split('\n').length === 2, describe(`${label}: not one stderr line`, result));
  assert.ok(result.stderr.includes(names), describe(`${label}: does not name ${names}`, result));
}

async function fixtureRoutes() {
  return JSON.parse(await readFile(ROUTES_FILE, 'utf8'));
}

async function shippedRoutes() {
  return JSON.parse(await readFile(join(rootDir, 'routes.json'), 'utf8'));
}

async function routesFile(dir, name, routes) {
  const file = join(dir, name);
  await writeFile(file, typeof routes === 'string' ? routes : JSON.stringify(routes));
  return file;
}

async function linesOfF(ctx) {
  for (const [label, usages, credits, line, code] of ROUTE_ROWS) {
    assertLine(`route ${label}`, await run(ctx, 'route', usages, { credits }), line, code);
  }
  for (const [label, usages, line, code] of HIGH_ROWS) {
    assertLine(`route --high ${label}`, await run(ctx, 'route --high', usages), line, code);
  }
}

async function keyOrderMeansNothing(ctx) {
  const f = await fixtureRoutes();
  const reverse = (object) => Object.fromEntries(Object.entries(object).reverse());
  const r = await routesFile(await tempDir(), 'r.json', { high: reverse(f.high), route: reverse(f.route) });
  assert.ok((await readFile(r, 'utf8')).startsWith('{"high":{"agy":'), 'R does not start with the reversed high keys');
  for (const [args, usages, credits, line] of KEY_ORDER_ROWS) {
    assertLine(`R ${args} ${line}`, await run(ctx, args, usages, { credits, routes: r }), line);
  }
}

async function shippedLines(ctx) {
  const shipped = await shippedRoutes();
  for (const routes of [null, '']) {
    const label = routes === null ? 'unset' : 'empty';
    assertLine(`shipped ${label} claude headroom`, await run(ctx, 'route', { claude: [0, 3, 2], agy: [10, 10, 72] }, { routes }), `${shipped.route.claude.standard} claude`);
    assertLine(`shipped ${label} claude evaporates`, await run(ctx, 'route', { claude: [0, 86, 2] }, { routes }), `${shipped.route.claude.max} claude`);
    assertLine(`shipped ${label} --high opus`, await run(ctx, 'route --high', { claude: high(10, 10, 95) }, { routes }), `${shipped.high.opus} claude`);
    assertLine(`shipped ${label} grok`, await run(ctx, 'route', { grok: [50, 72] }, { routes }), `${shipped.route.grok.standard} grok`);
  }
}

async function linkedFromAnotherRepo(ctx) {
  const shipped = await shippedRoutes();
  const d = await tempDir();
  for (const sub of ['cwd', 'lib', 'bin']) await mkdir(join(d, sub));
  await symlink(rootDir, join(d, 'lib', 'dandelion'));
  await symlink(join(d, 'lib', 'dandelion', 'src', 'main.ts'), join(d, 'bin', 'dandelion'));
  const decoy = (await readFile(ROUTES_FILE, 'utf8')).replaceAll('model-', 'decoy-');
  for (const sub of ['cwd', 'lib', 'bin', '.']) await writeFile(join(d, sub, 'routes.json'), decoy);
  const through = async (routes) => {
    const env = await envFor(ctx, { grok: [50, 72] }, { routes, path: `${join(d, 'bin')}:${ctx.bin}` });
    return collect(spawn('dandelion', ['route'], { cwd: join(d, 'cwd'), env, timeout: OUTER_TIMEOUT_MS }));
  };
  for (const routes of [null, '']) {
    assertLine(`npm link with DANDELION_ROUTES_FILE ${routes === null ? 'unset' : 'empty'}`, await through(routes), `${shipped.route.grok.standard} grok`);
  }
  assertLine('relative DANDELION_ROUTES_FILE', await through('routes.json'), 'decoy-e xhigh grok');
}

async function badFilesAreErrors(ctx) {
  const dir = await tempDir();
  const f = await fixtureRoutes();
  const nope = join(dir, 'nope.json');
  const cases = [
    ['missing', nope, 'nope.json'],
    ['a folder', dir, dir],
    ['invalid JSON', await routesFile(await tempDir(), 'bad.json', '{"route":'), 'bad.json'],
    ['empty', await routesFile(await tempDir(), 'bad.json', ''), 'bad.json'],
    ['not an object', await routesFile(await tempDir(), 'bad.json', '[]'), 'bad.json'],
    ['top-level null', await routesFile(await tempDir(), 'bad.json', 'null'), 'bad.json']
  ];
  for (const [label, change, names] of KEY_FAULTS) {
    const broken = structuredClone(f);
    change(broken);
    cases.push([label, await routesFile(await tempDir(), 'bad.json', broken), names]);
  }
  for (const [label, file, names] of cases) {
    for (const args of ['route', 'route --high']) {
      assertFault(`${label} ${args}`, await run(ctx, args, { grok: [50, 72] }, { routes: file }), file, names);
    }
  }
  assertFault('a bad file wins over none', await run(ctx, 'route', {}, { routes: nope }), nope, 'nope.json');
}

async function copiedCheckout(ctx) {
  const c = await tempDir();
  await cp(join(rootDir, 'src'), join(c, 'src'), { recursive: true });
  await copyFile(join(rootDir, 'package.json'), join(c, 'package.json'));
  const main = join(c, 'src', 'main.ts');
  const real = join(await realpath(c), 'routes.json');
  for (const routes of [null, '']) {
    assertFault(`copy without routes.json, DANDELION_ROUTES_FILE ${routes === null ? 'unset' : 'empty'}`, await run(ctx, 'route', { grok: [50, 72] }, { main, routes }), real, 'routes.json');
  }
  assertLine('copy with F', await run(ctx, 'route', { grok: [50, 72] }, { main }), 'model-e xhigh grok');
  const edited = await shippedRoutes();
  edited.route.claude.standard = 'model-z high';
  await writeFile(join(c, 'routes.json'), JSON.stringify(edited));
  assertLine('one-line edit', await run(ctx, 'route', { claude: [0, 3, 2], agy: [10, 10, 72] }, { main, routes: null }), 'model-z high claude');
}

function startLive(env) {
  const child = spawn('/usr/bin/script', ['-qfec', `'${process.execPath}' src/main.ts`, '/dev/null'], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  const session = { child, output: '', stderr: '', closed: once(child, 'close') };
  child.stdout.setEncoding('utf8').on('data', (chunk) => (session.output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (session.stderr += chunk));
  sessions.push(session);
  return session;
}

function frames(session) {
  return session.output.replaceAll('\r\n', '\n').split(CLEAR).slice(1, -1);
}

function settledFrame(session) {
  return frames(session).find((frame) => !frame.includes('probing…'));
}

async function waitFor(session, predicate, boundMs, what) {
  const until = Date.now() + boundMs;
  while (!predicate()) {
    assert.ok(Date.now() < until, `no ${what} within ${boundMs}ms\nlast:\n${frames(session).at(-1) ?? ''}\nstderr:\n${session.stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function settledLive(env, what) {
  const session = startLive(env);
  await waitFor(session, () => settledFrame(session) !== undefined, 30000, what);
  session.child.stdin.write('q');
  assert.deepEqual(await session.closed, [0, null], `${what}: unexpected exit\noutput:\n${session.output}\nstderr:\n${session.stderr}`);
  return { frame: settledFrame(session), output: session.output };
}

function boxRows(frame) {
  return frame.split('\n').slice(2, 6);
}

function withoutClock(text) {
  return text.split('\n').slice(1).join('\n').replace(/(↻|in) \d+[dhm]\d*[hm]?/g, '$1 _');
}

async function wrokFile() {
  const broken = await fixtureRoutes();
  broken.route['claude-wrok'] = broken.route.claude;
  return routesFile(await tempDir(), 'bad.json', broken);
}

async function dashboardWithBadFile(ctx) {
  const bad = await wrokFile();
  const good = await settledLive(await envFor(ctx, FULL), 'settled dashboard with F');
  assert.deepEqual(boxRows(good.frame), [
    '+- route -------------------------+  +- route --high ------------------+',
    `| ${'model-b high'.padEnd(31)} |  | ${'model-h1 max'.padEnd(31)} |`,
    `| ${'claude-work'.padEnd(31)} |  | ${'claude-work'.padEnd(31)} |`,
    '+---------------------------------+  +---------------------------------+'
  ], good.frame);
  const faulty = await settledLive(await envFor(ctx, FULL, { routes: bad }), 'settled dashboard with a bad file');
  const [top, first, second, bottom] = boxRows(faulty.frame);
  assert.equal(top, boxRows(good.frame)[0], faulty.frame);
  assert.equal(bottom, boxRows(good.frame)[3], faulty.frame);
  assert.equal(first, `${ERROR_ROW}  ${ERROR_ROW}`, faulty.frame);
  const [left, right] = [second.slice(0, 35), second.slice(37)];
  assert.equal(second.slice(35, 37), '  ', faulty.frame);
  assert.equal(left, right, faulty.frame);
  assert.match(left, /^\| .{31} \|$/u, faulty.frame);
  assert.ok(left.includes('claude-wrok'), faulty.frame);
  const outside = (frame) => withoutClock(frame.split('\n').filter((_, index) => index < 2 || index > 5).join('\n'));
  assert.equal(outside(faulty.frame), outside(good.frame), `panels differ\nbad:\n${faulty.frame}\ngood:\n${good.frame}`);

  const colour = await settledLive(await envFor(ctx, FULL, { routes: bad, color: true }), 'coloured dashboard with a bad file');
  assert.ok(colour.output.includes(`${DIM}┌─ route ${'─'.repeat(25)}┐${RESET}`), 'dim route top border');
  assert.ok(colour.output.includes(`${DIM}└${'─'.repeat(33)}┘${RESET}`), 'dim bottom border');
  assert.ok(colour.output.includes(`${DIM}│ routes file error${' '.repeat(15)}│${RESET}`), 'row 1 is one dim span');
  assert.match(colour.output, /\x1b\[90m│ [^\x1b]*claude-wrok[^\x1b]*│\x1b\[0m/, 'row 2 is one dim span with the key');
  assert.ok(!colour.output.includes('\x1b[1m routes file error'), 'the error row is bold like a model line');
}

async function onceWithBadFile(ctx) {
  const bad = await run(ctx, '--once', FULL, { routes: await wrokFile() });
  const good = await run(ctx, '--once', FULL);
  assert.equal(bad.status, 0, describe('--once bad file', bad));
  assert.equal(good.status, 0, describe('--once F', good));
  assert.equal(withoutClock(bad.stdout), withoutClock(good.stdout), `--once output differs\nbad:\n${bad.stdout}\ngood:\n${good.stdout}`);
  assert.ok(bad.stderr.startsWith('dandelion: routes file ') && bad.stderr.split('\n').length === 2, describe('--once warning', bad));
  assert.ok(bad.stderr.includes('claude-wrok'), describe('--once warning key', bad));
  assert.equal(good.stderr, '', describe('--once F stderr', good));
}

async function livingSurfaces() {
  const procedure = await readFile(join(rootDir, 'qa', '021-route-lines-from-config.md'), 'utf8');
  const pattern = procedure.match(/`grep -rlE '([^']+)' src perf qa;/)[1];
  const grep = spawnSync('grep', ['-rlE', pattern, 'src', 'perf', 'qa'], { cwd: rootDir, encoding: 'utf8' });
  assert.equal(grep.stdout, 'qa/021-route-lines-from-config.md\n', `real model names outside the procedure:\n${grep.stdout}${grep.stderr}`);

  const readme = await readFile(join(rootDir, 'README.md'), 'utf8');
  assert.match(readme, /^## routes\.json$/m);
  assert.match(readme, /to change a routed model, edit routes\.json/i);
  assert.match(readme, /^- `DANDELION_ROUTES_FILE` - /m);
  assert.match(readme, /exits? 2|exit code 2|exit 2/);
  for (const id of ROUTED) assert.ok(readme.includes(`| ${id} | \`route.${id}.standard\` | \`route.${id}.max\` |`), `README route row ${id}`);
  CHAIN.forEach((name, index) => assert.match(readme, new RegExp(`^\\| ${index + 1} \\| [^\\n]*\\| \`high\\.${name}\` \\|$`, 'm'), `README --high rank ${index + 1}`));
  const shipped = await shippedRoutes();
  const lines = [...Object.values(shipped.route).flatMap(Object.values), ...Object.values(shipped.high)];
  const tableRows = readme.split('\n').filter((row) => row.startsWith('|'));
  for (const line of lines) assert.ok(!tableRows.some((row) => row.includes(line)), `a README table holds the line ${line}`);

  const history = spawnSync('git', ['diff', '--stat', 'd99c410', '--', 'tasks/0[01]*', 'tasks/020*', 'features/0[01]*', 'features/020*', ':!tasks/019*', ':!features/019*'], { cwd: rootDir, encoding: 'utf8' });
  assert.equal(history.status, 0, history.stderr);
  assert.equal(history.stdout, '', `historical tasks or features changed:\n${history.stdout}`);
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

export default async function () {
  const cursorServer = await cursorApi();
  const portal = await hermesPortal();
  try {
    const auth = join(await tempDir(), 'auth.json');
    await writeAuth(auth);
    const ctx = {
      zone: localElevenZone(),
      bin: await fixtureDir(),
      cursor: cursorServer,
      portal,
      auth,
      empty: await tempDir(),
      junie: { 0: await junieHome(1000000), 30: await junieHome(701512.73275) }
    };
    await linesOfF(ctx);
    await keyOrderMeansNothing(ctx);
    await shippedLines(ctx);
    await linkedFromAnotherRepo(ctx);
    await badFilesAreErrors(ctx);
    await copiedCheckout(ctx);
    await dashboardWithBadFile(ctx);
    await onceWithBadFile(ctx);
    await livingSurfaces();
  } finally {
    for (const session of sessions.splice(0)) if (session.child.exitCode === null) session.child.kill('SIGKILL');
    portal.server.close();
    cursorServer.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
