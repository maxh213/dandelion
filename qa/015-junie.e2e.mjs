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
const PREFIX = 'dandelion-qa-015-';
const OUTER_TIMEOUT_MS = 60000;
const HOUR_MS = 3600000;
const CLEAR = '\x1b[H\x1b[2J';
const CALM = '\x1b[32m';
const DIM = '\x1b[90m';
const NOT_ROUTABLE = 'not routable (no usage windows)';
const UNAVAILABLE = 'no junie quota snapshot — run junie once';
const NAMES = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];
const QUOTA = 'com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot';

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

async function writeJunieHome(dir, balance, { newestAgoMs = HOUR_MS, dropNewest = false } = {}) {
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
    ...(dropNewest ? [] : [quotaLine(now - newestAgoMs, 'JetBrains', balance)])
  ].join('\n') + '\n';
  await writeFile(join(dir, 'sessions', 's-new', 'events.jsonl'), newest);
}

async function snapshotTree(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    const info = await stat(path);
    const content = entry.isFile() ? await readFile(path, 'utf8') : '';
    records.push([path, info.size, info.mtimeMs, content]);
  }
  return records.sort(([a], [b]) => a.localeCompare(b));
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
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-015"}');
  }
  return home;
}

async function envFor(ctx, usages, { state, extraEnv = {}, junieHome, color = false } = {}) {
  if (usages.cursor) ctx.cursor.usage = usages.cursor;
  const vars = Object.fromEntries(Object.entries(ENV_NAMES)
    .filter(([name]) => usages[name])
    .map(([name, variable]) => [variable, usages[name].join(',')]));
  const home = await homeFor(usages, state);
  return {
    HOME: home,
    TZ: ctx.zone,
    PATH: ctx.bin,
    SHELL: '/bin/sh',
    TERM: 'xterm',
    DANDELION_STATE_FILE: join(home, 'state', 'eligibility.json'),
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${ctx.cursor.address().port}`,
    DANDELION_JUNIE_HOME: junieHome ?? ctx.junie,
    DANDELION_HERMES_AUTH_FILE: join(home, 'missing-hermes.json'),
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

async function run(ctx, args, usages, options = {}) {
  const env = await envFor(ctx, usages, options);
  const argv = args === '' ? [] : args.split(' ');
  const child = spawn(process.execPath, [join(rootDir, 'src', 'main.ts'), ...argv], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
  return collect(child);
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

function assertAge(line, hours) {
  const expected = hours >= 48 ? new RegExp(`^stale snapshot ${Math.floor(hours / 24)}d0h old$`) : new RegExp(`^snapshot ${hours}h[01]m old$`);
  assert.match(line, expected, `age line: ${JSON.stringify(line)}`);
}

function startLive(env) {
  const child = spawn('/usr/bin/script', ['-qfec', `stty rows 60 cols 80; '${process.execPath}' src/main.ts`, '/dev/null'], { cwd: rootDir, env: { ...env, PATH: `${env.PATH}:/usr/bin` }, timeout: OUTER_TIMEOUT_MS });
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
  let lastError;
  while (Date.now() < until) {
    try {
      if (predicate()) return;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (lastError) throw lastError;
  assert.fail(`no ${what} within ${boundMs}ms\nlast frame:\n${lastFrame(run)}\nstderr:\n${run.stderr}`);
}

async function waitSettled(run) {
  await waitFor(run, () => frames(run).some((frame) => !frame.includes('probing…')), 30000, 'settled frame');
}

async function quit(run) {
  run.child.stdin.write('q');
  assert.deepEqual(await run.closed, [0, null], `unexpected exit\noutput:\n${run.output}\nstderr:\n${run.stderr}`);
}

async function happyPathAndReferences(ctx) {
  const before = await snapshotTree(ctx.junie);
  const result = await run(ctx, '--once', { claude: [0, 20, 72], grok: [9, 130] });
  assert.equal(result.status, 0, describe('happy --once', result));
  assert.equal(result.stderr, '');
  assertOrder(result.stdout);
  const junie = panelLines(result.stdout, 'junie');
  assert.deepEqual(junie.slice(0, 2), ['junie', creditsRow(30)]);
  assert.ok(!junie[1].includes('↻'), `credits row has a countdown:\n${junie[1]}`);
  assertAge(junie[2], 1);
  assert.equal(junie[3], '701513 credits · junie');
  assertWidth(result.stdout);
  assert.deepEqual(await snapshotTree(ctx.junie), before, 'junie home changed during the happy-path run');

  const colour = await run(ctx, '--once', { claude: [0, 20, 72], grok: [9, 130] }, { color: true });
  assert.equal(colour.status, 0, describe('colour --once', colour));
  assert.ok(colour.stdout.includes(`${CALM}${'█'.repeat(6)}${'░'.repeat(14)}\x1b[0m ${CALM} 30%\x1b[0m`), `junie gauge is not calm:\n${colour.stdout}`);
  assert.ok(colour.stdout.includes(`${DIM}snapshot `), `snapshot line is not dim:\n${colour.stdout}`);
  assert.ok(colour.stdout.includes(`${DIM}701513 credits · junie\x1b[0m`), `caption is not dim:\n${colour.stdout}`);

  const emptyRef = await run(ctx, '--once', {}, { extraEnv: { DANDELION_JUNIE_REFERENCE: '' } });
  assert.equal(emptyRef.status, 0, describe('empty reference', emptyRef));
  const emptyLines = panelLines(emptyRef.stdout, 'junie');
  assert.equal(emptyLines[1], 'balance without a reference');
  assertAge(emptyLines[2], 1);
  assert.equal(emptyLines[3], '701513 credits · junie');
  assert.ok(!emptyLines.some((line) => line.includes('#') || line.includes('%')), `empty-reference panel has a gauge:\n${emptyRef.stdout}`);

  const badRef = await run(ctx, '--once', {}, { extraEnv: { DANDELION_JUNIE_REFERENCE: 'abc' } });
  assert.equal(panelLines(badRef.stdout, 'junie')[1], creditsRow(30), describe('abc reference', badRef));

  const twoM = await run(ctx, '--once', {}, { extraEnv: { DANDELION_JUNIE_REFERENCE: '2000000' } });
  assert.equal(panelLines(twoM.stdout, 'junie')[1], creditsRow(65), describe('reference 2000000', twoM));
}

async function balancesFallbackAndStale(ctx) {
  await writeJunieHome(ctx.junie, 1000000);
  const full = await run(ctx, '--once', {});
  const fullLines = panelLines(full.stdout, 'junie');
  assert.equal(fullLines[1], creditsRow(0), describe('full balance', full));
  assert.equal(fullLines[3], '1000000 credits · junie');

  await writeJunieHome(ctx.junie, 0);
  const zero = await run(ctx, '--once', {});
  const zeroLines = panelLines(zero.stdout, 'junie');
  assert.equal(zeroLines[1], creditsRow(100), describe('zero balance', zero));
  assert.equal(zeroLines[3], '0 credits · junie');

  await writeJunieHome(ctx.junie, 701512.73275, { dropNewest: true });
  const fallback = await run(ctx, '--once', {});
  const older = panelLines(fallback.stdout, 'junie');
  assert.equal(older[1], creditsRow(10), describe('fallback', fallback));
  assertAge(older[2], 3);
  assert.equal(older[3], '900000 credits · junie');

  await writeJunieHome(ctx.junie, 701512.73275, { newestAgoMs: 3 * 86400000 });
  const stale = await run(ctx, '--once', {});
  const staleLines = panelLines(stale.stdout, 'junie');
  assert.equal(staleLines[1], creditsRow(30), describe('stale row', stale));
  assertAge(staleLines[2], 72);
  const staleColour = await run(ctx, '--once', {}, { color: true });
  assert.ok(staleColour.stdout.includes(`${DIM}${'━'.repeat(72)}\njunie\n`), `stale panel is not dim:\n${staleColour.stdout}`);
  const junieBlock = staleColour.stdout.slice(staleColour.stdout.indexOf('\njunie\n'), staleColour.stdout.indexOf('\nhermes\n'));
  assert.ok(!junieBlock.includes(CALM), `stale gauge still has a ramp escape:\n${junieBlock}`);
  await writeJunieHome(ctx.junie, 701512.73275);
}

async function emptyHomeUnchanged(ctx) {
  const before = await snapshotTree(ctx.empty);
  const empty = await run(ctx, '--once', {}, { junieHome: ctx.empty });
  assert.equal(empty.status, 0, describe('empty home', empty));
  assert.equal(empty.signal, null);
  assert.deepEqual(panelLines(empty.stdout, 'junie').slice(0, 3), ['junie', UNAVAILABLE, 'junie · junie']);
  assertOrder(empty.stdout);
  assert.deepEqual(await snapshotTree(ctx.empty), before, 'empty junie home changed');

  const missing = join(ctx.empty, 'nowhere');
  const gone = await run(ctx, '--once', {}, { junieHome: missing });
  assert.equal(gone.status, 0, describe('missing home', gone));
  assert.deepEqual(panelLines(gone.stdout, 'junie').slice(0, 3), ['junie', UNAVAILABLE, 'junie · junie']);
  await assert.rejects(stat(missing), 'missing junie home was created');
}

async function routeCases(ctx) {
  const rows = [
    ['junie beats grok 50', 'route', { grok: [50, 72] }, {}, 'gemini-3.8-flash high junie', 0],
    ['empty reference skips junie', 'route', { grok: [50, 72] }, { extraEnv: { DANDELION_JUNIE_REFERENCE: '' } }, 'grok-4.6 xhigh grok', 0],
    ['empty reference alone', 'route', {}, { extraEnv: { DANDELION_JUNIE_REFERENCE: '' } }, 'none', 1],
    ['live case junie 30%', 'route', liveCase(100), {}, 'grok-4.6 xhigh grok', 0],
    ['live case junie 0%', 'route', liveCase(100), { junieHome: ctx.full }, 'gemini-3.8-flash high junie', 0],
    ['live case empty reference', 'route', liveCase(100), { junieHome: ctx.full, extraEnv: { DANDELION_JUNIE_REFERENCE: '' } }, 'grok-4.6 xhigh grok', 0],
    ['live case junie ineligible', 'route', liveCase(100), { junieHome: ctx.full, state: '{"junie": false}' }, 'grok-4.6 xhigh grok', 0],
    ['live case --high', 'route --high', liveCase(100), {}, 'claude-fable-5-1 max claude', 0],
    ['--high never uses junie', 'route --high', {}, { junieHome: ctx.full }, 'none', 1]
  ];
  for (const [label, args, usages, options, line, code] of rows) {
    const result = await run(ctx, args, usages, options);
    assert.deepEqual(
      { stdout: result.stdout, stderr: result.stderr, status: result.status },
      { stdout: `${line}\n`, stderr: '', status: code },
      describe(label, result)
    );
  }
}

async function liveToggleAndFlash(ctx) {
  const env = await envFor(ctx, { grok: [9, 130] });
  const session = startLive(env);
  try {
    await waitSettled(session);
    session.child.stdin.write('k');
    await waitFor(session, () => panelLines(lastFrame(session), 'kilo')[0] === '▸ kilo', 10000, 'selected kilo');
    session.child.stdin.write('k');
    await waitFor(session, () => panelLines(lastFrame(session), 'hermes')[0].startsWith('▸ hermes'), 10000, 'selected hermes');
    session.child.stdin.write('k');
    await waitFor(session, () => panelLines(lastFrame(session), 'junie')[0].startsWith('▸ junie'), 10000, 'selected junie');
    session.child.stdin.write(' ');
    const off = `▸ junie${' '.repeat(54)}routing off`;
    await waitFor(session, () => panelLines(lastFrame(session), 'junie')[0] === off, 10000, 'junie routing off');
    assert.equal([...off].length, 72);
    assert.ok(lastFrame(session).includes('grok-4.6 xhigh'), lastFrame(session));
    assert.deepEqual(JSON.parse(await readFile(env.DANDELION_STATE_FILE, 'utf8')), { junie: false });
    await quit(session);
  } finally {
    session.child.kill();
  }

  const flashEnv = await envFor(ctx, { grok: [9, 130] }, { extraEnv: { DANDELION_JUNIE_REFERENCE: '' } });
  const flash = startLive(flashEnv);
  try {
    await waitSettled(flash);
    flash.child.stdin.write('k');
    await waitFor(flash, () => panelLines(lastFrame(flash), 'kilo')[0] === '▸ kilo', 10000, 'selected kilo');
    flash.child.stdin.write('k');
    await waitFor(flash, () => panelLines(lastFrame(flash), 'hermes')[0] === '▸ hermes', 10000, 'selected hermes');
    flash.child.stdin.write('k');
    await waitFor(flash, () => panelLines(lastFrame(flash), 'junie')[0] === '▸ junie', 10000, 'selected junie');
    const pressedAt = Date.now();
    const firstAfter = flash.frameStarts.length;
    flash.child.stdin.write(' ');
    const caption = (frame) => panelLines(frame, 'junie').at(-1);
    const indexWhere = (from, text) => frames(flash).findIndex((frame, index) => index >= from && caption(frame) === text);
    await waitFor(flash, () => indexWhere(firstAfter, NOT_ROUTABLE) >= 0, 10000, 'junie not routable flash');
    const flashed = indexWhere(firstAfter, NOT_ROUTABLE);
    await waitFor(flash, () => indexWhere(flashed, '701513 credits · junie') >= 0, 10000, 'junie caption back');
    const back = indexWhere(flashed, '701513 credits · junie');
    const flashDelay = flash.frameStarts[flashed] - pressedAt;
    const backDelay = flash.frameStarts[back] - pressedAt;
    assert.ok(flashDelay < 1000, `the flash took ${flashDelay}ms to draw`);
    assert.ok(backDelay >= 1900 && backDelay <= 3000, `the caption came back after ${backDelay}ms`);
    assert.ok(frames(flash).slice(firstAfter).every((frame) => !frame.includes('routing off')), 'a header shows routing off');
    await assert.rejects(stat(flashEnv.DANDELION_STATE_FILE), 'the unreferenced toggle wrote state');
    await quit(flash);
  } finally {
    flash.child.kill();
  }
}

async function fleetSummary(ctx) {
  await writeJunieHome(ctx.junie, 150000);
  const hotEnv = await envFor(ctx, {});
  const hot = startLive(hotEnv);
  try {
    await waitSettled(hot);
    const settled = frames(hot).find((frame) => !frame.includes('probing…'));
    assert.equal(panelLines(settled, 'junie')[1], creditsRow(85), settled);
    assert.equal(settled.split('\n')[1], '1/1 windows above 80% · next reset: none', settled);
    await quit(hot);
  } finally {
    hot.child.kill();
  }

  const noneEnv = await envFor(ctx, {}, { extraEnv: { DANDELION_JUNIE_REFERENCE: '' } });
  const none = startLive(noneEnv);
  try {
    await waitSettled(none);
    const settled = frames(none).find((frame) => !frame.includes('probing…'));
    assert.equal(settled.split('\n')[1], 'all windows below 80% · next reset: none', settled);
    await quit(none);
  } finally {
    none.child.kill();
  }
  await writeJunieHome(ctx.junie, 701512.73275);
}

async function readmeDocumentsJunie() {
  const readme = await readFile(join(rootDir, 'README.md'), 'utf8');
  assert.match(readme, /^- `junie` - reads the newest completion snapshot from `<junie home>\/sessions\/<id>\/events\.jsonl`/m);
  assert.ok(readme.includes('All ten probes run in parallel'));
  assert.match(readme, /^- `DANDELION_JUNIE_HOME` - .*Defaults to `~\/\.junie`.*never writes to it/m);
  assert.match(readme, /^- `DANDELION_JUNIE_REFERENCE` - .*Defaults to `1000000`.*empty string, there is no reference/m);
  assert.ok(readme.includes('| junie | `gemini-3.8-flash high` | `gemini-3.8-flash high` |'));
  assert.ok(readme.includes('junie credits'));
  assert.ok(readme.includes('`--high` does not use junie'));
  const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
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
  const server = await cursorApi();
  try {
    const junie = await tempDir();
    const empty = await tempDir();
    const full = await tempDir();
    await writeJunieHome(junie, 701512.73275);
    await writeJunieHome(full, 1000000);
    const ctx = { zone: localElevenZone(), cursor: server, bin: await fixtureDir(), junie, empty, full };
    await happyPathAndReferences(ctx);
    await balancesFallbackAndStale(ctx);
    await emptyHomeUnchanged(ctx);
    await routeCases(ctx);
    await liveToggleAndFlash(ctx);
    await fleetSummary(ctx);
    await readmeDocumentsJunie();
  } finally {
    server.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
