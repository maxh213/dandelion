import { fieldOf, isCount, isFilled, matchesOnJsonLine, newestLineMatch, isStale, validInstant, withReset, type FileReader, type Fix, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

export type GrokIo = { reader: FileReader };

type Snapshot = { window: UsageWindow; tier: string; ts: string; ended: boolean };

const BILLING_MSG = 'billing: fetched credits config';
const PERIOD_ENDED = ' · period ended since snapshot';
const FIX: Fix = { command: 'grok', args: [] };
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
  return isFilled(tier) ? tier : 'grok';
}

function periodEnded(end: string | undefined, now: string): boolean {
  return end !== undefined && Date.parse(end) <= Date.parse(now);
}

function creditsWindow(usedPct: number, resetsAt: string | undefined, ended: boolean): UsageWindow {
  return ended ? { label: 'credits', kind: 'weekly', usedPct: 0 } : withReset({ label: 'credits', kind: 'weekly', usedPct }, resetsAt);
}

function usableSnapshots(event: unknown, now: string): Snapshot[] {
  const ctx = fieldOf(event, 'ctx');
  const config = fieldOf(ctx, 'config');
  const usedPct = usedPercent(config);
  const ts = validInstant(fieldOf(event, 'ts'));
  if (usedPct === undefined || ts === undefined) return [];
  const resetsAt = validInstant(fieldOf(fieldOf(config, 'currentPeriod'), 'end'));
  const ended = periodEnded(resetsAt, now);
  return [{ window: creditsWindow(usedPct, resetsAt, ended), tier: tierOf(ctx), ts, ended }];
}

function snapshotsOn(line: string, now: string): Snapshot[] {
  return matchesOnJsonLine(line, (event) => (fieldOf(event, 'msg') === BILLING_MSG ? usableSnapshots(event, now) : []));
}

function staleFix(snapshotAt: string, now: string): { fix?: Fix } {
  return isStale(snapshotAt, now) ? { fix: FIX } : {};
}

export async function probeGrok(io: GrokIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage> {
  const log = await io.reader.read(`${grokHome(io.reader, env)}/logs/unified.jsonl`);
  const snapshot = log === undefined ? undefined : newestLineMatch(log, BILLING_MSG, (line) => snapshotsOn(line, now));
  const usage = { id: 'grok', displayName: 'grok', fetchedAt: now };
  if (snapshot === undefined) return { ...usage, planLabel: 'grok', windows: [], status: 'unavailable', reason: UNAVAILABLE, fix: FIX };
  const ok = { ...usage, planLabel: snapshot.tier, windows: [snapshot.window], status: 'ok' as const, snapshotAt: snapshot.ts, ...staleFix(snapshot.ts, now) };
  return snapshot.ended ? { ...ok, captionSuffix: PERIOD_ENDED } : ok;
}
