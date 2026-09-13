import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_DIR = dirname(process.execPath);
let nodeBinDir = '';
const ESC = '\x1b[';
const COUNTDOWN = String.raw`↻ (\d+h\d+m|\d+d\d+h)`;
const CLAUDE_LINES = [
  'Current session: 3% used · resets Sep 13, 7:40pm (Europe/London)',
  'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)',
  'Current week (Fable): 100% used · resets Sep 13, 11pm (Europe/London)',
  '',
  "What's contributing to your usage",
  'Current nonsense: 42% used',
];

function isoFromNow(ms) {
  return new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function agyFixture() {
  const week = isoFromNow((7 * 24 * 60 + 5) * 60000);
  const hours = isoFromNow((2 * 60 + 5) * 60000);
  const rows = [
    ['Gemini Models', 'Weekly Limit Remaining', '100%%', week],
    ['Gemini Models', 'Five Hour Limit Remaining', '100%%', hours],
    ['Claude and GPT models', 'Weekly Limit Remaining', '100%%', week],
    ['Claude and GPT models', 'Five Hour Limit Remaining', '25%%', hours],
  ];
  return `#!/bin/sh\n${rows.map((row) => `printf '${row.join('\\t')}\\n'`).join('\n')}\n`;
}

function claudeFixture() {
  const quoted = CLAUDE_LINES.map((line) => `'${line.replaceAll("'", `'\\''`)}'`).join(' ');
  return `#!/bin/sh\nprintf '%s\\n' ${quoted}\n`;
}

const KILO_FIXTURE = "#!/bin/sh\n[ \"$1\" = \"profile\" ] || exit 2\necho 'Balance: $14.15'\n";

async function writeExecutable(dir, name, body) {
  await writeFile(join(dir, name), body);
  await chmod(join(dir, name), 0o755);
}

async function fixtureDir(overrides) {
  const dir = await mkdtemp(join(tmpdir(), 'allowance-qa-002-'));
  const scripts = { claude: claudeFixture(), agy: agyFixture(), kilo: KILO_FIXTURE, ...overrides };
  for (const [name, body] of Object.entries(scripts)) {
    if (body !== undefined) await writeExecutable(dir, name, body);
  }
  return dir;
}

function runApp(dir, extraEnv) {
  const { NO_COLOR, ALLOWANCE_KILO_REFERENCE, ALLOWANCE_GROK_HOME, ...inherited } = process.env;
  const env = { ...inherited, PATH: `${dir}:${nodeBinDir}`, ALLOWANCE_GROK_HOME: dir, ...extraEnv };
  const result = spawnSync(process.execPath, ['src/main.ts'], { cwd: rootDir, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined, `spawn failed: ${result.error}`);
  assert.equal(result.status, 0, `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result.stdout;
}

function stripAnsi(text) {
  return text.replaceAll(/\x1b\[[0-9;]*m/g, '');
}

function assertWidth(stdout) {
  for (const line of stripAnsi(stdout).split('\n')) {
    assert.ok([...line].length <= 72, `line wider than 72 columns: ${JSON.stringify(line)}`);
  }
}

function lineIndex(lines, pattern) {
  const index = lines.findIndex((line) => pattern.test(line));
  assert.ok(index >= 0, `no line matches ${pattern}:\n${lines.join('\n')}`);
  return index;
}

function assertPanelOrder(plain) {
  const lines = plain.split('\n');
  const banner = lineIndex(lines, /^ALLOWANCE +\d{2}:\d{2}:\d{2}Z$/);
  const claude = lineIndex(lines, /^claude$/);
  const agy = lineIndex(lines, /^agy$/);
  const kilo = lineIndex(lines, /^kilo$/);
  assert.ok(banner < claude && claude < agy && agy < kilo, `panels out of order:\n${plain}`);
  return lines;
}

async function threeProvidersInOrder(dir) {
  const stdout = runApp(dir, {});
  const plain = stripAnsi(stdout);
  const lines = assertPanelOrder(plain);
  assert.ok(lines.indexOf('claude code · claude') > lines.indexOf('claude'), 'claude caption missing');
  assert.ok(lines.indexOf('agy · agy') > lines.indexOf('agy'), 'agy caption missing');
  assert.ok(lines.indexOf('api balance · kilo') > lines.indexOf('kilo'), 'kilo caption missing');
  assert.ok(stdout.includes(`${ESC}90mclaude code · claude`), 'claude caption is not dim');
  assert.ok(plain.includes(`$14.15 ${'█'.repeat(14)}${'░'.repeat(6)}`), `kilo gauge changed:\n${plain}`);
  assert.match(plain, new RegExp(`^weekly {30}${'█'.repeat(17)}${'░'.repeat(3)}  86% ${COUNTDOWN}$`, 'm'));
  assert.match(plain, new RegExp(`^session {29}█${'░'.repeat(19)}   3% ${COUNTDOWN}$`, 'm'));
  assert.match(plain, new RegExp(`^weekly Fable {24}${'█'.repeat(20)} 100% ${COUNTDOWN}$`, 'm'));
  assert.ok(!plain.includes('nonsense'), 'claude trailing section rendered');
  assert.match(plain, new RegExp(`^Gemini Models · Weekly Limit {8}${'░'.repeat(20)}   0% ↻ (7d0h|6d23h)$`, 'm'));
  assert.match(plain, new RegExp(`^Claude and GPT models · Five Hour…  ${'█'.repeat(15)}${'░'.repeat(5)}  75% ↻ [12]h\\d+m$`, 'm'));
  assertWidth(stdout);
}

function escapeBefore(stdout, label) {
  const line = stdout.split('\n').find((candidate) => candidate.startsWith(`${label} `) && candidate.includes(ESC));
  assert.ok(line, `no styled row for ${label}`);
  const match = new RegExp(String.raw`^${label} +(\x1b\[[0-9;]*m)[█░]{20}\x1b\[0m (\x1b\[[0-9;]*m) *\d+%\x1b\[0m ↻ [^\x1b]+$`).exec(line);
  assert.ok(match, `gauge and percent of ${label} are not each wrapped in a style escape: ${JSON.stringify(line)}`);
  assert.equal(match[1], match[2], `gauge and percent of ${label} carry different escapes`);
  return match[1];
}

async function rampStylesRows(dir) {
  const stdout = runApp(dir, {});
  const calm = escapeBefore(stdout, 'session');
  const hot = escapeBefore(stdout, 'weekly');
  const critical = escapeBefore(stdout, 'weekly Fable');
  assert.notEqual(calm, hot, 'calm and hot rows share an escape');
  assert.notEqual(critical, calm, 'critical and calm rows share an escape');
  assert.notEqual(critical, hot, 'critical and hot rows share an escape');
}

async function noColorRows(dir) {
  const stdout = runApp(dir, { NO_COLOR: '1' });
  assert.ok(!stdout.includes('\x1b'), 'NO_COLOR output contains escape codes');
  assertPanelOrder(stdout);
  assert.match(stdout, new RegExp(`^weekly {30}#{17}-{3}  86% ${COUNTDOWN}$`, 'm'));
  assert.match(stdout, /^Gemini Models · Weekly Limit {8}-{20}   0% ↻ (7d0h|6d23h)$/m);
  assert.match(stdout, /^Claude and GPT models · Weekly Lim… -{20}   0% ↻ (7d0h|6d23h)$/m);
  assert.ok(stdout.includes(`$14.15 ${'#'.repeat(14)}${'-'.repeat(6)}`), 'kilo gauge not ASCII');
  assert.ok(/^[\x0a\x20-\x7e↻·…—]*$/.test(stdout), `non-ASCII beyond ↻ · … —:\n${stdout}`);
  assertWidth(stdout);
}

function unavailablePanel(stdout, name, reason, caption) {
  const plain = stripAnsi(stdout);
  assert.ok(plain.includes(`\n${name}\n${reason}\n${caption}\n`), `${name} panel is not unavailable with "${reason}":\n${plain}`);
  assert.ok(stdout.includes(`${ESC}90m${'━'.repeat(72)}\n${name}\n${reason}\n${caption}${ESC}0m`), `${name} unavailable panel is not dim`);
}

async function failingClaude() {
  const dir = await fixtureDir({ claude: '#!/bin/sh\nexit 1\n' });
  try {
    const stdout = runApp(dir, {});
    unavailablePanel(stdout, 'claude', 'Command failed or timed out', 'claude code · claude');
    assert.match(stripAnsi(stdout), /^Gemini Models · Weekly Limit /m);
    assert.ok(stripAnsi(stdout).includes('$14.15 '), 'kilo panel missing');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function garbageAgy() {
  const dir = await fixtureDir({ agy: '#!/bin/sh\necho hello world\n' });
  try {
    const stdout = runApp(dir, {});
    unavailablePanel(stdout, 'agy', 'Could not parse usage from output', 'agy · agy');
    assert.match(stripAnsi(stdout), /^weekly {30}/m);
    assert.ok(stripAnsi(stdout).includes('$14.15 '), 'kilo panel missing');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function noCliOnPath() {
  const dir = await mkdtemp(join(tmpdir(), 'allowance-qa-002-empty-'));
  try {
    const stdout = runApp(dir, {});
    assertPanelOrder(stripAnsi(stdout));
    unavailablePanel(stdout, 'claude', 'claude CLI not found in PATH', 'claude code · claude');
    unavailablePanel(stdout, 'agy', 'agy CLI not found in PATH', 'agy · agy');
    unavailablePanel(stdout, 'kilo', 'kilo CLI not found in PATH', 'api balance · kilo');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function nodeBin() {
  const dir = await mkdtemp(join(tmpdir(), 'allowance-nodebin-'));
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  return dir;
}

export default async function () {
  nodeBinDir = await nodeBin();
  try {
    const dir = await fixtureDir({});
    try {
      await threeProvidersInOrder(dir);
      await rampStylesRows(dir);
      await noColorRows(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    await failingClaude();
    await garbageAgy();
    await noCliOnPath();
  } finally {
    await rm(nodeBinDir, { recursive: true, force: true });
  }
}
