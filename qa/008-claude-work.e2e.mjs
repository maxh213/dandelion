import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const NPM = join(dirname(process.execPath), 'npm');
const OUTER_TIMEOUT_MS = 60000;
const PREFIX = 'dandelion-qa-008-';
const PANEL_ORDER = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'codex', 'cursor', 'kilo'];
const NO_WORK_CONFIG = 'no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude';
const PERSONAL_LINES = [
  'Current session: 3% used · resets Sep 13, 7:40pm (Europe/London)',
  'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)',
  'Current week (Fable): 100% used · resets Sep 13, 11pm (Europe/London)',
  '',
  "What's contributing to your usage",
  'Current nonsense: 42% used',
];
const WORK_LINES = [
  'Current session: 0% used · resets Sep 13, 11:10pm (Europe/London)',
  'Current week (all models): 12% used · resets Sep 15, 6pm (Europe/London)',
  'Current week (Fable): 23% used · resets Sep 15, 6pm (Europe/London)',
];
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const KIMI_FIXTURE = '#!/bin/sh\nexit 0\n';
const CODEX_FIXTURE = "#!/bin/sh\necho 'Logged in using an API key - sk-proj-***n5zQA' >&2\n";
const KILO_FIXTURE = "#!/bin/sh\n[ \"$1\" = \"profile\" ] || exit 2\necho 'Balance: $14.15'\n";

const temps = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), PREFIX));
  temps.push(dir);
  return dir;
}

function printLines(lines) {
  return `printf '%s\\n' ${lines.map((line) => `'${line.replaceAll("'", `'\\''`)}'`).join(' ')}`;
}

function claudeFixture(dir) {
  return [
    '#!/bin/sh',
    `echo "\${CLAUDE_CONFIG_DIR:--}" >> '${join(dir, 'claude.calls')}'`,
    '[ "$#" = 2 ] && [ "$1" = "-p" ] && [ "$2" = "/usage" ] || exit 2',
    'if [ -n "$CLAUDE_CONFIG_DIR" ]; then',
    printLines(WORK_LINES),
    'else',
    printLines(PERSONAL_LINES),
    'fi',
    '',
  ].join('\n');
}

async function fixtureDir() {
  const dir = await tempDir();
  const scripts = { claude: claudeFixture(dir), agy: AGY_FIXTURE, kimi: KIMI_FIXTURE, codex: CODEX_FIXTURE, kilo: KILO_FIXTURE };
  for (const [name, body] of Object.entries(scripts)) {
    await writeFile(join(dir, name), body);
    await chmod(join(dir, name), 0o755);
  }
  return dir;
}

async function nodeBin() {
  const dir = await tempDir();
  await symlink(process.execPath, join(dir, 'node'));
  await symlink('/bin/sh', join(dir, 'sh'));
  return dir;
}

