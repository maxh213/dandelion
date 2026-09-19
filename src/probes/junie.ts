import { fieldOf, isCount, newestLineMatch, type FileReader, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

export type JunieIo = { reader: FileReader };

type Session = { id: string; updatedAt: number };

type Snapshot = { balance: number; endedAtMs: number };

const SNAPSHOT_TYPE = 'TaskQuotaSnapshot.JetBrains';
const DEFAULT_REFERENCE = 1000000;
const FULL_PCT = 100;
const UNAVAILABLE = 'no junie quota snapshot — run junie once';
const NO_REFERENCE = 'balance without a reference';

function junieHome(reader: FileReader, env: Record<string, string | undefined>): string {
  return env['DANDELION_JUNIE_HOME'] || `${reader.homeDir()}/.junie`;
}

function usableSessions(entry: unknown): Session[] {
  const id = fieldOf(entry, 'sessionId');
  const updatedAt = fieldOf(entry, 'updatedAt');
  return typeof id === 'string' && Number.isFinite(updatedAt) ? [{ id, updatedAt: Number(updatedAt) }] : [];
}

function sessionsOn(line: string): Session[] {
  try {
    return usableSessions(JSON.parse(line));
  } catch {
    return [];
  }
}

async function sessionsNewestFirst(reader: FileReader, home: string): Promise<Session[]> {
  const index = await reader.read(`${home}/sessions/index.jsonl`);
  return index === undefined ? [] : index.split('\n').flatMap(sessionsOn).sort((a, b) => b.updatedAt - a.updatedAt);
}

function isInstant(ms: unknown): ms is number {
  return typeof ms === 'number' && !Number.isNaN(new Date(ms).getTime());
}

function usableSnapshots(completion: unknown): Snapshot[] {
  const quota = fieldOf(completion, 'quota');
  const balance = fieldOf(quota, 'balanceLeft');
  const endedAtMs = fieldOf(completion, 'endedAtMs');
  const jetBrains = String(fieldOf(quota, 'type')).endsWith(SNAPSHOT_TYPE);
  return jetBrains && isCount(balance) && isInstant(endedAtMs) ? [{ balance, endedAtMs }] : [];
}

function snapshotsOn(line: string): Snapshot[] {
  try {
    return usableSnapshots(fieldOf(JSON.parse(line), 'completion'));
  } catch {
    return [];
  }
}

async function newestSessionSnapshot(reader: FileReader, home: string): Promise<Snapshot | undefined> {
  for (const { id } of await sessionsNewestFirst(reader, home)) {
    const log = await reader.read(`${home}/sessions/${id}/events.jsonl`);
    const snapshot = log === undefined ? undefined : newestLineMatch(log, SNAPSHOT_TYPE, snapshotsOn);
    if (snapshot !== undefined) return snapshot;
  }
  return undefined;
}

function referenceOf(raw: string | undefined): number | undefined {
  if (raw === '') return undefined;
  const reference = Number(raw);
  return isCount(reference) && reference > 0 ? reference : DEFAULT_REFERENCE;
}

function usedPercent(balance: number, reference: number): number {
  return Math.min(FULL_PCT, Math.max(0, Math.round(FULL_PCT - (FULL_PCT * balance) / reference)));
}

function creditsWindows(balance: number, reference: number | undefined): UsageWindow[] {
  return reference === undefined ? [] : [{ label: 'credits', kind: 'weekly', usedPct: usedPercent(balance, reference) }];
}

function withNote(windows: UsageWindow[]): { note?: string } {
  return windows.length === 0 ? { note: NO_REFERENCE } : {};
}

export async function probeJunie(io: JunieIo, env: Record<string, string | undefined>, now: string): Promise<ProviderUsage> {
  const snapshot = await newestSessionSnapshot(io.reader, junieHome(io.reader, env));
  const usage = { id: 'junie', displayName: 'junie', fetchedAt: now };
  if (snapshot === undefined) return { ...usage, planLabel: 'junie', windows: [], status: 'unavailable', reason: UNAVAILABLE };
  const windows = creditsWindows(snapshot.balance, referenceOf(env['DANDELION_JUNIE_REFERENCE']));
  const planLabel = `${Math.round(snapshot.balance)} credits`;
  const snapshotAt = new Date(snapshot.endedAtMs).toISOString();
  return { ...usage, planLabel, windows, status: 'ok', snapshotAt, ...withNote(windows) };
}
