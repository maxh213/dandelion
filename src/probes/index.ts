import type { ProviderUsage } from '../domain/index.ts';
import { agyProbe } from './agy.ts';
import { claudeProbe } from './claude.ts';
import { probeCli } from './cli.ts';
import { probeCodex, type CodexIo } from './codex.ts';
import { probeGrok, type GrokIo } from './grok.ts';
import { kiloProbe } from './kilo.ts';
import { probeKimi, type KimiIo } from './kimi.ts';

export type { CommandRunner, CommandRunnerResult, RunFailure } from './cli.ts';
export type { RpcChild, RpcSpawner } from './codex.ts';
export type { FileReader } from './grok.ts';
export type { Fetcher, LaunchedProcess, Launcher } from './kimi.ts';

export type ProbeIo = KimiIo & GrokIo & CodexIo;

export function probeProviders(
  io: ProbeIo,
  env: Record<string, string | undefined>,
  now: string
): Promise<ProviderUsage[]> {
  return Promise.all([
    probeCli(io.runner, claudeProbe, now),
    probeCli(io.runner, agyProbe, now),
    probeKimi(io, env, now),
    probeGrok(io, env, now),
    probeCodex(io, now),
    probeCli(io.runner, kiloProbe(env), now)
  ]);
}
