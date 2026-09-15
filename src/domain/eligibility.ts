export type StateFile = {
  read(path: string): string;
  replace(path: string, text: string): boolean;
};

export type Eligibility = {
  ineligible(): string[];
  toggle(id: string): boolean;
};

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
      const next = toggled(held.state, id);
      if (!file.replace(path, serialized(next))) return false;
      held.state = next;
      return true;
    }
  };
}
