import { statePath, type StateFile } from './eligibility.ts';

export type HistorySample = { id: string; label: string; usedPct: number; resetsAt?: string; at: string };

type RecordedUsage = { id: string; status: string; windows: { label: string; usedPct: number; resetsAt?: string }[] };

export interface History {
  samples(id: string): HistorySample[];
  record(usages: RecordedUsage[], now: string): boolean;
}

const HISTORY_FILE = 'history.json';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SAMPLES = 20000;

function historyPath(env: Record<string, string | undefined>, homeDir: string): string {
  if (env['DANDELION_HISTORY_FILE']) return env['DANDELION_HISTORY_FILE'];
  const state = statePath(env, homeDir);
  return `${state.slice(0, state.lastIndexOf('/') + 1)}${HISTORY_FILE}`;
}

function isSample(value: unknown): value is HistorySample {
  const sample = value as Partial<HistorySample> | null;
  return (
    typeof sample?.id === 'string' &&
    typeof sample.label === 'string' &&
    typeof sample.at === 'string' &&
    !Number.isNaN(Date.parse(sample.at)) &&
    Number.isFinite(sample.usedPct) &&
    (sample.resetsAt === undefined || typeof sample.resetsAt === 'string')
  );
}

function readSamples(file: StateFile, path: string): HistorySample[] {
  try {
    const value: unknown = JSON.parse(file.read(path));
    return Array.isArray(value) ? value.filter(isSample) : [];
  } catch {
    return [];
  }
}

function sampled(usage: RecordedUsage, now: string): HistorySample[] {
  if (usage.status !== 'ok') return [];
  return usage.windows.map((window) => ({ id: usage.id, label: window.label, usedPct: window.usedPct, resetsAt: window.resetsAt, at: now }));
}

function pruned(samples: HistorySample[], now: string): HistorySample[] {
  const oldest = Date.parse(now) - MAX_AGE_MS;
  return samples.filter((sample) => Date.parse(sample.at) >= oldest).slice(-MAX_SAMPLES);
}

export function openHistory(env: Record<string, string | undefined>, homeDir: string, file: StateFile): History {
  const path = historyPath(env, homeDir);
  const held = { samples: readSamples(file, path) };
  return {
    samples: (id) => held.samples.filter((sample) => sample.id === id),
    record(usages, now) {
      const next = pruned([...held.samples, ...usages.flatMap((usage) => sampled(usage, now))], now);
      if (!file.replace(path, JSON.stringify(next))) return false;
      held.samples = next;
      return true;
    }
  };
}
