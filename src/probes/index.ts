import type { Fetcher, FileReader, ProviderUsage } from '../domain/index.ts';
import { agyProbe } from './agy.ts';
import { claudeProbe } from './claude.ts';
import { probeCli } from './cli.ts';
import { probeCodex, type CodexIo } from './codex.ts';
import { probeCursor, type CursorIo } from './cursor.ts';
import { probeGrok, type GrokIo } from './grok.ts';
import { kiloProbe } from './kilo.ts';
import { probeKimi, type KimiIo } from './kimi.ts';

export type { CommandRunner, CommandRunnerResult, RunFailure } from './cli.ts';
export type { RpcChild, RpcSpawner } from './codex.ts';
export type { LaunchedProcess, Launcher } from './kimi.ts';
export type { Fetcher, FileReader };

export type ProbeIo = KimiIo & GrokIo & CodexIo & CursorIo & { fetcher: Fetcher; reader: FileReader };

export type ProviderProbe = { id: string; probe(now: string): Promise<ProviderUsage> };

export function providerProbes(io: ProbeIo, env: Record<string, string | undefined>): ProviderProbe[] {
  const kilo = kiloProbe(env);
  return [
    { id: claudeProbe.id, probe: (now) => probeCli(io.runner, claudeProbe, now) },
    { id: agyProbe.id, probe: (now) => probeCli(io.runner, agyProbe, now) },
    { id: 'kimi', probe: (now) => probeKimi(io, env, now) },
    { id: 'grok', probe: (now) => probeGrok(io, env, now) },
    { id: 'codex', probe: (now) => probeCodex(io, now) },
    { id: 'cursor', probe: (now) => probeCursor(io, env, now) },
    { id: kilo.id, probe: (now) => probeCli(io.runner, kilo, now) }
  ];
}

export function probeProviders(io: ProbeIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage[]> {
  return Promise.all(providerProbes(io, env).map(({ probe }) => probe(now)));
}
