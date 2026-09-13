import type { ProviderUsage, UsageWindow } from '../domain/index.ts';

export interface FileReader {
  homeDir(): string;
  read(path: string): Promise<string | undefined>;
}

export type GrokIo = { reader: FileReader };

type Snapshot = { window: UsageWindow; tier: string; ts: string };

const BILLING_MSG = 'billing: fetched credits config';
const DATE_BEFORE_TIME = /\d-\d{2}-\d{2}T/;
const UNAVAILABLE = 'no grok billing snapshot — run grok once';

function grokHome(reader: FileReader, env: Record<string, string | undefined>): string {
  const configured = env['ALLOWANCE_GROK_HOME'];
  return configured ? configured : `${reader.homeDir()}/.grok`;
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}

function validInstant(value: unknown): string | undefined {
  const parses = typeof value === 'string' && DATE_BEFORE_TIME.test(value) && !Number.isNaN(Date.parse(value));
  return parses ? (value as string) : undefined;
}

function usedPercent(config: unknown): number | undefined {
  const percent = field(config, 'creditUsagePercent');
  return Number.isFinite(percent) && Number(percent) >= 0 ? Math.round(Number(percent)) : undefined;
}

function tierOf(ctx: unknown): string {
  const tier = field(ctx, 'subscriptionTier');
  return typeof tier === 'string' && tier !== '' ? tier : 'grok';
}

function creditsWindow(usedPct: number, config: unknown): UsageWindow {
  const resetsAt = validInstant(field(field(config, 'currentPeriod'), 'end'));
  return resetsAt === undefined ? { label: 'credits', usedPct } : { label: 'credits', usedPct, resetsAt };
}

function usableSnapshot(event: unknown): Snapshot | undefined {
  const ctx = field(event, 'ctx');
  const config = field(ctx, 'config');
  const usedPct = usedPercent(config);
  const ts = validInstant(field(event, 'ts'));
  if (usedPct === undefined || ts === undefined) return undefined;
  return { window: creditsWindow(usedPct, config), tier: tierOf(ctx), ts };
}

function snapshotOf(line: string): Snapshot | undefined {
  const event = parseLine(line);
  return field(event, 'msg') === BILLING_MSG ? usableSnapshot(event) : undefined;
}

function newestSnapshot(log: string): Snapshot | undefined {
  const lines = log.split('\n').reverse();
  for (const line of lines) {
    const snapshot = snapshotOf(line);
    if (snapshot !== undefined) return snapshot;
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
