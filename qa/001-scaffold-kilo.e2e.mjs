import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = 'Name: Max\nEmail: yeti213@googlemail.com\nTeam: Personal\nBalance: $14.15\n';
const ESC = '\x1b[';
const ALLOWED_GLYPHS = /[↻·…—]/g;
let nodeBinDir = '';
const CLAUDE_FIXTURE = "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'\n";
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const KIMI_FIXTURE = '#!/bin/sh\nexit 0\n';
const CODEX_FIXTURE = '#!/bin/sh\nexit 1\n';

async function kiloFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'allowance-qa-kilo-'));
  const script = join(dir, 'kilo');
  const quoted = PROFILE.replaceAll('\n', '\\n').replaceAll('$', '\\$');
  await writeFile(script, `#!/bin/sh\n[ "$1" = "profile" ] || exit 2\nprintf "${quoted}"\n`);
  await chmod(script, 0o755);
  for (const [name, body] of [['claude', CLAUDE_FIXTURE], ['agy', AGY_FIXTURE], ['kimi', KIMI_FIXTURE], ['codex', CODEX_FIXTURE]]) {
    await writeFile(join(dir, name), body);
    await chmod(join(dir, name), 0o755);
  }
  return dir;
}

async function emptyPathFixture() {
  return mkdtemp(join(tmpdir(), 'allowance-qa-empty-'));
}

function runApp(path, extraEnv) {
  const { NO_COLOR, ALLOWANCE_KILO_REFERENCE, ALLOWANCE_GROK_HOME, ALLOWANCE_CURSOR_API_BASE, ...inherited } = process.env;
  const home = path.split(':')[0];
  const env = { ...inherited, PATH: path, ALLOWANCE_GROK_HOME: home, ALLOWANCE_CURSOR_AUTH_FILE: join(home, 'no-cursor-auth.json'), ...extraEnv };
  const result = spawnSync(process.execPath, ['src/main.ts', '--once'], { cwd: rootDir, env, encoding: 'utf8', timeout: 30000 });
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

function assertAscii(stdout) {
  for (const line of stdout.split('\n')) {
    const checked = line.replaceAll(ALLOWED_GLYPHS, '');
    assert.ok(/^[\x20-\x7e]*$/.test(checked), `NO_COLOR line is not ASCII: ${JSON.stringify(line)}`);
  }
}

async function happyPathDefaultReference(kiloDir) {
  const stdout = runApp(`${kiloDir}:${nodeBinDir}`, {});
  const plain = stripAnsi(stdout);
  assert.match(plain, /^ALLOWANCE +\d{2}:\d{2}:\d{2}Z$/m);
  assert.match(plain, /^kilo$/m);
  assert.ok(plain.includes('━'.repeat(72)), 'missing heavy top rule');
  assert.ok(plain.includes(`$14.15 ${'█'.repeat(14)}${'░'.repeat(6)}`), `missing 14/6 gauge:\n${plain}`);
  assert.ok(stdout.includes(`${ESC}90mapi balance · kilo`), 'caption is not dim');
  assert.ok(!plain.includes('not found'), 'happy path rendered an unavailable reason');
  assertWidth(stdout);
}

async function customReferenceFillsGauge(kiloDir) {
  const stdout = runApp(`${kiloDir}:${nodeBinDir}`, { NO_COLOR: '1', ALLOWANCE_KILO_REFERENCE: '10' });
  assert.ok(!stdout.includes(ESC), 'NO_COLOR output contains escape codes');
  assert.match(stdout, /^ALLOWANCE /m);
  assert.ok(stdout.includes(`$14.15 ${'#'.repeat(20)}`), `gauge not full at reference 10:\n${stdout}`);
  assertAscii(stdout);
  assertWidth(stdout);
}

async function missingKiloRendersUnavailable(emptyDir) {
  const stdout = runApp(`${emptyDir}:${nodeBinDir}`, {});
  const plain = stripAnsi(stdout);
  assert.match(plain, /^ALLOWANCE /m);
  assert.match(plain, /^kilo\nkilo CLI not found in PATH\n/m);
  assert.ok(!plain.includes('Command failed'), 'generic failure reason instead of missing CLI');
  assert.ok(!/[█░#]{20}/.test(plain), 'unavailable panel still shows a gauge');
  assert.ok(!plain.includes('$'), 'unavailable panel shows a balance');
  const panel = stdout.slice(stdout.indexOf('\n') + 1);
  assert.ok(panel.startsWith(`${ESC}90m`), 'unavailable panel is not dim');
  assertWidth(stdout);
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
    const kiloDir = await kiloFixture();
    const emptyDir = await emptyPathFixture();
    try {
      await happyPathDefaultReference(kiloDir);
      await customReferenceFillsGauge(kiloDir);
      await missingKiloRendersUnavailable(emptyDir);
    } finally {
      await rm(kiloDir, { recursive: true, force: true });
      await rm(emptyDir, { recursive: true, force: true });
    }
  } finally {
    await rm(nodeBinDir, { recursive: true, force: true });
  }
}
