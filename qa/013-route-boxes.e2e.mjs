import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, readdir, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { rootDir, launch, startLive, waitWithin, completeFrames, assertClosed } from './live-session.mjs';

const PREFIX = 'dandelion-qa-013-';
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

const SLOW_KILO = `#!/usr/bin/env node
setTimeout(() => console.log('Balance: $14.15'), 3000);
`;

const FULL = { claude: [3, 86, 100], work: [0, 12, 23], agy: [50, 50, 72], kimi: [85, 85, 72], grok: [90, 72], cursor: [80, 80, 80, 72] };
const ENV_NAMES = { claude: 'H_CLAUDE', work: 'H_WORK', agy: 'Q_AGY', kimi: 'Q_KIMI' };

const BOX_TOP = '+- route -------------------------+  +- route --high ------------------+';
const BOX_BOTTOM = '+---------------------------------+  +---------------------------------+';
const block = (model, account, highModel, highAccount) =>
  [BOX_TOP, `| ${model.padEnd(31)} |  | ${highModel.padEnd(31)} |`, `| ${account.padEnd(31)} |  | ${highAccount.padEnd(31)} |`, BOX_BOTTOM].join('\n');

const SETTLED_BLOCK = [
  BOX_TOP,
  '| claude-opus-5 high              |  | claude-fable-5-1 max            |',
  '| claude-work                     |  | claude-work                     |',
  BOX_BOTTOM
].join('\n');
const TOGGLED_BLOCK = block('gemini-3.1-pro-high medium', 'agy', 'kimi-k3-max', 'cursor');
const NONE_BLOCK = block('none', 'no subscription available', 'none', 'no subscription available');
const KIMI_BLOCK = block('kimi-code/kimi-for-coding-high…', 'kimi', 'none', 'no subscription available');
const probingBlock = (spinner) => block(`${spinner} probing…`, '', `${spinner} probing…`, '');

const ESCAPES_ONLY = ['\x1b[2J', '\x1b[H', '\x1b[?1049h', '\x1b[?1049l', '\x1b[?25h', '\x1b[?25l'];

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

async function slowKiloDir() {
  const dir = await tempDir();
  await writeFile(join(dir, 'kilo'), SLOW_KILO);
  await chmod(join(dir, 'kilo'), 0o755);
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
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-013"}');
  }
  return home;
}

