import type { ProviderUsage, UsageWindow } from '../domain/index.ts';
import { runFailureReason, type CommandRunner } from './runner.ts';

export type WindowProbe = {
  id: string;
  planLabel: string;
  args: string[];
  timeoutMs: number;
  parse(stdout: string, now: string): UsageWindow[];
};

export function windowOf(label: string, usedPct: number, resetsAt: string | undefined): UsageWindow {
  if (resetsAt === undefined) return { label, usedPct };
  return { label, usedPct, resetsAt };
}

export function presentOnly<T>(items: (T | undefined)[]): T[] {
  return items.filter((item): item is T => item !== undefined);
}

export async function probeWindows(runner: CommandRunner, probe: WindowProbe, now: string): Promise<ProviderUsage> {
  const result = await runner.run(probe.id, probe.args, probe.timeoutMs);
  const usage = { id: probe.id, displayName: probe.id, planLabel: probe.planLabel, fetchedAt: now };

  if (result.failure) {
    return { ...usage, windows: [], status: 'unavailable', reason: runFailureReason(probe.id, probe.timeoutMs, result.failure) };
  }

  const windows = probe.parse(result.stdout, now);
  if (windows.length === 0) return { ...usage, windows, status: 'unavailable', reason: 'Could not parse usage from output' };

  return { ...usage, windows, status: 'ok' };
}
