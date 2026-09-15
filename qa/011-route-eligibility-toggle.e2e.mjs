import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, readdir, stat, symlink, access } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'dandelion-qa-011-';
const OUTER_TIMEOUT_MS = 60000;
const MINUTE_MS = 60000;
const CLEAR = '\x1b[H\x1b[2J';
const NOT_ROUTABLE = 'not routable (no usage windows)';
const TAG = 'routing off';

const FIXTURE = `#!/usr/bin/env node
const path = require('node:path');
const me = path.basename(process.argv[1]);
const q = (n) => process.env[n] && process.env[n].split(',').map(Number);
const at = (h) => new Date(Number(process.env.Q_T0) + h * 3600000), iso = (h) => at(h).toISOString();
const M = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const txt = (h) => { const d = at(h), H = d.getUTCHours(); return M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + (H % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0') + (H < 12 ? 'am' : 'pm') + ' (UTC)'; };
if (me === 'codex') { console.error('Logged in using an API key - sk-proj-***n5zQA'); process.exit(0); }
if (me === 'kilo') { console.log('Balance: $14.15'); process.exit(0); }
if (me === 'claude') { const v = q(process.env.CLAUDE_CONFIG_DIR ? 'Q_WORK' : 'Q_CLAUDE'); if (!v) process.exit(1);
  console.log('Current session: ' + v[0] + '% used · resets ' + txt(4) + '\\nCurrent week (all models): ' + v[1] + '% used · resets ' + txt(v[2])); process.exit(0); }
if (me === 'agy') { const v = q('Q_AGY'); if (!v) process.exit(1);
  console.log('Gemini Models\\tFive Hour Limit Remaining\\t' + (100 - v[0]) + '%\\t' + iso(4) + '\\nGemini Models\\tWeekly Limit Remaining\\t' + (100 - v[1]) + '%\\t' + iso(v[2])); process.exit(0); }
process.exit(2);
`;

const BOTH = { claude: [0, 86, 2], agy: [0, 0, 72] };

const ROUTE_ROWS = [
  ['no file: 010 output', BOTH, { missing: true }, 'claude-opus-5 max claude', 0],
  ['ineligible never wins by evaporation', BOTH, { text: '{"claude": false}' }, 'gemini-3.1-pro-high medium agy', 0],
  ['ineligible never wins by headroom', { claude: [20, 30, 72], work: [10, 5, 72], agy: [15, 20, 72] }, { text: '{"claude-work": false, "nope": 1}' }, 'gemini-3.1-pro-high medium agy', 0],
  ['true and other values mean eligible', BOTH, { text: '{"claude": true, "agy": "no"}' }, 'claude-opus-5 max claude', 0],
  ['every windowed provider ineligible', { claude: [0, 86, 2] }, { text: '{"claude": false}' }, 'none', 1],
  ['corrupt file means all eligible', BOTH, { text: '{not json' }, 'claude-opus-5 max claude', 0],
  ['JSON null means all eligible', BOTH, { text: 'null' }, 'claude-opus-5 max claude', 0],
  ['a JSON array means all eligible', BOTH, { text: '[false]' }, 'claude-opus-5 max claude', 0],
  ['unreadable file means all eligible', BOTH, { directory: true }, 'claude-opus-5 max claude', 0]
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
  for (const name of ['claude', 'agy', 'codex', 'kilo']) await symlink('q', join(dir, name));
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  return dir;
}

function localElevenZone() {
  const offset = new Date().getUTCHours() - 11;
  return `Etc/GMT${offset < 0 ? '-' : '+'}${Math.abs(offset)}`;
}

