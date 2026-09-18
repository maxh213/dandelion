import { fieldOf, isCount, type FileReader, type ProviderUsage, type UsageWindow } from '../domain/index.ts';

export type JunieIo = { reader: FileReader };

type Session = { id: string; updatedAt: number };

type Snapshot = { balance: number; snapshotAt: string };

const SNAPSHOT_TYPE = 'TaskQuotaSnapshot.JetBrains';
const DEFAULT_REFERENCE = 1000000;
const FULL_PCT = 100;
const UNAVAILABLE = 'no junie quota snapshot — run junie once';
const NO_REFERENCE = 'balance without a reference';

function junieHome(reader: FileReader, env: Record<string, string | undefined>): string {
  return env['DANDELION_JUNIE_HOME'] || `${reader.homeDir()}/.junie`;
}

function parsed(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function sessionOn(line: string): Session[] {
  const entry = parsed(line);
  const id = fieldOf(entry, 'sessionId');
  const updatedAt = fieldOf(entry, 'updatedAt');
  return typeof id === 'string' && Number.isFinite(updatedAt) ? [{ id, updatedAt: Number(updatedAt) }] : [];
}

function sessionsNewestFirst(index: string): Session[] {
  return index.split('\n').flatMap(sessionOn).sort((a, b) => b.updatedAt - a.updatedAt);
}

function isJetBrains(quota: unknown): boolean {
  const type = fieldOf(quota, 'type');
  return typeof type === 'string' && type.endsWith(SNAPSHOT_TYPE);
}

function instantOf(ms: unknown): string | undefined {
  const date = new Date(Number(ms));
  return typeof ms === 'number' && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

function snapshotOn(line: string): Snapshot | undefined {
  const completion = fieldOf(parsed(line), 'completion');
  const quota = fieldOf(completion, 'quota');
  const balance = fieldOf(quota, 'balanceLeft');
  const snapshotAt = instantOf(fieldOf(completion, 'endedAtMs'));
  return isJetBrains(quota) && isCount(balance) && snapshotAt !== undefined ? { balance, snapshotAt } : undefined;
}

function newestSnapshot(log: string): Snapshot | undefined {
  const candidates = log.split('\n').filter((line) => line.includes(SNAPSHOT_TYPE));
  return candidates.reverse().map(snapshotOn).find((snapshot) => snapshot !== undefined);
}

async function newestSessionSnapshot(reader: FileReader, home: string, sessions: Session[]): Promise<Snapshot | undefined> {
  for (const { id } of sessions) {
    const snapshot = newestSnapshot((await reader.read(`${home}/sessions/${id}/events.jsonl`)) ?? '');
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
  const home = junieHome(io.reader, env);
  const index = (await io.reader.read(`${home}/sessions/index.jsonl`)) ?? '';
  const snapshot = await newestSessionSnapshot(io.reader, home, sessionsNewestFirst(index));
  const usage = { id: 'junie', displayName: 'junie', fetchedAt: now };
  if (snapshot === undefined) return { ...usage, planLabel: 'junie', windows: [], status: 'unavailable', reason: UNAVAILABLE };
  const windows = creditsWindows(snapshot.balance, referenceOf(env['DANDELION_JUNIE_REFERENCE']));
  const planLabel = `${Math.round(snapshot.balance)} credits`;
  return { ...usage, planLabel, windows, status: 'ok', snapshotAt: snapshot.snapshotAt, ...withNote(windows) };
}
