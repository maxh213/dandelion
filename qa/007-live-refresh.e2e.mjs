import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  NPM, ENTER, CLEAR, RESTORE, IDS, KIMI_EXITS,
  fixtureDir, appEnv, launch, startLive, completeFrames, waitWithin, assertClosed, inSession
} from './live-session.mjs';

const KIMI_STAYS = `#!/usr/bin/env node
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'kimi.pid'), String(process.pid));
setInterval(() => {}, 1000);
`;

function settledIndex(run) {
  return completeFrames(run).findIndex((frame) => !frame.includes('probing…'));
}

function refreshedAfterSettle(run) {
  const settled = settledIndex(run);
  return settled >= 0 && completeFrames(run).slice(settled + 1).some((frame) => frame.split('\n')[0].includes('refreshing…'));
}

async function pidIn(pidFile) {
  return Number(await readFile(pidFile, 'utf8').catch(() => '0'));
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function liveFramesThenQuit() {
  const run = startLive(await appEnv(await fixtureDir(KIMI_EXITS)));
  await waitWithin(run, () => settledIndex(run) >= 0, 20000, 'frame with no probing…');
  await waitWithin(run, () => refreshedAfterSettle(run), 40000, 'later frame whose banner has refreshing…');
  run.child.stdin.write('q');
  await assertClosed(run);
  assert.ok(run.output.includes(ENTER), `no alternate-screen enter:\n${run.output}`);
  assert.ok(run.output.lastIndexOf(RESTORE) > run.output.lastIndexOf(CLEAR), `no terminal restore after the last frame:\n${JSON.stringify(run.output.slice(-400))}`);
}

async function quitReapsKimi() {
  const dir = await fixtureDir(KIMI_STAYS);
  const pidFile = join(dir, 'kimi.pid');
  const run = startLive(await appEnv(dir));
  let pid = 0;
  const polling = setInterval(async () => (pid = await pidIn(pidFile)), 20);
  try {
    await waitWithin(run, () => pid > 0, 20000, 'kimi pid file');
  } finally {
    clearInterval(polling);
  }
  const quitAt = Date.now();
  run.child.stdin.write('q');
  await assertClosed(run);
  const took = Date.now() - quitAt;
  assert.ok(took < 7000, `quit took ${took}ms`);
  assert.equal(isRunning(pid), false, `kimi fixture pid ${pid} is still running`);
}

async function pipedRunsOnce() {
  const run = launch(NPM, ['start', '--silent'], await appEnv(await fixtureDir(KIMI_EXITS)));
  await assertClosed(run);
  run.child.stdin.destroy();
  const lines = run.output.split('\n');
  assert.match(lines[0], /^DANDELION +\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(lines.filter((line) => IDS.includes(line)), IDS);
  assert.equal(run.output.split('DANDELION').length, 2, `more than one dashboard:\n${run.output}`);
  assert.ok(!run.output.includes('probing…'), `pending panel in once output:\n${run.output}`);
  assert.ok(!run.output.includes(ENTER), 'piped output entered the alternate screen');
}

export default async function () {
  await inSession(liveFramesThenQuit);
  await inSession(quitReapsKimi);
  await inSession(pipedRunsOnce);
}
