export type EligibilityState = Record<string, unknown>;

const STATE_FILE = 'dandelion/eligibility.json';

export function eligibilityPath(env: Record<string, string | undefined>, homeDir: string): string {
  const stateHome = env['XDG_STATE_HOME'] || `${homeDir}/.local/state`;
  return env['DANDELION_STATE_FILE'] || `${stateHome}/${STATE_FILE}`;
}

function parsedJson(text: string | undefined): unknown {
  try {
    return JSON.parse(String(text));
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is EligibilityState {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function parseEligibility(text: string | undefined): EligibilityState {
  const value = parsedJson(text);
  return isPlainObject(value) ? value : {};
}

export function serializeEligibility(state: EligibilityState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function ineligibleIds(state: EligibilityState): string[] {
  return Object.keys(state).filter((id) => state[id] === false);
}

export function withToggledEligibility(state: EligibilityState, id: string): EligibilityState {
  return { ...state, [id]: state[id] === false };
}
