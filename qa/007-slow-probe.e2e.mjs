import assert from 'node:assert/strict';
import {
  NPM, KIMI_EXITS, OTHER_PANELS,
  fixtureDir, appEnv, launch, startLive, completeFrames, waitWithin, assertClosed, inSession
} from './live-session.mjs';

const SLOW_KILO = '#!/usr/bin/env node\nsetTimeout(() => console.log("Balance: $14.15"), 60000);\n';
const KILO_PENDING = /\nkilo\n\S probing…$/;
const KILO_TIMED_OUT = '\nkilo\nCommand timed out after 20s\napi balance · kilo';

function othersDoneKiloPending(frame) {
  return OTHER_PANELS.every((panel) => panel.test(frame)) && KILO_PENDING.test(frame);
}

async function hangingKiloLive() {
  const run = startLive(await appEnv(await fixtureDir(KIMI_EXITS, SLOW_KILO)));
  await waitWithin(run, () => completeFrames(run).some(othersDoneKiloPending), 5000, 'frame with six settled panels and a pending kilo');
  await waitWithin(run, () => completeFrames(run).some((frame) => frame.includes(KILO_TIMED_OUT)), 30000, 'kilo timeout reason');
  run.child.stdin.write('q');
  await assertClosed(run);
}

async function hangingKiloOnce() {
  const run = launch(NPM, ['start', '--silent', '--', '--once'], await appEnv(await fixtureDir(KIMI_EXITS, SLOW_KILO)));
  run.child.stdin.end();
  await assertClosed(run);
  const elapsed = Date.now() - run.started;
  assert.ok(elapsed >= 20000 && elapsed <= 30000, `once run with a hanging kilo took ${elapsed}ms`);
  for (const panel of OTHER_PANELS) assert.match(run.output, panel);
  assert.ok(run.output.includes(`${KILO_TIMED_OUT}\n`), `kilo panel has no timeout reason:\n${run.output}`);
}

export default async function () {
  await inSession(hangingKiloLive);
  await inSession(hangingKiloOnce);
}
