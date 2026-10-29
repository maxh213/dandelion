import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir, symlink, realpath } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ROUTES_FILE } from './routes-fixture.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = join(rootDir, 'src', 'main.ts');
const PREFIX = 'dandelion-qa-022-';
const OUTER_TIMEOUT_MS = 60000;
const HOUR_MS = 3600000;
const IDS = ['claude', 'claude-work', 'claude-animus', 'claude-deepseek', 'claude-ollama', 'agy', 'kimi', 'grok', 'codex', 'codex-animus', 'cursor', 'junie', 'hermes', 'kilo'];
const COMMANDS = ['claude', 'codex', 'cursor-agent', 'agy', 'kimi', 'grok', 'junie', 'hermes', 'kilo'];
const SEAT_KEYS = ['account', 'line', 'model', 'effort', 'command', 'lab', 'kind', 'rank', 'rankName', 'held'];
const ACCOUNT_KEYS = ['id', 'command', 'cap', 'held', 'target', 'score', 'evaporating', 'balance', 'skip', 'windows'];
const REASONS = ['excluded', 'ineligible', 'unavailable', 'limited', 'tripped', 'no-headless', 'not-in-chain', 'spent', 'balance'];
const PROMPT = 'Create ok.txt with $& and {promptFile} in it.\n';

