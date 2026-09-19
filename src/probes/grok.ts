import { fieldOf, isCount, newestLineMatch, validInstant, withReset, type FileReader, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

export type GrokIo = { reader: FileReader };

type Snapshot = { window: UsageWindow; tier: string; ts: string };

const BILLING_MSG = 'billing: fetched credits config';
const UNAVAILABLE = 'no grok billing snapshot — run grok once';

function grokHome(reader: FileReader, env: Record<string, string | undefined>): string {
  return env['DANDELION_GROK_HOME'] || `${reader.homeDir()}/.grok`;
}

function usedPercent(config: unknown): number | undefined {
  const percent = fieldOf(config, 'creditUsagePercent');
  return isCount(percent) ? Math.round(percent) : undefined;
}

function tierOf(ctx: unknown): string {
  const tier = fieldOf(ctx, 'subscriptionTier');
  return typeof tier === 'string' && tier !== '' ? tier : 'grok';
}

function creditsWindow(usedPct: number, config: unknown): UsageWindow {
  const resetsAt = validInstant(fieldOf(fieldOf(config, 'currentPeriod'), 'end'));
  return withReset({ label: 'credits', kind: 'weekly', usedPct }, resetsAt);
}

function usableSnapshots(event: unknown): Snapshot[] {
  const ctx = fieldOf(event, 'ctx');
  const config = fieldOf(ctx, 'config');
  const usedPct = usedPercent(config);
  const ts = validInstant(fieldOf(event, 'ts'));
  if (usedPct === undefined || ts === undefined) return [];
  return [{ window: creditsWindow(usedPct, config), tier: tierOf(ctx), ts }];
}

function snapshotsOn(line: string): Snapshot[] {
  try {
    const event: unknown = JSON.parse(line);
    return fieldOf(event, 'msg') === BILLING_MSG ? usableSnapshots(event) : [];
  } catch {
    return [];
  }
}

export async function probeGrok(io: GrokIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage> {
  const log = await io.reader.read(`${grokHome(io.reader, env)}/logs/unified.jsonl`);
  const snapshot = log === undefined ? undefined : newestLineMatch(log, BILLING_MSG, snapshotsOn);
  const usage = { id: 'grok', displayName: 'grok', fetchedAt: now };
  if (snapshot === undefined) return { ...usage, planLabel: 'grok', windows: [], status: 'unavailable', reason: UNAVAILABLE };
  return { ...usage, planLabel: snapshot.tier, windows: [snapshot.window], status: 'ok', snapshotAt: snapshot.ts };
}
