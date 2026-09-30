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

export function statePath(env: Record<string, string | undefined>, homeDir: string): string {
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
      const next = toggled(held.state, id);
      if (!file.replace(path, serialized(next))) return false;
      held.state = next;
      return true;
    }
  };
}

const HIDDEN_FILE = 'hidden.json';

function hiddenPath(env: Record<string, string | undefined>, homeDir: string): string {
  const state = statePath(env, homeDir);
  const slash = state.lastIndexOf('/');
  const directory = slash === -1 ? '.' : state.slice(0, slash);
  return `${directory}/${HIDDEN_FILE}`;
}

function readIds(file: StateFile, path: string): string[] {
  try {
    const value: unknown = JSON.parse(file.read(path));
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function withToggled(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((held) => held !== id) : [...ids, id];
}

export function openHidden(env: Record<string, string | undefined>, homeDir: string, file: StateFile): Hidden {
  const path = hiddenPath(env, homeDir);
  const held = { ids: readIds(file, path) };
  return {
    ids: () => held.ids,
    toggle(id) {
      const next = withToggled(held.ids, id);
      if (!file.replace(path, `${JSON.stringify(next)}\n`)) return false;
      held.ids = next;
      return true;
    }
  };
}