const FAKE_CLI = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('sleep')) setInterval(() => undefined, 1000);
else {
  const stdin = fs.readFileSync(0, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), 'seen.json'), JSON.stringify({ me: path.basename(process.argv[1]), args, stdin, cwd: process.cwd(), pwd: process.env.PWD, home: process.env.CODEX_HOME || null }));
  process.stdout.write('fake stdout\\n');
  process.stderr.write('fake stderr\\n');
  process.exit(7);
}
`;

const temps = [];

async function tempDir() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), PREFIX)));
  temps.push(dir);
  return dir;
}

async function fakeBin(withCli) {
  const dir = await tempDir();
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  if (withCli) {
    await writeFile(join(dir, 'fake-cli'), FAKE_CLI);
    await chmod(join(dir, 'fake-cli'), 0o755);
    for (const name of ['claude', 'codex']) await symlink('fake-cli', join(dir, name));
  }
  return dir;
}

function inHours(hours) {
  return new Date(Date.now() + hours * HOUR_MS).toISOString();
}

function windowsOf(session, week) {
  return [{ label: 'session', kind: 'rolling', usedPct: session, resetsAt: inHours(3) }, { label: 'weekly', kind: 'weekly', usedPct: week, resetsAt: inHours(72) }];
}

function snapshotOf(usages) {
  const fetchedAt = new Date().toISOString();
  return IDS.map((id) => (usages[id] === undefined
    ? { id, displayName: id, status: 'unavailable', reason: 'qa', windows: [], fetchedAt }
    : { id, displayName: id, status: 'ok', windows: usages[id], fetchedAt }));
}

async function routesWith(extra) {
  const fixture = JSON.parse(await readFile(ROUTES_FILE, 'utf8'));
  const headless = Object.fromEntries(COMMANDS.map((command) => [command, { before: [], after: ['-p'], stdin: true }]));
  const file = join(await tempDir(), 'routes.json');
  await writeFile(file, JSON.stringify({ ...fixture, swarm: { exclude: ['claude-work', 'claude-animus', 'codex-animus'], cap: { default: 2 } }, lab: { 'model-': 'lab-a', 'vendor/': 'lab-b' }, headless, ...extra }));
  return file;
}

async function stateWith(usages, eligibility = {}) {
  const dir = await tempDir();
  await writeFile(join(dir, 'snapshot.json'), JSON.stringify(snapshotOf(usages)));
  await writeFile(join(dir, 'eligibility.json'), JSON.stringify(eligibility));
  return join(dir, 'eligibility.json');
}

async function collect(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const [status] = await once(child, 'close');
  return { stdout, stderr, status };
}

async function dandelion(args, { routes, state, bin, cwd = rootDir }) {
  const home = await tempDir();
  const env = { HOME: home, TZ: 'UTC', PATH: bin, NO_COLOR: '1', DANDELION_STATE_FILE: state, DANDELION_KIMI_PORT: '1' };
  if (routes !== undefined) env.DANDELION_ROUTES_FILE = routes;
  return collect(spawn(process.execPath, [MAIN, ...args], { cwd, env, timeout: OUTER_TIMEOUT_MS }));
}

function describe(label, result) {
  return `${label}\nexit ${result.status}\nstdout:\n${JSON.stringify(result.stdout)}\nstderr:\n${JSON.stringify(result.stderr)}`;
}

function jsonOf(label, result, status) {
  assert.equal(result.status, status, describe(label, result));
  assert.equal(result.stderr, '', describe(label, result));
  assert.ok(result.stdout.endsWith('}\n') && result.stdout.split('\n').length === 2, describe(`${label}: not one JSON line`, result));
  return JSON.parse(result.stdout);
}

function accountIn(object, id) {
  return object.accounts.find((account) => account.id === id);
}

async function jsonContract(ctx) {
  const state = await stateWith({ codex: windowsOf(10, 10), agy: windowsOf(10, 10), claude: windowsOf(83, 10), 'claude-work': windowsOf(0, 0) }, { agy: false });
  const object = jsonOf('seats 6 --json', await dandelion(['seats', '6', '--json', '--max-age', '600'], { ...ctx, state }), 0);
  assert.deepEqual(Object.keys(object), ['generatedAt', 'mode', 'requested', 'trip', 'seats', 'accounts']);
  assert.equal(object.mode, 'pack');
  assert.equal(object.requested, 6);
  assert.equal(object.trip, 80);
  assert.ok(Math.abs(Date.parse(object.generatedAt) - Date.now()) < OUTER_TIMEOUT_MS, object.generatedAt);
  assert.deepEqual(object.accounts.map((account) => account.id), IDS);
  for (const account of object.accounts) {
    assert.deepEqual(Object.keys(account), ACCOUNT_KEYS, account.id);
    assert.ok(account.skip === null || (REASONS.includes(account.skip.reason) && typeof account.skip.text === 'string' && 'backAt' in account.skip), JSON.stringify(account));
  }
  assert.deepEqual(object.seats.map((seat) => seat.line), ['model-i high codex', 'model-i high codex']);
  assert.deepEqual(object.seats[0], { account: 'codex', line: 'model-i high codex', model: 'model-i', effort: 'high', command: 'codex', lab: 'lab-a', kind: 'headroom', rank: null, rankName: null, held: false });
  for (const seat of object.seats) assert.deepEqual(Object.keys(seat), SEAT_KEYS);
  const codex = accountIn(object, 'codex');
  assert.deepEqual({ ...codex, windows: [] }, { id: 'codex', command: 'codex', cap: 2, held: 0, target: 2, score: 90, evaporating: false, balance: null, skip: null, windows: [] });
  assert.deepEqual(codex.windows.map(({ label, kind, usedPct }) => [label, kind, usedPct]), [['session', 'rolling', 10], ['weekly', 'weekly', 10]]);
  assert.ok(codex.windows.every(({ resetsAt }) => !Number.isNaN(Date.parse(resetsAt))), JSON.stringify(codex.windows));
  assert.equal(accountIn(object, 'claude').skip.reason, 'tripped');
  assert.match(accountIn(object, 'claude').skip.text, /^tripped at 83%, back [A-Z][a-z]{2} \d{2}:\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(accountIn(object, 'claude').skip.backAt)));
  assert.deepEqual(accountIn(object, 'claude-work').skip, { reason: 'excluded', text: 'excluded', backAt: null });
  assert.deepEqual(accountIn(object, 'agy').skip, { reason: 'ineligible', text: 'routing off', backAt: null });
  assert.deepEqual(accountIn(object, 'kilo'), { id: 'kilo', command: 'kilo', cap: 1, held: 0, target: 0, score: null, evaporating: false, balance: null, skip: { reason: 'unavailable', text: 'unavailable', backAt: null }, windows: [] });
}

async function plainAndWhy(ctx) {
  const state = await stateWith({ codex: windowsOf(10, 10), claude: windowsOf(83, 10) });
  const plain = await dandelion(['seats', '1', '--max-age', '600'], { ...ctx, state });
  assert.deepEqual(plain, { stdout: 'model-i high codex\n', stderr: '', status: 0 }, describe('seats 1', plain));
  const why = await dandelion(['seats', '1', '--why', '--max-age', '600'], { ...ctx, state });
  assert.equal(why.status, 0, describe('seats 1 --why', why));
  const lines = why.stdout.trimEnd().split('\n');
  assert.equal(lines[0], 'model-i high codex', describe('seats 1 --why', why));
  assert.match(lines[1], /^# skip claude: tripped at 83%, back [A-Z][a-z]{2} \d{2}:\d{2}$/, describe('seats 1 --why', why));
  assert.deepEqual(lines.slice(1).map((line) => line.split(':')[0].replace('# skip ', '')), IDS.filter((id) => id !== 'codex'), describe('skip lines in dashboard order', why));
}

async function heldAndSpread(ctx) {
  const state = await stateWith({ claude: [...windowsOf(0, 0), { label: 'weekly Fable', kind: 'weekly', usedPct: 5, resetsAt: inHours(72) }], codex: windowsOf(10, 10), cursor: [{ label: 'total', kind: 'weekly', usedPct: 5, resetsAt: inHours(72) }], grok: [{ label: 'credits', kind: 'weekly', usedPct: 5, resetsAt: inHours(72) }], agy: windowsOf(5, 5) });
  const held = jsonOf('seats 2 --held codex=2', await dandelion(['seats', '2', '--json', '--max-age', '600', '--held', 'codex=2'], { ...ctx, state }), 0);
  assert.deepEqual(held.seats.map(({ account, held: kept }) => [account, kept]), [['codex', true], ['codex', true]]);
  const fresh = jsonOf('seats 2', await dandelion(['seats', '2', '--json', '--max-age', '600'], { ...ctx, state }), 0);
  assert.deepEqual(fresh.seats.map(({ account }) => account), ['claude', 'agy']);
  const spread = jsonOf('seats 6 --spread', await dandelion(['seats', '6', '--spread', '--json', '--max-age', '600'], { ...ctx, state }), 0);
  assert.equal(spread.mode, 'spread');
  assert.deepEqual(spread.seats.map(({ line, kind, rank, rankName }) => [line, kind, rank, rankName]), [
    ['model-h1 max claude', 'chain', 1, 'fable'],
    ['model-i xhigh codex', 'chain', 2, 'codex'],
    ['model-h2 cursor', 'chain', 3, 'cursor'],
    ['model-h3 max claude', 'chain', 4, 'opus'],
    ['model-h4 xhigh grok', 'chain', 5, 'grok'],
    ['model-h5 high agy', 'chain', 6, 'agy']
  ]);
}

async function exitCodes(ctx) {
  const empty = await stateWith({});
  const none = await dandelion(['seats', '3', '--max-age', '600'], { ...ctx, state: empty });
  assert.deepEqual(none, { stdout: 'none\n', stderr: '', status: 1 }, describe('seats with nothing routable', none));
  const noneJson = jsonOf('seats --json with nothing routable', await dandelion(['seats', '3', '--json', '--max-age', '600'], { ...ctx, state: empty }), 1);
  assert.deepEqual(noneJson.seats, []);
  assert.equal(noneJson.accounts.length, IDS.length);
  for (const args of [['seats', '0'], ['seats', '3', '--pack', '--spread'], ['seats', '201'], ['seats'], ['seats', '3', '--bogus'], ['seats', '3', '--held', 'claude-wrok=1'], ['seats', '3', '--cap', 'codex=21'], ['seats', '3', '--trip', '91']]) {
    const result = await dandelion(args, { ...ctx, state: empty });
    assert.equal(result.status, 2, describe(args.join(' '), result));
    assert.equal(result.stdout, '', describe(args.join(' '), result));
    assert.match(result.stderr, /^dandelion: seats: [^\n]+\n$/, describe(args.join(' '), result));
  }
  const missingRoutes = join(await tempDir(), 'nope.json');
  const bad = await dandelion(['seats', '3', '--json', '--max-age', '600'], { ...ctx, routes: missingRoutes, state: empty });
  assert.deepEqual(bad, { stdout: '', stderr: `dandelion: routes file ${missingRoutes}: cannot be read\n`, status: 2 }, describe('seats with a bad routes file', bad));
  const unknownKey = await dandelion(['seats', '3', '--max-age', '600'], { ...ctx, routes: await routesWith({ swarm: { trip: 95 } }), state: empty });
  assert.equal(unknownKey.status, 2, describe('swarm.trip 95', unknownKey));
  assert.match(unknownKey.stderr, /^dandelion: routes file [^\n]*: swarm\.trip is not a whole percent from 50 to 90\n$/, describe('swarm.trip 95', unknownKey));
}

async function jsonDispatch(ctx) {
  const state = await stateWith({ codex: windowsOf(10, 10) });
  const object = jsonOf('seats 3 --json', await dandelion(['seats', '3', '--json'], { ...ctx, state, bin: ctx.bare }), 1);
  assert.equal(object.providers, undefined, 'seats --json printed the dashboard JSON');
  assert.ok(Array.isArray(object.seats) && Array.isArray(object.accounts));
}

async function headlessLaunch(ctx) {
  const repo = await tempDir();
  const prompt = join(await tempDir(), 'prompt.md');
  await writeFile(prompt, PROMPT);
  const state = await stateWith({});
  const routes = await routesWith({ headless: { codex: { before: ['exec'], after: ['--yes', '{promptFile}', '{prompt}'], stdin: true }, claude: { before: [], after: ['-p'], stdin: false } } });
  const launched = await dandelion(['run', '--headless', '--seat', 'model-i high codex-animus', '--prompt-file', prompt, '--cwd', repo, '--timeout', '30'], { routes, state, bin: ctx.cliBin });
  assert.deepEqual(launched, { stdout: 'fake stdout\n', stderr: 'fake stderr\n', status: 7 }, describe('run --headless', launched));
  const seen = JSON.parse(await readFile(join(repo, 'seen.json'), 'utf8'));
  assert.deepEqual(seen.args, ['exec', '--model', 'model-i', '-c', 'model_reasoning_effort=high', '--yes', prompt, PROMPT]);
  assert.equal(seen.stdin, PROMPT);
  assert.equal(seen.cwd, repo);
  assert.equal(seen.pwd, repo);
  assert.ok(seen.home.endsWith('/.codex-animus'), seen.home);
  const quiet = await tempDir();
  await dandelion(['run', '--headless', '--seat', 'model-a high claude', '--prompt-file', prompt, '--cwd', quiet], { routes, state, bin: ctx.cliBin });
  assert.equal(JSON.parse(await readFile(join(quiet, 'seen.json'), 'utf8')).stdin, '', 'a non-stdin template still got the prompt on stdin');

  const started = Date.now();
  const timedOut = await dandelion(['run', '--headless', '--seat', 'sleep claude', '--prompt-file', prompt, '--cwd', repo, '--timeout', '1'], { routes, state, bin: ctx.cliBin });
  assert.deepEqual(timedOut, { stdout: '', stderr: '', status: 124 }, describe('run --headless --timeout 1', timedOut));
  assert.ok(Date.now() - started < 10000, `timeout took ${Date.now() - started}ms`);
  const missing = await dandelion(['run', '--headless', '--seat', 'model-a high claude', '--prompt-file', prompt, '--cwd', repo], { routes, state, bin: ctx.bare });
  assert.deepEqual(missing, { stdout: '', stderr: 'dandelion: claude: command not found\n', status: 127 }, describe('run --headless without the CLI', missing));
  const none = await dandelion(['run', '--headless', '--prompt-file', prompt, '--cwd', repo, '--max-age', '600'], { routes, state, bin: ctx.cliBin });
  assert.deepEqual(none, { stdout: '', stderr: 'none\n', status: 1 }, describe('run --headless with nothing routable', none));
  const usage = [
    [['--seat', 'model-a high claude', '--cwd', repo], 'dandelion: run: --prompt-file is required\n'],
    [['--seat', 'model-a high claude', '--prompt-file', join(repo, 'nope.md'), '--cwd', repo], `dandelion: run: prompt file ${join(repo, 'nope.md')} cannot be read\n`],
    [['--seat', 'model-a high claude', '--prompt-file', prompt, '--cwd', join(repo, 'nope')], `dandelion: run: --cwd ${join(repo, 'nope')} is not a directory\n`],
    [['--seat', 'model-a high claudee', '--prompt-file', prompt, '--cwd', repo], 'dandelion: run: unknown account claudee\n'],
    [['--seat', 'model-c high agy', '--prompt-file', prompt, '--cwd', repo], 'dandelion: run: no headless template for agy\n']
  ];
  for (const [args, stderr] of usage) {
    const result = await dandelion(['run', '--headless', ...args], { routes, state, bin: ctx.cliBin });
    assert.deepEqual(result, { stdout: '', stderr, status: 2 }, describe(`run --headless ${args.join(' ')}`, result));
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
  try {
    const bare = await fakeBin(false);
    const ctx = { routes: await routesWith({}), bin: bare, bare, cliBin: await fakeBin(true) };
    await jsonContract(ctx);
    await plainAndWhy(ctx);
    await heldAndSpread(ctx);
    await exitCodes(ctx);
    await jsonDispatch(ctx);
    await headlessLaunch(ctx);
  } finally {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
