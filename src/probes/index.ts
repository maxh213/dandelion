import type { ProviderUsage } from '../domain/index.ts';
import { agyProbe } from './agy.ts';
import { claudeProbe } from './claude.ts';
import { probeCli, type CommandRunner } from './cli.ts';
import { kiloProbe } from './kilo.ts';

export type { CommandRunner, CommandRunnerResult, RunFailure } from './cli.ts';

export function probeProviders(
  runner: CommandRunner,
  now: string,
  env: Record<string, string | undefined>
): Promise<ProviderUsage[]> {
  return Promise.all([claudeProbe, agyProbe, kiloProbe(env)].map((probe) => probeCli(runner, probe, now)));
}
