export interface StateFile {
  read(path: string): string;
  replace(path: string, text: string): boolean;
}

export interface Eligibility {
  ineligible(): string[];
  toggle(id: string): boolean;
}

export interface Hidden {
  ids(): string[];
  toggle(id: string): boolean;
}

type State = Record<string, unknown>;

const STATE_FILE = 'dandelion/eligibility.json';

function statePath(env: Record<string, string | undefined>, homeDir: string): string {
  const stateHome = env['XDG_STATE_HOME'] || `${homeDir}/.local/state`;
  return env['DANDELION_STATE_FILE'] || `${stateHome}/${STATE_FILE}`;
}

function isPlainObject(value: unknown): value is State {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function readState(file: StateFile, path: string): State {
  try {
    const value: unknown = JSON.parse(file.read(path));
    return isPlainObject(value) ? value : {};
  } catch {
    return {};
  }
}

function serialized(state: State): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function toggled(state: State, id: string): State {
  return { ...state, [id]: state[id] === false };
}

export function openEligibility(env: Record<string, string | undefined>, homeDir: string, file: StateFile): Eligibility {
  const path = statePath(env, homeDir);
  const held = { state: readState(file, path) };
  return {
    ineligible: () => Object.keys(held.state).filter((id) => held.state[id] === false),
    toggle(id) {
      const next = toggled(readState(file, path), id);
      if (!file.replace(path, serialized(next))) return false;
      held.state = next;
      return true;
    }
  };
}

const HIDDEN_FILE = 'hidden.json';

function siblingPath(env: Record<string, string | undefined>, homeDir: string, name: string): string {
  const state = statePath(env, homeDir);
  const slash = state.lastIndexOf('/');
  const directory = slash === -1 ? '.' : state.slice(0, slash);
  return `${directory}/${name}`;
}

function readIds(file: StateFile, path: string): string[] {
  try {
    const value: unknown = JSON.parse(file.read(path));
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export type HistorySample = { id: string; slot: number; label: string; usedPct: number; resetsAt?: string; at: string };

type RecordedUsage = { id: string; status: string; windows: { label: string; usedPct: number; resetsAt?: string }[] };

export interface History {
  samples(id: string): HistorySample[];
  record(usages: RecordedUsage[], now: string): boolean;
}

const HISTORY_FILE = 'history.json';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FULL_RESOLUTION_MS = 24 * 60 * 60 * 1000;
const THIN_BUCKET_MS = 60 * 60 * 1000;
const MAX_SAMPLES = 40000;

function historyPath(env: Record<string, string | undefined>, homeDir: string): string {
  if (env['DANDELION_HISTORY_FILE']) return env['DANDELION_HISTORY_FILE'];
  const state = statePath(env, homeDir);
  return `${state.slice(0, state.lastIndexOf('/') + 1)}${HISTORY_FILE}`;
}

const SAMPLE_CHECKS: ((sample: Partial<HistorySample>) => boolean)[] = [
  (sample) => typeof sample.id === 'string',
  (sample) => Number.isInteger(sample.slot),
  (sample) => typeof sample.label === 'string',
  (sample) => typeof sample.at === 'string' && !Number.isNaN(Date.parse(sample.at)),
  (sample) => Number.isFinite(sample.usedPct),
  (sample) => sample.resetsAt === undefined || typeof sample.resetsAt === 'string'
];

function isSample(value: unknown): value is HistorySample {
  return isPlainObject(value) && SAMPLE_CHECKS.every((check) => check(value as Partial<HistorySample>));
}

function readSamples(file: StateFile, path: string): HistorySample[] {
  try {
    const value: unknown = JSON.parse(file.read(path));
    return Array.isArray(value) ? value.filter(isSample) : [];
  } catch {
    return [];
  }
}

const SORT_ORDERS = ['dashboard', 'headroom', 'reset'] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];

type ViewState = { sort: SortOrder; absoluteResets: boolean };

export interface View {
  initial(): ViewState;
  save(state: ViewState): boolean;
}

const VIEW_FILE = 'view.json';
const DEFAULT_VIEW: ViewState = { sort: 'dashboard', absoluteResets: false };

function isViewState(value: unknown): value is ViewState {
  return isPlainObject(value) && SORT_ORDERS.includes(value['sort'] as SortOrder) && typeof value['absoluteResets'] === 'boolean';
}

function readView(file: StateFile, path: string): ViewState {
  try {
    const value: unknown = JSON.parse(file.read(path));
    return isViewState(value) ? { sort: value.sort, absoluteResets: value.absoluteResets } : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

export function openView(env: Record<string, string | undefined>, homeDir: string, file: StateFile): View {
  const path = siblingPath(env, homeDir, VIEW_FILE);
  return {
    initial: () => readView(file, path),
    save: (state) => file.replace(path, `${JSON.stringify({ sort: state.sort, absoluteResets: state.absoluteResets })}\n`)
  };
}

function withToggled(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((held) => held !== id) : [...ids, id];
}

export function openHidden(env: Record<string, string | undefined>, homeDir: string, file: StateFile): Hidden {
  const path = siblingPath(env, homeDir, HIDDEN_FILE);
  const held = { ids: readIds(file, path) };
  return {
    ids: () => held.ids,
    toggle(id) {
      const next = withToggled(readIds(file, path), id);
      if (!file.replace(path, `${JSON.stringify(next)}\n`)) return false;
      held.ids = next;
      return true;
    }
  };
}

function sampled(usage: RecordedUsage, now: string): HistorySample[] {
  if (usage.status !== 'ok') return [];
  return usage.windows.map((window, slot) => ({ id: usage.id, slot, label: window.label, usedPct: window.usedPct, resetsAt: window.resetsAt, at: now }));
}

function thinned(samples: HistorySample[], now: string): HistorySample[] {
  const recent = Date.parse(now) - FULL_RESOLUTION_MS;
  const seen = new Set<string>();
  return samples.filter((sample) => {
    const at = Date.parse(sample.at);
    if (at >= recent) return true;
    const key = `${sample.id}|${sample.slot}|${Math.floor(at / THIN_BUCKET_MS)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pruned(samples: HistorySample[], now: string): HistorySample[] {
  const oldest = Date.parse(now) - MAX_AGE_MS;
  return thinned(samples.filter((sample) => Date.parse(sample.at) >= oldest), now).slice(-MAX_SAMPLES);
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

export interface Snapshot<T> {
  record(usages: T[]): boolean;
  fresh(ids: string[], now: string, maxAgeSeconds: number): T[] | undefined;
}

const SNAPSHOT_FILE = 'snapshot.json';

function snapshotPath(env: Record<string, string | undefined>, homeDir: string): string {
  const state = statePath(env, homeDir);
  return `${state.slice(0, state.lastIndexOf('/') + 1)}${SNAPSHOT_FILE}`;
}

function readEntries<T>(file: StateFile, path: string, isEntry: (value: unknown) => value is T): T[] | undefined {
  try {
    const value: unknown = JSON.parse(file.read(path));
    return Array.isArray(value) && value.every(isEntry) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecent<T extends { fetchedAt: string }>(entry: T, now: string, maxAgeSeconds: number): boolean {
  return Date.parse(now) - Date.parse(entry.fetchedAt) <= maxAgeSeconds * 1000;
}

function coveredFresh<T extends { id: string; fetchedAt: string }>(entries: T[], ids: string[], now: string, maxAgeSeconds: number): T[] | undefined {
  const chosen = ids.map((id) => entries.find((entry) => entry.id === id));
  const complete = chosen.filter((entry): entry is T => entry !== undefined);
  return complete.length === ids.length && complete.every((entry) => isRecent(entry, now, maxAgeSeconds)) ? complete : undefined;
}

export function openSnapshot<T extends { id: string; fetchedAt: string }>(env: Record<string, string | undefined>, homeDir: string, file: StateFile, isEntry: (value: unknown) => value is T): Snapshot<T> {
  const path = snapshotPath(env, homeDir);
  return {
    record: (usages) => file.replace(path, `${JSON.stringify(usages)}\n`),
    fresh(ids, now, maxAgeSeconds) {
      const entries = readEntries(file, path, isEntry);
      return entries === undefined ? undefined : coveredFresh(entries, ids, now, maxAgeSeconds);
    }
  };
}
