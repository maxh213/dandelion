import type { Fetcher, FileReader, ProviderUsage } from '../domain/index.ts';
import { agyProbe } from './agy.ts';
import { claudeProbe, claudeWorkProbe } from './claude.ts';
import { probeCli, type CliProbe } from './cli.ts';
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

function cliProbe(io: ProbeIo, probe: CliProbe): ProviderProbe {
  return { id: probe.id, probe: (now) => probeCli(io, probe, now) };
}

export function providerProbes(io: ProbeIo, env: Record<string, string | undefined>): ProviderProbe[] {
  return [
    cliProbe(io, claudeProbe),
    cliProbe(io, claudeWorkProbe(env, io.reader.homeDir())),
    cliProbe(io, agyProbe),
    { id: 'kimi', probe: (now) => probeKimi(io, env, now) },
    { id: 'grok', probe: (now) => probeGrok(io, env, now) },
    { id: 'codex', probe: (now) => probeCodex(io, now) },
    { id: 'cursor', probe: (now) => probeCursor(io, env, now) },
    cliProbe(io, kiloProbe(env))
  ];
}