function assertLocalTimeNearEleven(zone) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  assert.ok(hour >= 10 && hour <= 13, `TZ ${zone} puts local time at ${hour}:xx`);
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function sandbox(ctx, usages, extraEnv = {}) {
  const tmp = await tempDir();
  const home = join(tmp, 'home');
  await mkdir(join(home, '.claude-work'), { recursive: true });
  const q = Object.fromEntries(['claude', 'work', 'agy']
    .filter((name) => usages[name])
    .map((name) => [`Q_${name.toUpperCase()}`, usages[name].join(',')]));
  const env = {
    HOME: home,
    TZ: ctx.zone,
    PATH: ctx.bin,
    SHELL: '/bin/sh',
    TERM: 'xterm',
    Q_T0: String(ctx.t0),
    DANDELION_STATE_FILE: join(tmp, 'state', 'eligibility.json'),
    ...q,
    ...extraEnv
  };
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  return { tmp, env, stateDir: join(tmp, 'state'), statePath: join(tmp, 'state', 'eligibility.json') };
}

async function writeState(box, text) {
  await mkdir(box.stateDir, { recursive: true });
  await writeFile(box.statePath, text);
}

async function node(args, env) {
  const child = spawn(process.execPath, [join(rootDir, 'src', 'main.ts'), ...args], { cwd: rootDir, env, timeout: OUTER_TIMEOUT_MS });
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

async function snapshot(path) {
  const info = await stat(path).catch(() => undefined);
  if (!info) return 'missing';
  if (info.isDirectory()) return `directory ${info.mtimeMs}`;
  return `${await readFile(path, 'utf8')} ${info.mtimeMs}`;
}

async function routeSkipsIneligibleProviders(ctx) {
  for (const [label, usages, state, line, code] of ROUTE_ROWS) {
    const box = await sandbox(ctx, usages);
    if (state.text !== undefined) await writeState(box, state.text);
    if (state.directory) await mkdir(box.statePath, { recursive: true });
    const before = await snapshot(box.statePath);
    const result = await node(['route'], box.env);
    assert.deepEqual(result, { stdout: `${line}\n`, stderr: '', status: code }, describe(label, result));
    assert.equal(await snapshot(box.statePath), before, `${label}: the state file changed`);
    if (state.missing) assert.equal(await exists(box.stateDir), false, `${label}: route created the state dir`);
  }
}

async function defaultStateFilePath(ctx) {
  const rows = [
    ['DANDELION_STATE_FILE unset, XDG_STATE_HOME set', (tmp, home) => ({ vars: { DANDELION_STATE_FILE: undefined, XDG_STATE_HOME: join(tmp, 'xdg') }, path: join(tmp, 'xdg', 'dandelion', 'eligibility.json'), decoy: join(home, '.local', 'state', 'dandelion', 'eligibility.json') })],
    ['DANDELION_STATE_FILE empty, XDG_STATE_HOME unset', (tmp, home) => ({ vars: { DANDELION_STATE_FILE: '' }, path: join(home, '.local', 'state', 'dandelion', 'eligibility.json') })],
    ['DANDELION_STATE_FILE unset, XDG_STATE_HOME empty', (tmp, home) => ({ vars: { DANDELION_STATE_FILE: undefined, XDG_STATE_HOME: '' }, path: join(home, '.local', 'state', 'dandelion', 'eligibility.json') })]
  ];
  for (const [label, layout] of rows) {
    const probe = await sandbox(ctx, BOTH);
    const { vars, path, decoy } = layout(probe.tmp, probe.env.HOME);
    const box = { ...probe, env: { ...probe.env, ...vars } };
    for (const [name, value] of Object.entries(box.env)) if (value === undefined) delete box.env[name];
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{"claude": false}');
    if (decoy) assert.equal(await exists(decoy), false, `${label}: a file exists at the HOME default`);
    const result = await node(['route'], box.env);
    assert.deepEqual(result, { stdout: 'gemini-3.1-pro-high medium agy\n', stderr: '', status: 0 }, describe(label, result));
  }
}

function withoutClock(stdout) {
  const lines = stdout.split('\n');
  lines[0] = lines[0].replace(/\d{2}:\d{2}:\d{2}Z$/, 'HH:MM:SSZ');
  return lines;
}

async function inOneMinute(batch) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    while (Date.now() % MINUTE_MS > 30000) await new Promise((resolve) => setTimeout(resolve, 500));
    const started = Math.floor(Date.now() / MINUTE_MS);
    const result = await batch();
    if (Math.floor(Date.now() / MINUTE_MS) === started) return result;
  }
  assert.fail('every --once batch crossed a minute boundary');
}

