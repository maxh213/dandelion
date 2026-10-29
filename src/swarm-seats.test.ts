import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { openRoutes, swarmOf, type RouteLines } from './domain/index.ts';

const FIXTURE: RouteLines = JSON.parse(readFileSync(fileURLToPath(new URL('./routes.fixture.json', import.meta.url)), 'utf8'));
const PATH = '/r/routes.json';

const SECTIONS = {
  swarm: {
    trip: 80,
    minLeft: 5,
    exclude: ['claude-work', 'claude-animus', 'codex-animus'],
    cap: { claude: 4, codex: 3, cursor: 3, agy: 3, kilo: 1, default: 2 },
    burnPerSeatHour: { default: 10 }
  },
  lab: { 'model-': 'lab-a', 'vendor/': 'lab-b', auto: 'cursor' },
  headless: { claude: { before: [], after: ['-p', '--output-format', 'json'], stdin: true }, codex: { before: ['exec'], after: ['-'], stdin: true } }
};

function opened(value: unknown) {
  return openRoutes({ DANDELION_ROUTES_FILE: PATH }, '/shipped/routes.json', { read: () => JSON.stringify(value) });
}

function withSections(edit: (value: Record<string, Record<string, unknown>>) => void): unknown {
  const value = structuredClone({ ...FIXTURE, ...SECTIONS }) as unknown as Record<string, Record<string, unknown>>;
  edit(value);
  return value;
}

function swarmPart(value: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return value.swarm;
}