async function envFor(ctx, usages, { color = false, slowKilo = '' } = {}) {
  if (usages.cursor) ctx.cursor.usage = usages.cursor;
  const vars = Object.fromEntries(Object.entries(ENV_NAMES).filter(([name]) => usages[name]).map(([name, variable]) => [variable, usages[name].join(',')]));
  const home = await homeFor(usages);
  const inherited = { ...process.env };
  for (const name of Object.keys(inherited)) if (name.startsWith('DANDELION_') || name === 'CLAUDE_CONFIG_DIR' || name === 'NO_COLOR') delete inherited[name];
  return {
    ...inherited,
    HOME: home,
    PATH: `${slowKilo ? `${slowKilo}:` : ''}${ctx.bin}`,
    SHELL: '/bin/sh',
    TERM: 'xterm',
    TZ: 'UTC',
    ...(color ? {} : { NO_COLOR: '1' }),
    DANDELION_REFRESH_SECONDS: '3600',
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${ctx.cursor.address().port}`,
    DANDELION_GROK_HOME: join(home, '.grok'),
    DANDELION_CLAUDE_WORK_CONFIG_DIR: join(home, '.claude-work'),
    DANDELION_STATE_FILE: join(home, 'state', 'eligibility.json'),
    ...vars
  };
}

function send(run, key) {
  run.child.stdin.write(key);
}

function boxLinesOf(frame) {
  return frame.split('\n').slice(2, 6).join('\n');
}

function lastFrame(run) {
  return completeFrames(run).at(-1) ?? '';
}

function rowText(row, box) {
  return row.slice(box * 37 + 2, box * 37 + 33).trimEnd();
}

async function cli(env, args) {
  const run = launch(process.execPath, [join(rootDir, 'src', 'main.ts'), ...args], env);
  const [status] = await run.closed;
  return { output: run.output, stderr: run.stderr, status };
}

async function probingSettleAndRefresh(ctx) {
  const run = startLive(await envFor(ctx, FULL, { slowKilo: await slowKiloDir() }));
  await waitWithin(run, () => completeFrames(run).length > 0, 20000, 'first frame');
  assert.equal(boxLinesOf(completeFrames(run)[0]), probingBlock('⠋'), 'first frame shows probing boxes');
  const kiloPending = (frame) => /\nkilo\n\S probing…/.test(frame) && frame.includes('claude · personal · claude');
  await waitWithin(run, () => completeFrames(run).some((frame) => boxLinesOf(frame) === SETTLED_BLOCK), 20000, 'settled boxes');
  const pendingFrames = completeFrames(run).filter(kiloPending);
  assert.ok(pendingFrames.length > 0, 'frames with only kilo pending were captured');
  assert.ok(pendingFrames.every((frame) => boxLinesOf(frame).includes('probing…')), 'boxes probe while kilo does');
  assert.ok(new Set(pendingFrames.map(boxLinesOf)).size > 1, 'box spinner advances while kilo is pending');
  const settled = completeFrames(run).find((frame) => boxLinesOf(frame) === SETTLED_BLOCK);
  assert.equal(settled.split('\n')[6], '='.repeat(72), 'the first panel rule follows the boxes');
  assert.equal(settled.split('\n')[7], 'claude', 'the claude panel follows the boxes');
  send(run, 'r');
  await waitWithin(run, () => lastFrame(run).split('\n')[0].includes('refreshing…'), 20000, 'refreshing banner');
  assert.equal(boxLinesOf(lastFrame(run)), SETTLED_BLOCK, 'boxes keep the settled answers on the refresh frame');
  await waitWithin(run, () => completeFrames(run).length > 0 && !lastFrame(run).split('\n')[0].includes('refreshing…') && lastFrame(run).includes('kilo'), 20000, 'refresh round settled');
  const refreshing = completeFrames(run).filter((frame) => frame.split('\n')[0].includes('refreshing…'));
  assert.ok(refreshing.length > 0, 'refresh frames were captured');
  for (const frame of refreshing) {
    assert.equal(boxLinesOf(frame), SETTLED_BLOCK, 'boxes keep the previous answers mid-refresh');
    assert.ok(!frame.includes('probing…'), 'no panel goes pending during a refresh');
  }
  assert.equal(boxLinesOf(lastFrame(run)), SETTLED_BLOCK, 'same fixture settles to the same boxes');
  send(run, 'q');
  await assertClosed(run);
  const escapes = new Set(run.output.match(/\x1b\[[0-9;?]*[a-zA-Z]/g) ?? []);
  for (const escape of escapes) assert.ok(ESCAPES_ONLY.includes(escape), `unexpected escape under NO_COLOR: ${JSON.stringify(escape)}`);
}

async function toggleRecomputes(ctx) {
  const env = await envFor(ctx, FULL);
  const run = startLive(env);
  await waitWithin(run, () => boxLinesOf(lastFrame(run)) === SETTLED_BLOCK, 20000, 'settled boxes');
  send(run, 'j');
  send(run, 'j');
  await waitWithin(run, () => lastFrame(run).includes('\n▸ claude-work\n'), 20000, 'claude-work selected');
  assert.ok(!boxLinesOf(lastFrame(run)).includes('▸'), 'no box line is selectable');
  send(run, ' ');
  await waitWithin(run, () => boxLinesOf(lastFrame(run)) === TOGGLED_BLOCK, 20000, 'toggled boxes on the same frame');
  assert.ok(lastFrame(run).includes('▸ claude-work') && lastFrame(run).includes('routing off'), 'the claude-work header shows routing off');
  assert.deepEqual(JSON.parse(await readFile(env.DANDELION_STATE_FILE, 'utf8')), { 'claude-work': false });
  send(run, ' ');
  await waitWithin(run, () => boxLinesOf(lastFrame(run)) === SETTLED_BLOCK, 20000, 'boxes back after the second space');
  assert.deepEqual(JSON.parse(await readFile(env.DANDELION_STATE_FILE, 'utf8')), { 'claude-work': true });
  send(run, 'q');
  await assertClosed(run);
}

async function nothingToRoute(ctx) {
  const run = startLive(await envFor(ctx, {}));
  await waitWithin(run, () => boxLinesOf(lastFrame(run)) === NONE_BLOCK, 20000, 'none boxes');
  assert.ok(lastFrame(run).includes('\ncodex\napi-key billing · no usage windows\n'), 'codex is ok but not routable');
  assert.ok(lastFrame(run).includes('\nkilo\n'), 'kilo is ok but not routable');
  send(run, 'q');
  await assertClosed(run);
}

async function kimiTruncation(ctx) {
  const run = startLive(await envFor(ctx, { kimi: [10, 10, 72] }));
  await waitWithin(run, () => boxLinesOf(lastFrame(run)) === KIMI_BLOCK, 20000, 'kimi boxes');
  send(run, 'q');
  await assertClosed(run);
}

async function colourSpans(ctx) {
  const run = startLive(await envFor(ctx, FULL, { color: true }));
  const boldModel = `\x1b[1m claude-opus-5 high${' '.repeat(14)}\x1b[0m`;
  await waitWithin(run, () => run.output.includes(boldModel), 20000, 'coloured settled boxes');
  const output = run.output;
  assert.ok(output.includes(`\x1b[90m┌─ route ${'─'.repeat(25)}┐\x1b[0m`), 'dim top border with title');
  assert.ok(output.includes(`\x1b[90m│\x1b[0m${boldModel}\x1b[90m│\x1b[0m`), 'bold route model line');
  assert.ok(output.includes(`\x1b[1m claude-fable-5-1 max${' '.repeat(12)}\x1b[0m`), 'bold route --high model line');
  assert.ok(output.includes(`\x1b[90m│\x1b[0m claude-work${' '.repeat(21)}\x1b[90m│\x1b[0m`), 'plain account row');
  assert.ok(output.includes(`\x1b[90m└${'─'.repeat(33)}┘\x1b[0m`), 'dim bottom border');
  send(run, 'q');
  await assertClosed(run);
}

async function routeCliMatches(ctx) {
  const env = await envFor(ctx, FULL);
  const route = await cli(env, ['route']);
  const high = await cli(env, ['route', '--high']);
  assert.equal(route.status, 0, `route exits 0\n${route.stderr}`);
  assert.equal(high.status, 0, `route --high exits 0\n${high.stderr}`);
  const rows = SETTLED_BLOCK.split('\n');
  assert.equal(route.output, `${rowText(rows[1], 0)} ${rowText(rows[2], 0)}\n`, 'the route box rows are the route line split');
  assert.equal(high.output, `${rowText(rows[1], 1)} ${rowText(rows[2], 1)}\n`, 'the route --high box rows are the route --high line split');
}

async function onceHasNoBoxes(ctx) {
  const result = await cli(await envFor(ctx, FULL), ['--once']);
  assert.equal(result.status, 0, `--once exits 0\n${result.stderr}`);
  assert.match(result.output.split('\n')[0], /^DANDELION +\d{2}:\d{2}:\d{2}Z$/, 'banner first');
  assert.equal(result.output.split('DANDELION').length, 2, 'one dashboard');
  assert.ok(!result.output.includes('+- route') && !result.output.includes('─ route'), 'no box titles');
  assert.ok(!result.output.split('\n').some((line) => /^[+|]/.test(line)), 'no box borders');
  assert.ok(!result.output.includes('probing…'), 'no pending panels in once mode');
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
    const ctx = { cursor: server, bin: await fixtureDir() };
    await probingSettleAndRefresh(ctx);
    await toggleRecomputes(ctx);
    await nothingToRoute(ctx);
    await kimiTruncation(ctx);
    await colourSpans(ctx);
    await routeCliMatches(ctx);
    await onceHasNoBoxes(ctx);
  } finally {
    server.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
