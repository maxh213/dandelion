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

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
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

function usableSnapshot(event: unknown): Snapshot | undefined {
  const ctx = fieldOf(event, 'ctx');
  const config = fieldOf(ctx, 'config');
  const usedPct = usedPercent(config);
  const ts = validInstant(fieldOf(event, 'ts'));
  if (usedPct === undefined || ts === undefined) return undefined;
  return { window: creditsWindow(usedPct, config), tier: tierOf(ctx), ts };
}

function snapshotOf(line: string): Snapshot | undefined {
  if (!line.includes(BILLING_MSG)) return undefined;
  const event = parseLine(line);
  return fieldOf(event, 'msg') === BILLING_MSG ? usableSnapshot(event) : undefined;
}

function newestSnapshot(log: string): Snapshot | undefined {
  let end = log.length;
  while (end > 0) {
    const start = log.lastIndexOf('\n', end - 1);
    const snapshot = snapshotOf(log.slice(start + 1, end));
    if (snapshot !== undefined) return snapshot;
    end = start;
  }
  return undefined;
}

export async function probeGrok(io: GrokIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage> {
  const log = await io.reader.read(`${grokHome(io.reader, env)}/logs/unified.jsonl`);
  const snapshot = newestSnapshot(log ?? '');
  const usage = { id: 'grok', displayName: 'grok', fetchedAt: now };
  if (snapshot === undefined) return { ...usage, planLabel: 'grok', windows: [], status: 'unavailable', reason: UNAVAILABLE };
  return { ...usage, planLabel: snapshot.tier, windows: [snapshot.window], status: 'ok', snapshotAt: snapshot.ts };
}