function runOnce(pathDir, bin, grokHome, workConfigDir) {
  const { DANDELION_KILO_REFERENCE, DANDELION_KIMI_PORT, DANDELION_CURSOR_API_BASE, CODEX_FIXTURE_MODE, CLAUDE_CONFIG_DIR, ...inherited } = process.env;
  const env = {
    ...inherited,
    PATH: `${pathDir}:${bin}`,
    NO_COLOR: '1',
    CODEX_FIXTURE_MODE: 'apikey',
    DANDELION_GROK_HOME: grokHome,
    DANDELION_CURSOR_AUTH_FILE: join(grokHome, 'missing-auth.json'),
    DANDELION_CLAUDE_WORK_CONFIG_DIR: workConfigDir,
    DANDELION_STATE_FILE: join(workConfigDir, 'no-state', 'eligibility.json'),
  };
  const result = spawnSync(NPM, ['start', '--silent', '--', '--once'], { cwd: rootDir, env, encoding: 'utf8', timeout: OUTER_TIMEOUT_MS });
  assert.equal(result.error, undefined, `spawn failed or hit the outer timeout: ${result.error}`);
  assert.equal(result.status, 0, `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { stdout: result.stdout, lines: result.stdout.split('\n') };
}

function panel(run, name) {
  const starts = PANEL_ORDER.map((id) => run.lines.indexOf(id));
  assert.ok(starts.every((at) => at >= 0), `a panel is missing:\n${run.stdout}`);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts, `panels are not in the order ${PANEL_ORDER.join(', ')}:\n${run.stdout}`);
  const at = PANEL_ORDER.indexOf(name);
  const end = at + 1 < PANEL_ORDER.length ? starts[at + 1] - 1 : run.lines.length;
  return run.lines.slice(starts[at], end).filter((line) => line !== '');
}

function assertPersonalPanel(run) {
  const lines = panel(run, 'claude');
  assert.equal(lines.at(-1), 'claude · personal · claude', `claude caption:\n${run.stdout}`);
  assert.equal(lines.length, 5, `claude panel rows:\n${run.stdout}`);
  assert.match(lines[1], /^session +#-{19} {3}3% ↻ /);
  assert.match(lines[2], /^weekly +#{17}-{3} {2}86% ↻ /);
  assert.match(lines[3], /^weekly Fable +#{20} 100% ↻ /);
  assert.ok(lines[2].includes(' 86%'));
}

async function claudeCalls(dir) {
  return (await readFile(join(dir, 'claude.calls'), 'utf8')).split('\n').filter(Boolean);
}

function assertWidth(run, allowed = []) {
  for (const line of run.lines) {
    if (!allowed.includes(line)) assert.ok([...line].length <= 72, `line over 72 columns: ${JSON.stringify(line)}`);
  }
}

async function bothAccounts(bin) {
  const dir = await fixtureDir();
  const workConfigDir = await tempDir();
  const run = runOnce(dir, bin, await tempDir(), workConfigDir);
  assertPersonalPanel(run);
  const work = panel(run, 'claude-work');
  assert.equal(work.length, 5, `claude-work panel rows:\n${run.stdout}`);
  assert.equal(work[4], 'claude · work · claude-work', `claude-work caption:\n${run.stdout}`);
  assert.match(work[1], /^session {29}-{20} {3}0% ↻ \S+$/);
  assert.match(work[2], /^weekly {30}#{2}-{18} {2}12% ↻ \S+$/);
  assert.match(work[3], /^weekly Fable {24}#{5}-{15} {2}23% ↻ \S+$/);
  assertWidth(run);
  assert.deepEqual((await claudeCalls(dir)).sort(), ['-', workConfigDir].sort(), 'claude.calls');
}

async function missingWorkConfig(bin) {
  const dir = await fixtureDir();
  const workConfigDir = join(await tempDir(), 'no-such-dir');
  const run = runOnce(dir, bin, await tempDir(), workConfigDir);
  assertPersonalPanel(run);
  assert.deepEqual(panel(run, 'claude-work'), ['claude-work', NO_WORK_CONFIG, 'claude · work · claude-work'], `claude-work panel:\n${run.stdout}`);
  assertWidth(run, [NO_WORK_CONFIG]);
  assert.deepEqual(await claudeCalls(dir), ['-'], 'claude.calls');
}

async function assertNoQaProcessLeft() {
  const entries = await readdir('/proc');
  for (const entry of entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)) {
    const cmdline = await readFile(join('/proc', entry, 'cmdline'), 'utf8').catch(() => '');
    assert.ok(!cmdline.includes(PREFIX), `process ${entry} still running: ${cmdline.replaceAll('\0', ' ')}`);
  }
}

async function noRuntimeDependencies() {
  const manifest = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies, undefined, 'package.json has a dependencies section');
}

export default async function () {
  await noRuntimeDependencies();
  try {
    const bin = await nodeBin();
    await bothAccounts(bin);
    await missingWorkConfig(bin);
  } finally {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
  await assertNoQaProcessLeft();
}
