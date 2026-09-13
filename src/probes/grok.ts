import { validInstant, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

export interface FileReader {
  homeDir(): string;
  read(path: string): Promise<string | undefined>;
}

export type GrokIo = { reader: FileReader };

type Snapshot = { window: UsageWindow; tier: string; ts: string };

const BILLING_MSG = 'billing: fetched credits config';
const UNAVAILABLE = 'no grok billing snapshot — run grok once';

function grokHome(reader: FileReader, env: Record<string, string | undefined>): string {
  return env['ALLOWANCE_GROK_HOME'] || `${reader.homeDir()}/.grok`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isCount(value: unknown): value is number {
  return Number.isFinite(value) && Number(value) >= 0;
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
  return resetsAt === undefined ? { label: 'credits', usedPct } : { label: 'credits', usedPct, resetsAt };
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

function lineAround(log: string, at: number): string {
  const end = log.indexOf('\n', at);
  return log.slice(log.lastIndexOf('\n', at) + 1, end === -1 ? undefined : end);
}

function newestSnapshot(log: string): Snapshot | undefined {
  for (let at = log.length, hit = log.lastIndexOf(BILLING_MSG); hit !== at; at = hit, hit = log.lastIndexOf(BILLING_MSG, at - 1)) {
    const [snapshot] = snapshotsOn(lineAround(log, hit));
    if (snapshot !== undefined) return snapshot;
  }
  return undefined;
}

export async function probeGrok(io: GrokIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage> {
  const log = await io.reader.read(`${grokHome(io.reader, env)}/logs/unified.jsonl`);
  const snapshot = log === undefined ? undefined : newestSnapshot(log);
  const usage = { id: 'grok', displayName: 'grok', fetchedAt: now };
  if (snapshot === undefined) return { ...usage, planLabel: 'grok', windows: [], status: 'unavailable', reason: UNAVAILABLE };
  return { ...usage, planLabel: snapshot.tier, windows: [snapshot.window], status: 'ok', snapshotAt: snapshot.ts };
}
