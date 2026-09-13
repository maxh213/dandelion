import type { ProviderUsage } from '../domain/index.ts';
import { agyProbe } from './agy.ts';
import { claudeProbe } from './claude.ts';
import { probeCli, type CommandRunner } from './cli.ts';
import { kiloProbe } from './kilo.ts';
import { probeKimi, type KimiIo } from './kimi.ts';

export type { CommandRunner, CommandRunnerResult, RunFailure } from './cli.ts';
export type { Fetcher, KimiProcess, Launcher } from './kimi.ts';

export type ProbeIo = KimiIo & { runner: CommandRunner };

export function probeProviders(
  io: ProbeIo,
  now: string,
  env: Record<string, string | undefined>
): Promise<ProviderUsage[]> {
  return Promise.all([
    probeCli(io.runner, claudeProbe, now),
    probeCli(io.runner, agyProbe, now),
    probeKimi(io, env, now),
    probeCli(io.runner, kiloProbe(env), now)
  ]);
}
