import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, readdir, readlink, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ROUTES_FILE } from './routes-fixture.mjs';
import { rootDir, launch, startLive, waitWithin, assertClosed, ENTER, CLEAR, RESTORE } from './live-session.mjs';

const PREFIX = 'dandelion-qa-019-';
const HOUR_MS = 3600000;
const IDS = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'junie', 'hermes', 'kilo'];
const HELP = 'keys: ↑↓/jk move · space on/off · g graph · r refresh · q quit · ? help';
const BOX_TOP = '+- route -------------------------+  +- route --high ------------------+';
const BOX_BOTTOM = '+---------------------------------+  +---------------------------------+';
const SETTLED_BLOCK = [
  BOX_TOP,
  '| model-b high                    |  | model-h1 max                    |',
  '| claude-work                     |  | claude-work                     |',
  BOX_BOTTOM
].join('\n');
const NOW = '2026-09-13T10:00:00.000Z';
const LATER = '2026-09-16T10:00:00.000Z';
const RULE = '='.repeat(72);

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
  const body = { code: 0, msg: 'success', data: { kind: 'ok', quota: { usages: {
    limit5h: { usedRatio: v[0] / 100, resetAt: iso(5) },
    limit7d: { usedRatio: v[1] / 100, resetAt: iso(Number(v[2])) }
  }, extraUsage: null } }, request_id: 'qa-018' };
  http.createServer((req, res) => res.end(JSON.stringify(body))).listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/#token=t'));
} else process.exit(2);
`;

const FULL = { claude: [3, 86, 100], work: [0, 12, 23], agy: [50, 50, 72], kimi: [85, 85, 72], grok: [90, 72], cursor: [80, 80, 80, 72] };
const ENV_NAMES = { claude: 'H_CLAUDE', work: 'H_WORK', agy: 'Q_AGY', kimi: 'Q_KIMI' };
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
  await symlink('/usr/bin/stty', join(dir, 'stty'));
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
    await writeFile(join(home, '.config', 'cursor', 'auth.json'), '{"accessToken":"qa-019"}');
  }
  return home;
}

async function envFor(ctx, usages) {
  if (usages.cursor) ctx.cursor.usage = usages.cursor;
  const vars = Object.fromEntries(Object.entries(ENV_NAMES).filter(([name]) => usages[name]).map(([name, variable]) => [variable, usages[name].join(',')]));
  const home = await homeFor(usages);
  const inherited = { ...process.env };
  for (const name of Object.keys(inherited)) if (name.startsWith('DANDELION_') || name === 'CLAUDE_CONFIG_DIR' || name === 'NO_COLOR') delete inherited[name];
  return {
    ...inherited,
    HOME: home,
    PATH: ctx.bin,
    SHELL: '/bin/sh',
    TERM: 'xterm',
    TZ: 'UTC',
    NO_COLOR: '1',
    DANDELION_REFRESH_SECONDS: '3600',
    DANDELION_KIMI_PORT: String(await freePort()),
    DANDELION_CURSOR_API_BASE: `http://127.0.0.1:${ctx.cursor.address().port}`,
    DANDELION_GROK_HOME: join(home, '.grok'),
    DANDELION_CLAUDE_WORK_CONFIG_DIR: join(home, '.claude-work'),
    DANDELION_STATE_FILE: join(home, 'state', 'eligibility.json'),
    DANDELION_HERMES_AUTH_FILE: join(home, 'missing-hermes.json'),
    DANDELION_ROUTES_FILE: ROUTES_FILE,
    ...vars
  };
}

function send(run, key) {
  run.child.stdin.write(key);
}

function drawnFrames(run) {
  return run.output.replaceAll('\r\n', '\n').split(CLEAR).slice(1).map((part) => part.split('\x1b[?25h')[0]).filter((frame) => frame.length > 0);
}

function lastFrame(run) {
  return drawnFrames(run).at(-1) ?? '';
}

function boxLinesOf(frame) {
  return frame.split('\n').slice(2, 6).join('\n');
}

function assertHeight(frame, rows, label) {
  const lines = frame.split('\n');
  assert.ok(lines.length <= rows, `${label} is ${lines.length} lines:\n${frame}`);
  assert.equal(frame.endsWith('\n'), false, `${label} has a trailing newline`);
  assert.match(lines[0] ?? '', /^DANDELION /, `${label} does not start with the banner:\n${frame}`);
}