async function onceShowsTagAndNeverWrites(ctx) {
  const box = await sandbox(ctx, { claude: [0, 86, 2] }, { NO_COLOR: '1' });
  const plain = { ...box.env, DANDELION_STATE_FILE: join(box.tmp, 'none', 'eligibility.json') };
  await writeState(box, '{"claude": false, "kilo": false}');
  let untouched = false;
  const [tagged, reference, corrupt, nul] = await inOneMinute(async () => {
    await writeFile(box.statePath, '{"claude": false, "kilo": false}');
    const outputs = [];
    const beforeRun = await snapshot(box.statePath);
    outputs.push(await node(['--once'], box.env));
    untouched = (await snapshot(box.statePath)) === beforeRun;
    outputs.push(await node(['--once'], plain));
    await writeFile(box.statePath, '{not json');
    outputs.push(await node(['--once'], box.env));
    await writeFile(box.statePath, 'null');
    outputs.push(await node(['--once'], box.env));
    return outputs;
  });
  for (const result of [tagged, reference, corrupt, nul]) assert.equal(result.status, 0, describe('--once', result));
  const taggedLines = withoutClock(tagged.stdout);
  const referenceLines = withoutClock(reference.stdout);
  assert.equal(taggedLines.length, referenceLines.length, describe('tagged', tagged));
  const headers = { claude: `claude${' '.repeat(55)}${TAG}`, kilo: `kilo${' '.repeat(57)}${TAG}` };
  for (const [index, line] of referenceLines.entries()) {
    const expected = headers[line] ?? line;
    assert.equal(taggedLines[index], expected, `--once line ${index}\n${tagged.stdout}`);
  }
  assert.equal([...headers.claude].length, 72);
  assert.ok(!tagged.stdout.includes('▸'), tagged.stdout);
  assert.ok(untouched, '--once changed the state file bytes or mtime');
  assert.deepEqual(withoutClock(corrupt.stdout), referenceLines, describe('{not json', corrupt));
  assert.deepEqual(withoutClock(nul.stdout), referenceLines, describe('null', nul));
  const fresh = await sandbox(ctx, { claude: [0, 86, 2] }, { NO_COLOR: '1' });
  const missing = await node(['--once'], fresh.env);
  assert.equal(missing.status, 0, describe('missing', missing));
  assert.ok(!missing.stdout.includes(TAG) && !missing.stdout.includes('▸'), missing.stdout);
  assert.equal(await exists(fresh.stateDir), false, '--once created the state dir');
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

function panelLines(frame, id) {
  const lines = frame.split('\n');
  const header = lines.findIndex((line) => line.replace(/^▸ /, '').replace(/ +routing off$/, '') === id);
  assert.ok(header >= 0, `no ${id} panel in:\n${frame}`);
  const end = lines.findIndex((line, index) => index > header && /^=+$/.test(line));
  return lines.slice(header, end < 0 ? lines.length : end);
}

function rows(frame, id) {
  return panelLines(frame, id).slice(1, -1).map((line) => line.replace(/ ↻ \S+$/, ''));
}

function hasNoMarks(frame) {
  return !frame.includes('▸') && !frame.includes(TAG);
}

async function toggleOffAndOn(ctx) {
  const box = await sandbox(ctx, BOTH, { NO_COLOR: '1' });
  const run = startLive(box.env);
  try {
    await waitSettled(run);
    assert.ok(hasNoMarks(lastFrame(run)), lastFrame(run));
    run.child.stdin.write('j');
    await waitFor(run, () => panelLines(lastFrame(run), 'claude')[0] === '▸ claude', 10000, 'selected claude');
    assert.equal(await exists(box.statePath), false, 'j wrote the state file');
    const claudeRows = rows(lastFrame(run), 'claude');
    run.child.stdin.write(' ');
    const off = `▸ claude${' '.repeat(53)}${TAG}`;
    await waitFor(run, () => panelLines(lastFrame(run), 'claude')[0] === off, 10000, 'claude routing off tag');
    assert.equal([...off].length, 72);
    assert.deepEqual(JSON.parse(await readFile(box.statePath, 'utf8')), { claude: false });
    assert.deepEqual(await readdir(box.stateDir), ['eligibility.json']);
    assert.deepEqual(rows(lastFrame(run), 'claude'), claudeRows);
    const routed = await node(['route'], box.env);
    assert.deepEqual(routed, { stdout: 'gemini-3.1-pro-high medium agy\n', stderr: '', status: 0 }, describe('route while live', routed));
    run.child.stdin.write(' ');
    await waitFor(run, () => panelLines(lastFrame(run), 'claude')[0] === '▸ claude', 10000, 'claude tag gone');
    assert.deepEqual(JSON.parse(await readFile(box.statePath, 'utf8')), { claude: true });
    run.child.stdin.write(' ');
    await waitFor(run, () => panelLines(lastFrame(run), 'claude')[0] === off, 10000, 'claude routing off tag again');
    await quit(run);
  } finally {
    run.child.kill();
  }
  const again = startLive(box.env);
  try {
    await waitSettled(again);
    const settled = frames(again).find((frame) => !frame.includes('probing…'));
    assert.equal(panelLines(settled, 'claude')[0], `claude${' '.repeat(55)}${TAG}`);
    assert.ok(!settled.includes('▸'), settled);
    await quit(again);
  } finally {
    again.child.kill();
  }
}

async function kiloFlashesAndWritesNothing(ctx) {
  const box = await sandbox(ctx, BOTH, { NO_COLOR: '1' });
  const run = startLive(box.env);
  try {
    await waitSettled(run);
    run.child.stdin.write('k');
    await waitFor(run, () => panelLines(lastFrame(run), 'kilo')[0] === '▸ kilo', 10000, 'selected kilo');
    const pressedAt = Date.now();
    const firstAfter = run.frameStarts.length;
    run.child.stdin.write(' ');
    const caption = (frame) => panelLines(frame, 'kilo')[2];
    const indexWhere = (from, text) => frames(run).findIndex((frame, index) => index >= from && caption(frame) === text);
    await waitFor(run, () => indexWhere(firstAfter, NOT_ROUTABLE) >= 0, 10000, 'kilo not routable flash');
    const flashed = indexWhere(firstAfter, NOT_ROUTABLE);
    await waitFor(run, () => indexWhere(flashed, 'api balance · kilo') >= 0, 10000, 'kilo caption back');
    const back = indexWhere(flashed, 'api balance · kilo');
    const flashDelay = run.frameStarts[flashed] - pressedAt;
    const backDelay = run.frameStarts[back] - pressedAt;
    assert.ok(flashDelay < 1000, `the flash took ${flashDelay}ms to draw`);
    assert.ok(backDelay >= 1900 && backDelay <= 3000, `the caption came back after ${backDelay}ms`);
    assert.ok(frames(run).slice(firstAfter).every((frame) => !frame.includes(TAG)), 'a header shows routing off');
    assert.equal(await exists(box.stateDir), false, 'the kilo toggle wrote state');
    await quit(run);
  } finally {
    run.child.kill();
  }
  assert.equal(await exists(box.stateDir), false, 'the kilo toggle wrote state');
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
  try {
    const ctx = { zone, bin: await fixtureDir(), t0: Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS };
    await routeSkipsIneligibleProviders(ctx);
    await defaultStateFilePath(ctx);
    await onceShowsTagAndNeverWrites(ctx);
    await toggleOffAndOn(ctx);
    await kiloFlashesAndWritesNothing(ctx);
  } finally {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