describe('routes.json swarm, lab and headless sections', () => {
  it('reads a file with all three sections and keeps it as written', () => {
    const value = { ...FIXTURE, ...SECTIONS };
    expect(opened(value)).toEqual({ lines: value });
  });

  it('reads a file without them, as before', () => {
    expect(opened(FIXTURE)).toEqual({ lines: FIXTURE });
  });

  it.each<[string, unknown]>([
    ['empty sections', withSections((value) => Object.assign(value, { swarm: {}, lab: {}, headless: {} }))],
    ['the lowest trip', withSections((value) => Object.assign(swarmPart(value), { trip: 50 }))],
    ['the highest trip', withSections((value) => Object.assign(swarmPart(value), { trip: 90 }))],
    ['a fractional minLeft', withSections((value) => Object.assign(swarmPart(value), { minLeft: 2.5 }))],
    ['minLeft 0 and 100', withSections((value) => Object.assign(swarmPart(value), { minLeft: 0, burnPerSeatHour: { default: 100, kilo: 0 } }))],
    ['caps of 0 and 20', withSections((value) => Object.assign(swarmPart(value), { cap: { claude: 0, default: 20 } }))],
    ['an empty exclude', withSections((value) => Object.assign(swarmPart(value), { exclude: [] }))],
    ['a lab key named like an object method', withSections((value) => Object.assign(value.lab, { toString: 'lab-c' }))],
    ['every headless command', withSections((value) => Object.assign(value, { headless: Object.fromEntries(['claude', 'codex', 'cursor-agent', 'agy', 'kimi', 'grok', 'junie', 'hermes', 'kilo'].map((command) => [command, { before: [], after: ['{prompt}'], stdin: false }])) }))]
  ])('accepts %s', (_case, value) => {
    expect(opened(value).fault).toBeUndefined();
  });

  it.each<[string, unknown, string]>([
    ['swarm not an object', withSections((value) => Object.assign(value, { swarm: 'x' })), 'swarm is not a JSON object'],
    ['swarm null', withSections((value) => Object.assign(value, { swarm: null })), 'swarm is not a JSON object'],
    ['lab not an object', withSections((value) => Object.assign(value, { lab: [] })), 'lab is not a JSON object'],
    ['headless not an object', withSections((value) => Object.assign(value, { headless: 1 })), 'headless is not a JSON object'],
    ['an unknown swarm key', withSections((value) => Object.assign(swarmPart(value), { trips: 80 })), 'unknown key swarm.trips'],
    ['a trip below 50', withSections((value) => Object.assign(swarmPart(value), { trip: 49 })), 'swarm.trip is not a whole percent from 50 to 90'],
    ['a trip above 90', withSections((value) => Object.assign(swarmPart(value), { trip: 91 })), 'swarm.trip is not a whole percent from 50 to 90'],
    ['a fractional trip', withSections((value) => Object.assign(swarmPart(value), { trip: 80.5 })), 'swarm.trip is not a whole percent from 50 to 90'],
    ['a trip as a string', withSections((value) => Object.assign(swarmPart(value), { trip: '80' })), 'swarm.trip is not a whole percent from 50 to 90'],
    ['a null trip', withSections((value) => Object.assign(swarmPart(value), { trip: null })), 'swarm.trip is not a whole percent from 50 to 90'],
    ['a negative minLeft', withSections((value) => Object.assign(swarmPart(value), { minLeft: -1 })), 'swarm.minLeft is not a number from 0 to 100'],
    ['a minLeft above 100', withSections((value) => Object.assign(swarmPart(value), { minLeft: 101 })), 'swarm.minLeft is not a number from 0 to 100'],
    ['a minLeft as a string', withSections((value) => Object.assign(swarmPart(value), { minLeft: '5' })), 'swarm.minLeft is not a number from 0 to 100'],
    ['exclude as a string', withSections((value) => Object.assign(swarmPart(value), { exclude: 'claude-work' })), 'swarm.exclude is not a list of account ids'],
    ['exclude with an unknown id', withSections((value) => Object.assign(swarmPart(value), { exclude: ['claude-wrok'] })), 'swarm.exclude is not a list of account ids'],
    ['exclude with a number', withSections((value) => Object.assign(swarmPart(value), { exclude: [1] })), 'swarm.exclude is not a list of account ids'],
    ['cap not an object', withSections((value) => Object.assign(swarmPart(value), { cap: [2] })), 'swarm.cap is not a JSON object'],
    ['a cap for an unknown account', withSections((value) => Object.assign(swarmPart(value), { cap: { claudee: 2 } })), 'unknown key swarm.cap.claudee'],
    ['a cap above 20', withSections((value) => Object.assign(swarmPart(value), { cap: { claude: 21 } })), 'swarm.cap.claude is not a whole number from 0 to 20'],
    ['a negative cap', withSections((value) => Object.assign(swarmPart(value), { cap: { default: -1 } })), 'swarm.cap.default is not a whole number from 0 to 20'],
    ['a fractional cap', withSections((value) => Object.assign(swarmPart(value), { cap: { kilo: 1.5 } })), 'swarm.cap.kilo is not a whole number from 0 to 20'],
    ['a burn for an unknown account', withSections((value) => Object.assign(swarmPart(value), { burnPerSeatHour: { sonnet: 5 } })), 'unknown key swarm.burnPerSeatHour.sonnet'],
    ['a negative burn', withSections((value) => Object.assign(swarmPart(value), { burnPerSeatHour: { default: -1 } })), 'swarm.burnPerSeatHour.default is not a number from 0 to 100'],
    ['a burn above 100', withSections((value) => Object.assign(swarmPart(value), { burnPerSeatHour: { codex: 101 } })), 'swarm.burnPerSeatHour.codex is not a number from 0 to 100'],
    ['a burn as a string', withSections((value) => Object.assign(swarmPart(value), { burnPerSeatHour: { default: '10' } })), 'swarm.burnPerSeatHour.default is not a number from 0 to 100'],
    ['an empty lab prefix', withSections((value) => Object.assign(value.lab, { '': 'lab-a' })), 'lab has an empty model prefix'],
    ['a lab name with capitals', withSections((value) => Object.assign(value.lab, { 'gpt-': 'OpenAI' })), 'lab.gpt- is not a lab name of a-z, 0-9 and -'],
    ['a lab name that is not a string', withSections((value) => Object.assign(value.lab, { 'gpt-': 5 })), 'lab.gpt- is not a lab name of a-z, 0-9 and -'],
    ['an empty lab name', withSections((value) => Object.assign(value.lab, { 'gpt-': '' })), 'lab.gpt- is not a lab name of a-z, 0-9 and -'],
    ['headless for an account id, not a command', withSections((value) => Object.assign(value.headless, { cursor: { before: [], after: [], stdin: false } })), 'unknown key headless.cursor'],
    ['a template that is not an object', withSections((value) => Object.assign(value.headless, { codex: ['exec'] })), 'headless.codex is not a JSON object'],
    ['a template without before', withSections((value) => Object.assign(value.headless, { kimi: { after: [], stdin: false } })), 'headless.kimi.before is missing'],
    ['a template without stdin', withSections((value) => Object.assign(value.headless, { kimi: { before: [], after: [] } })), 'headless.kimi.stdin is missing'],
    ['an unknown template key', withSections((value) => Object.assign(value.headless, { kimi: { before: [], after: [], stdin: false, env: {} } })), 'unknown key headless.kimi.env'],
    ['after as a string', withSections((value) => Object.assign(value.headless, { kimi: { before: [], after: '-p', stdin: false } })), 'headless.kimi.after is not a list of strings'],
    ['after with a number', withSections((value) => Object.assign(value.headless, { kimi: { before: [], after: ['-p', 1], stdin: false } })), 'headless.kimi.after is not a list of strings'],
    ['stdin as a string', withSections((value) => Object.assign(value.headless, { kimi: { before: [], after: [], stdin: 'yes' } })), 'headless.kimi.stdin is not true or false']
  ])('names what is wrong: %s', (_case, value, problem) => {
    expect(opened(value)).toEqual({ fault: { path: PATH, problem } });
  });
});

describe('swarmOf', () => {
  it('fills every default when the file has no swarm, lab or headless section', () => {
    expect(swarmOf(FIXTURE)).toEqual({ trip: 80, minLeft: 5, exclude: [], cap: { default: 2, kilo: 1 }, burnPerSeatHour: { default: 10 }, lab: {}, headless: {} });
  });

  it('keeps what the file sets and fills the rest', () => {
    const lines: RouteLines = { ...FIXTURE, swarm: { trip: 70, cap: { codex: 3, kilo: 2 } }, lab: { 'model-': 'lab-a' }, headless: { claude: { before: [], after: ['-p'], stdin: true } } };
    expect(swarmOf(lines)).toEqual({
      trip: 70,
      minLeft: 5,
      exclude: [],
      cap: { default: 2, kilo: 2, codex: 3 },
      burnPerSeatHour: { default: 10 },
      lab: { 'model-': 'lab-a' },
      headless: { claude: { before: [], after: ['-p'], stdin: true } }
    });
  });

  it('takes every swarm value from a full section', () => {
    expect(swarmOf({ ...FIXTURE, ...SECTIONS })).toEqual({ ...SECTIONS.swarm, lab: SECTIONS.lab, headless: SECTIONS.headless });
  });
});
