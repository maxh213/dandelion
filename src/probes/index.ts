import type { ProviderUsage } from '../domain/index.ts';
import { agyProbe } from './agy.ts';
import { claudeProbe } from './claude.ts';
import { probeKilo } from './kilo.ts';
import type { CommandRunner } from './runner.ts';
import { probeWindows } from './windows.ts';

export type { CommandRunner, CommandRunnerResult, RunFailure } from './runner.ts';

export function probeProviders(
  runner: CommandRunner,
  now: string,
  env: Record<string, string | undefined>
): Promise<ProviderUsage[]> {
  return Promise.all([
    probeWindows(runner, claudeProbe, now),
    probeWindows(runner, agyProbe, now),
    probeKilo(runner, now, env)
  ]);
}
