import type { ProviderUsage } from '../domain/index.ts';
import { probeKilo } from './kilo.ts';
import type { CommandRunner } from './runner.ts';

export type { CommandRunner, CommandRunnerResult, RunFailure } from './runner.ts';

export async function probeProviders(
  runner: CommandRunner,
  now: string,
  env: Record<string, string | undefined>
): Promise<ProviderUsage[]> {
  return [await probeKilo(runner, now, env)];
}