function assertBoxesOnChrome(frame, label) {
  const lines = frame.split('\n');
  assert.ok((lines[2] ?? '').startsWith('+- route'), `${label} line 3 is not the route box:\n${frame}`);
  assert.equal(lines.slice(2, 6).join('\n'), SETTLED_BLOCK, `${label} boxes are not the settled 013 block:\n${frame}`);
}

async function ptyOf(pid) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const fds = await readdir(join('/proc', String(pid), 'fd')).catch(() => []);
    for (const fd of fds) {
      const target = await readlink(join('/proc', String(pid), 'fd', fd)).catch(() => '');
      if (target.startsWith('/dev/pts/')) return target;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no pts for pid ${pid}`);
}

async function resizePty(run, rows, cols) {
  const pts = await ptyOf(run.child.pid);
  const child = spawn('/usr/bin/stty', ['-F', pts, 'rows', String(rows), 'cols', String(cols)]);
  const [status] = await once(child, 'close');
  assert.equal(status, 0, `stty -F ${pts} rows ${rows} cols ${cols} exited ${status}`);
}

async function withLive(env, rows, check) {
  const run = startLive(env, rows, 80);
  try {
    await check(run);
    send(run, 'q');
    await assertClosed(run);
    assert.ok(run.output.includes(ENTER), `no alternate-screen enter:\n${run.output.slice(0, 200)}`);
    assert.ok(run.output.lastIndexOf(RESTORE) > run.output.lastIndexOf(CLEAR), `no terminal restore after the last frame:\n${JSON.stringify(run.output.slice(-200))}`);
  } finally {
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill();
  }
}

async function unitRender() {
  const { renderLiveFrame } = await import(new URL('../src/render/live-frame.ts', import.meta.url));
  const { renderDashboard } = await import(new URL('../src/render/terminal.ts', import.meta.url));
  const win = (label, kind, usedPct) => ({ label, kind, usedPct, resetsAt: LATER });
  const ok = (id, planLabel, windows, extra = {}) => ({ id, displayName: id, planLabel, windows, fetchedAt: NOW, status: 'ok', ...extra });
  const dim = (id, planLabel, reason) => ({ id, displayName: id, planLabel, windows: [], fetchedAt: NOW, status: 'unavailable', reason });
  const usages = [
    ok('claude', 'claude · personal', [win('session', 'rolling', 3), win('weekly', 'weekly', 86), win('weekly Fable', 'weekly', 100)]),
    ok('claude-work', 'claude · work', [win('session', 'rolling', 0), win('weekly', 'weekly', 12), win('weekly Fable', 'weekly', 23)]),
    ok('agy', 'agy', [win('Gemini Models · Five Hour Limit', 'rolling', 50), win('Gemini Models · Weekly Limit', 'weekly', 50)]),
    ok('kimi', 'kimi code', [win('weekly', 'weekly', 85), win('5h', 'rolling', 85)]),
    ok('grok', 'SuperGrok', [win('credits', 'weekly', 90)], { snapshotAt: NOW }),
    ok('codex', 'codex', [], { note: 'api-key billing · no usage windows' }),
    ok('cursor', 'Ultra', [win('total', 'weekly', 80), win('auto', 'weekly', 80), win('api', 'weekly', 80)]),
    dim('junie', 'junie', 'no junie quota snapshot — run junie once'),
    dim('hermes', 'hermes', 'no hermes auth — run hermes portal login'),
    ok('kilo', 'api balance', [], { balance: { amount: 14.15, currency: '$', reference: 20 } })
  ];
  const routes = { lines: JSON.parse(await readFile(ROUTES_FILE, 'utf8')) };
  const view = (extra = {}) => ({ slots: usages.map((usage) => ({ id: usage.id, usage })), spinner: 0, refreshing: false, footer: false, ineligible: [], zone: 'UTC', routes, settled: usages, selected: -1, rows: 12, ...extra });
  const frameOf = (extra = {}) => renderLiveFrame(view(extra), true, NOW).split('\n');
  const twelve = renderLiveFrame(view(), true, NOW);
  const lines = twelve.split('\n');
  assert.equal(twelve.endsWith('\n'), false, '12-row unit frame has a trailing newline');
  assert.equal(lines.length, 12, `12-row unit frame is ${lines.length} lines`);
  assert.match(lines[0], /^DANDELION /);
  assert.equal(lines[2], BOX_TOP);
  assert.equal(lines.slice(2, 6).join('\n'), SETTLED_BLOCK);
  assert.equal(lines[6], RULE);
  assert.equal(lines[7], 'claude');
  assert.equal(lines.includes('claude-work'), false);
  assert.equal(lines.some((line) => line.includes('kilo')), false);
  const pendingSlots = usages.map(({ id }) => ({ id, usage: undefined }));
  const pending = renderLiveFrame(view({ slots: pendingSlots, settled: undefined }), true, NOW).split('\n');
  assert.equal(pending.length, 12);
  assert.equal(pending[2], BOX_TOP);
  assert.ok(pending[3].includes('⠋ probing…'));
  assert.equal(pending[7], 'claude');
  assert.equal(pending[10], 'claude-work');
  assert.equal(pending.some((line) => line === 'agy' || line.includes('kilo')), false);
  const twentyFour = [BANNER_UNIT, SUMMARY_UNIT, ...SETTLED_BLOCK.split('\n'), ...CLAUDE_UNIT, ...WORK_UNIT, ...AGY_UNIT, RULE];
  for (const rows of [24, 0, undefined, 12.5]) {
    assert.deepEqual(frameOf({ rows }), twentyFour, `rows ${rows} is not the 24-line fallback`);
  }
  assert.deepEqual(frameOf({ selected: undefined }), twelve.split('\n'));
  assert.deepEqual(frameOf({ selected: 9 }), [BANNER_UNIT, SUMMARY_UNIT, ...SETTLED_BLOCK.split('\n'), '▸ kilo', '$14.15 ##############------'.padEnd(72), 'api balance · kilo']);
  const withFooter = frameOf({ selected: 0, footer: true });
  assert.equal(withFooter.length, 12);
  assert.equal(withFooter[6], '▸ claude');
  assert.equal(withFooter.at(-1), HELP);
  assert.deepEqual(frameOf({ rows: 4 }), [BANNER_UNIT, SUMMARY_UNIT, BOX_TOP, SETTLED_BLOCK.split('\n')[1]]);
  assert.deepEqual(frameOf({ rows: 1 }), [BANNER_UNIT]);
  const grown = frameOf({ rows: 30 });
  assert.equal(grown.length, 30);
  assert.equal(grown.at(-1), 'grok');
  assert.deepEqual(grown.slice(0, 12), twelve.split('\n'));
  assert.equal(frameOf({ rows: 10 })[7], 'claude');
  assert.equal(frameOf({ rows: 10 }).length, 10);
  const once = renderDashboard(usages, true, NOW, []);
  const onceLines = once.split('\n');
  assert.equal(onceLines.length, 50, `once lines: ${onceLines.length}`);
  assert.equal(once.includes('+- route'), false);
  assert.ok(IDS.every((id) => once.includes(`\n${id}\n`)), 'once is missing a provider');
}

const BANNER_UNIT = `${'DANDELION'.padEnd(47)}data 0h0m old · 10:00:00Z`;
const SUMMARY_UNIT = '8/14 windows above 80% · next reset: claude session in 3d0h';
const CLAUDE_UNIT = [
  RULE,
  'claude',
  'session                             #-------------------   3% ↻ 3d0h',
  'weekly                              #################---  86% ↻ 3d0h',
  'weekly Fable                        #################### 100% ↻ 3d0h',
  'claude · personal · claude'
];
const WORK_UNIT = [
  RULE,
  'claude-work',
  'session                             --------------------   0% ↻ 3d0h',
  'weekly                              ##------------------  12% ↻ 3d0h',
  'weekly Fable                        #####---------------  23% ↻ 3d0h',
  'claude · work · claude-work'
];
const AGY_UNIT = [
  RULE,
  'agy',
  'Gemini Models · Five Hour Limit     ##########----------  50% ↻ 3d0h',
  'Gemini Models · Weekly Limit        ##########----------  50% ↻ 3d0h',
  'agy · agy'
];

async function readmeDocumentsFit() {
  const readme = await readFile(join(rootDir, 'README.md'), 'utf8');
  const start = readme.split('\n').find((line) => line.startsWith('- `npm start`'));
  assert.ok(start, 'README has no npm start bullet');
  assert.match(start, /fits the terminal/);
  assert.match(start, /boxes stay at the top/);
  assert.match(start, /scrolls with `↑↓\/jk`/);
  assert.match(start, /personal `claude`/);
}

async function liveTwelveRowSession(ctx) {
  await withLive(await envFor(ctx, FULL), 12, async (run) => {
    await waitWithin(run, () => drawnFrames(run).length > 0, 20000, 'first frame');
    const first = drawnFrames(run)[0];
    assertHeight(first, 12, 'all-pending first frame');
    assert.equal(first.split('\n').length, 12);
    assert.ok((first.split('\n')[2] ?? '').startsWith('+- route'), `pending line 3:\n${first}`);
    assert.ok(first.includes('\nclaude\n'), `pending frame has no personal claude:\n${first}`);
    assert.ok(first.includes('\nclaude-work\n'), `pending frame has no claude-work:\n${first}`);
    assert.equal(first.includes('\nagy\n') || first.includes('\nkilo\n'), false, `pending frame scrolled past the first panels:\n${first}`);
    await waitWithin(run, () => boxLinesOf(lastFrame(run)) === SETTLED_BLOCK && !lastFrame(run).includes('probing…'), 20000, 'settled 12-row frame');
    const settled = lastFrame(run);
    assertHeight(settled, 12, 'settled 12-row frame');
    assert.equal(settled.split('\n').length, 12);
    assertBoxesOnChrome(settled, 'settled 12-row');
    assert.equal(settled.split('\n')[6], RULE);
    assert.equal(settled.split('\n')[7], 'claude');
    assert.equal(settled.split('\n').includes('claude-work'), false, `settled frame starts on claude-work:\n${settled}`);
    assert.equal(settled.split('\n').filter((line) => line === 'kilo' || line.endsWith(' kilo') || line.includes('▸ kilo')).length, 0, `kilo in settled 12-row frame:\n${settled}`);
    send(run, 'j'.repeat(10));
    await waitWithin(run, () => lastFrame(run).split('\n')[6] === '▸ kilo', 20000, 'kilo selected');
    const kilo = lastFrame(run);
    assertHeight(kilo, 12, 'kilo-selected frame');
    assert.equal(kilo.split('\n').length, 9, `kilo frame padded to ${kilo.split('\n').length} lines:\n${kilo}`);
    assertBoxesOnChrome(kilo, 'kilo-selected');
    assert.equal(kilo.split('\n')[6], '▸ kilo');
    assert.equal(kilo.split('\n').filter((line) => line === 'claude').length, 0, `personal claude still in kilo frame:\n${kilo}`);
    send(run, 'k'.repeat(9));
    await waitWithin(run, () => lastFrame(run).split('\n')[6] === '▸ claude', 20000, 'claude selected');
    send(run, '?');
    await waitWithin(run, () => lastFrame(run).split('\n').at(-1) === HELP, 20000, 'help footer');
    const footer = lastFrame(run);
    assertHeight(footer, 12, 'footer frame');
    assert.equal(footer.split('\n').length, 12);
    assertBoxesOnChrome(footer, 'footer');
    assert.equal(footer.split('\n')[6], '▸ claude');
    assert.equal(footer.split('\n')[7] === 'claude-work' || footer.split('\n')[6] === '▸ claude-work', false, `footer selected claude-work:\n${footer}`);
    assert.equal(footer.split('\n').at(-1), HELP);
    assert.ok(drawnFrames(run).some((frame) => frame.includes('▸ kilo')), 'walk down never drew ▸ kilo');
    send(run, '?');
    await waitWithin(run, () => !lastFrame(run).includes('keys:'), 20000, 'footer off');
    assertHeight(lastFrame(run), 12, 'footer-off frame');
  });
}

async function liveFourRowClip(ctx) {
  await withLive(await envFor(ctx, FULL), 4, async (run) => {
    await waitWithin(run, () => drawnFrames(run).length > 0, 20000, '4-row first frame');
    for (const frame of drawnFrames(run)) {
      assert.equal(frame.split('\n').length, 4, `4-row frame is ${frame.split('\n').length} lines:\n${frame}`);
      assert.match(frame.split('\n')[0] ?? '', /^DANDELION /);
      assert.ok((frame.split('\n')[2] ?? '').startsWith('+- route'), `4-row line 3:\n${frame}`);
    }
    await waitWithin(run, () => boxLinesOf(lastFrame(run)).startsWith(BOX_TOP) && !lastFrame(run).includes('probing…'), 20000, '4-row settled');
    const settled = lastFrame(run).split('\n');
    assert.equal(settled.length, 4);
    assert.ok(settled[0].startsWith('DANDELION'));
    assert.equal(settled[2], BOX_TOP);
    assert.equal(settled[3], '| model-b high                    |  | model-h1 max                    |');
    send(run, '?');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(lastFrame(run).split('\n'), settled);
  });
}

async function liveResize(ctx) {
  await withLive(await envFor(ctx, FULL), 12, async (run) => {
    await waitWithin(run, () => boxLinesOf(lastFrame(run)) === SETTLED_BLOCK && !lastFrame(run).includes('probing…'), 20000, 'settled before resize');
    const settled = lastFrame(run);
    assertHeight(settled, 12, 'pre-resize 12-row');
    await resizePty(run, 30, 80);
    await waitWithin(run, () => lastFrame(run).split('\n').length === 30, 20000, '30-row resize');
    const grown = lastFrame(run);
    assertHeight(grown, 30, '30-row frame');
    assert.equal(grown.split('\n').length, 30);
    assertBoxesOnChrome(grown, '30-row');
    assert.equal(grown.split('\n').at(-1), 'grok');
    assert.equal(grown.endsWith('\n\n') || grown.split('\n').at(-1) === '', false, `30-row frame has blank padding:\n${JSON.stringify(grown.slice(-40))}`);
    await resizePty(run, 10, 80);
    await waitWithin(run, () => lastFrame(run).split('\n').length === 10, 20000, '10-row resize');
    const ten = lastFrame(run);
    assertHeight(ten, 10, '10-row frame');
    assert.equal(ten.split('\n').length, 10);
    assertBoxesOnChrome(ten, '10-row');
    assert.equal(ten.split('\n')[7], 'claude');
    await resizePty(run, 4, 80);
    await waitWithin(run, () => lastFrame(run).split('\n').length === 4, 20000, '4-row resize');
    const four = lastFrame(run).split('\n');
    assert.equal(four.length, 4);
    assert.match(four[0], /^DANDELION /);
    assert.equal(four[2], BOX_TOP);
  });
}

async function onceAndRoute(ctx) {
  const env = await envFor(ctx, FULL);
  const once = launch(process.execPath, [join(rootDir, 'src', 'main.ts'), '--once'], env);
  const [onceStatus] = await once.closed;
  assert.equal(onceStatus, 0, `--once exits ${onceStatus}\n${once.stderr}`);
  const lines = once.output.split('\n');
  if (lines.at(-1) === '') lines.pop();
  assert.match(lines[0] ?? '', /^DANDELION +\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(lines.length > 12, `--once clipped to ${lines.length} lines`);
  assert.equal(lines.length, 50, `--once is ${lines.length} lines, not 50`);
  assert.ok(!once.output.includes('+- route') && !once.output.includes('─ route'), 'once has box titles');
  const headers = lines.filter((line) => IDS.includes(line));
  assert.deepEqual(headers, IDS, `once panel order:\n${once.output}`);
  const route = launch(process.execPath, [join(rootDir, 'src', 'main.ts'), 'route'], env);
  const [routeStatus] = await route.closed;
  assert.equal(routeStatus, 0, `route exits ${routeStatus}\n${route.stderr}`);
  assert.equal(route.output, 'model-b high claude-work\n');
  const high = launch(process.execPath, [join(rootDir, 'src', 'main.ts'), 'route', '--high'], env);
  const [highStatus] = await high.closed;
  assert.equal(highStatus, 0, `route --high exits ${highStatus}\n${high.stderr}`);
  assert.equal(high.output, 'model-h1 max claude-work\n');
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

export default async function () {
  await unitRender();
  await readmeDocumentsFit();
  const server = await cursorApi();
  try {
    const ctx = { cursor: server, bin: await fixtureDir() };
    await liveTwelveRowSession(ctx);
    await liveFourRowClip(ctx);
    await liveResize(ctx);
    await onceAndRoute(ctx);
  } finally {
    server.close();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
  const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'package.json has runtime dependencies');
}
