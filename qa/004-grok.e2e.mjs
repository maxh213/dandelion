import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, readdir, stat, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_DIR = dirname(process.execPath);
let nodeBinDir = '';
const OUTER_TIMEOUT_MS = 60000;
const PREFIX = 'allowance-qa-004-';
const CLAUDE_FIXTURE = "#!/bin/sh\nprintf '%s\\n' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)'\n";
const AGY_FIXTURE = "#!/bin/sh\nprintf 'Gemini Models\\tWeekly Limit Remaining\\t100%%\\t2026-09-20T17:13:45Z\\n'\n";
const KIMI_FIXTURE = '#!/bin/sh\nexit 0\n';
const KILO_FIXTURE = "#!/bin/sh\n[ \"$1\" = \"profile\" ] || exit 2\necho 'Balance: $14.15'\n";
const PERIOD = { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-06T21:15:36.133376+00:00', end: '2026-09-13T21:15:36.133376+00:00' };

function backgroundLines(newestTs) {
  const billing = (ts, percent, tier) => JSON.stringify({
    ts,
    msg: 'billing: fetched credits config',
    ctx: { config: { creditUsagePercent: percent, currentPeriod: PERIOD }, subscriptionTier: tier }
  });
  return [
    '{"ts":"2026-09-11T08:00:00.000Z","msg":"session started","ctx":{}}',
    billing('2026-09-11T09:00:00.000Z', 60.0, 'SuperGrok'),
    'not json at all',
    billing(newestTs, 75.0, 'SuperGrok Heavy'),
    '{"ts":"2026-09-12T16:00:01.000Z","msg":"tool call finished","ctx":{"tool":"bash"}}',
    ''
  ].join('\n');
}

async function fixtureBin() {
  const dir = await mkdtemp(join(tmpdir(), PREFIX));
  const scripts = { claude: CLAUDE_FIXTURE, agy: AGY_FIXTURE, kimi: KIMI_FIXTURE, kilo: KILO_FIXTURE };
  for (const [name, body] of Object.entries(scripts)) {
    await writeFile(join(dir, name), body);
    await chmod(join(dir, name), 0o755);
  }
  return dir;
}

async function snapshotTree(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    const info = await stat(path);
    const content = entry.isFile() ? await readFile(path, 'utf8') : '';
    records.push([path, info.size, info.mtimeMs, content]);
  }
  return records.sort(([a], [b]) => a.localeCompare(b));
}

function runApp(binDir, grokHome) {
  const { NO_COLOR, ALLOWANCE_KILO_REFERENCE, ALLOWANCE_KIMI_PORT, ALLOWANCE_GROK_HOME, ...inherited } = process.env;
  const env = { ...inherited, PATH: `${binDir}:${nodeBinDir}`, NO_COLOR: '1', ALLOWANCE_GROK_HOME: grokHome };
  const result = spawnSync(join(NODE_DIR, 'npm'), ['start', '--silent'], { cwd: rootDir, env, encoding: 'utf8', timeout: OUTER_TIMEOUT_MS });
  assert.equal(result.error, undefined, `spawn failed or hit the outer timeout: ${result.error}`);
  assert.equal(result.status, 0, `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result.stdout;
}

async function runUnchanged(binDir, grokHome) {
  const before = await snapshotTree(grokHome);
  const stdout = runApp(binDir, grokHome);
  assert.deepEqual(await snapshotTree(grokHome), before, 'grok home changed during the run');
  return stdout;
}

function lineIndex(lines, pattern) {
  const index = lines.findIndex((line) => pattern.test(line));
  assert.ok(index >= 0, `no line matches ${pattern}:\n${lines.join('\n')}`);
  return index;
}

async function grokShowsNewestSnapshot(binDir) {
  const grokHome = await mkdtemp(join(tmpdir(), PREFIX));
  try {
    await mkdir(join(grokHome, 'logs'));
    await writeFile(join(grokHome, 'logs', 'unified.jsonl'), backgroundLines(new Date(Date.now() - 3600 * 1000).toISOString()));
    const stdout = await runUnchanged(binDir, grokHome);
    const lines = stdout.split('\n');
    const kimi = lineIndex(lines, /^kimi$/);
    const grok = lineIndex(lines, /^grok$/);
    const kilo = lineIndex(lines, /^kilo$/);
    assert.ok(kimi < grok && grok < kilo, `grok panel is not between kimi and kilo:\n${stdout}`);
    const credits = lineIndex(lines, /^credits {29}#{15}-{5} {2}75%/);
    const snapshot = lineIndex(lines, /^snapshot /);
    const caption = lines.indexOf('SuperGrok Heavy · grok');
    assert.ok(grok < credits && credits < snapshot && snapshot < caption && caption < kilo, `grok rows not inside the grok panel:\n${stdout}`);
  } finally {
    await rm(grokHome, { recursive: true, force: true });
  }
}

async function grokUnavailableWithEmptyHome(binDir) {
  const grokHome = await mkdtemp(join(tmpdir(), PREFIX));
  try {
    const stdout = await runUnchanged(binDir, grokHome);
    assert.ok(stdout.includes('\ngrok\nno grok billing snapshot — run grok once\ngrok · grok\n'), `grok panel is not unavailable:\n${stdout}`);
  } finally {
    await rm(grokHome, { recursive: true, force: true });
  }
}

async function noRuntimeDependencies() {
  const manifest = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies, undefined, 'package.json has a dependencies section');
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
    await noRuntimeDependencies();
    const binDir = await fixtureBin();
    try {
      await grokShowsNewestSnapshot(binDir);
      await grokUnavailableWithEmptyHome(binDir);
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  } finally {
    await rm(nodeBinDir, { recursive: true, force: true });
  }
}
