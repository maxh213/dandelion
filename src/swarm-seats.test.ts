import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { openRoutes, seatsDecision, swarmOf, type ProviderUsage, type RouteLines, type SeatsRequest, type UsageWindow } from './domain/index.ts';
import { renderSeats, type SeatsOutputRequest } from './render/index.ts';

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

const NOW = '2026-10-29T10:00:00.000Z';
const MIDNIGHT = '2026-10-30T00:00:00.000Z';
const HOUR_MS = 3600000;
const COMMANDS = ['claude', 'codex', 'cursor-agent', 'agy', 'kimi', 'grok', 'junie', 'hermes', 'kilo'];
const TEMPLATE = { before: [], after: ['-p'], stdin: true };
const ACCOUNTS = ['claude', 'claude-work', 'claude-animus', 'claude-deepseek', 'claude-ollama', 'agy', 'kimi', 'grok', 'codex', 'codex-animus', 'cursor', 'junie', 'hermes', 'kilo'];
const LINES: RouteLines = { ...FIXTURE, lab: { 'model-': 'lab-a', 'vendor/': 'lab-b' }, headless: Object.fromEntries(COMMANDS.map((command) => [command, TEMPLATE])) };

type Window = UsageWindow;

function inHours(hours: number): string {
  return new Date(Date.parse(NOW) + hours * HOUR_MS).toISOString();
}

function ok(id: string, windows: Window[], extra: Partial<ProviderUsage> = {}): ProviderUsage {
  return { id, displayName: id, status: 'ok', windows, fetchedAt: NOW, ...extra } as ProviderUsage;
}

function down(id: string): ProviderUsage {
  return { id, displayName: id, status: 'unavailable', reason: 'gone', windows: [], fetchedAt: NOW };
}

function rolling(usedPct: number, hours = 3): Window {
  return { label: 'session', kind: 'rolling', usedPct, resetsAt: inHours(hours) };
}

function weekly(usedPct: number, hours = 72, label = 'weekly'): Window {
  return { label, kind: 'weekly', usedPct, resetsAt: inHours(hours) };
}

function rw(id: string, session: number, week: number, weekHours = 72): ProviderUsage {
  return ok(id, [rolling(session), weekly(week, weekHours)]);
}

function kilo(amount: number, currency = '$'): ProviderUsage {
  return ok('kilo', [], { balance: { amount, currency } });
}

function request(requested: number, extra: Partial<SeatsRequest> = {}): SeatsRequest {
  return { mode: 'pack', requested, held: {}, include: [], exclude: [], cap: {}, ...extra };
}

function decide(usages: ProviderUsage[], seatsRequest: SeatsRequest, lines: RouteLines = LINES, ineligible: string[] = []) {
  return seatsDecision(lines, usages, seatsRequest, ineligible, NOW, MIDNIGHT);
}

function accountOf(decision: ReturnType<typeof decide>, id: string) {
  const found = decision.accounts.find((account) => account.id === id);
  if (found === undefined) throw new Error(`no account ${id}`);
  return found;
}

function skipOf(decision: ReturnType<typeof decide>, id: string) {
  const { skip } = accountOf(decision, id);
  if (skip === null) throw new Error(`${id} is not skipped`);
  return skip;
}

function seatLines(decision: ReturnType<typeof decide>): string[] {
  return decision.seats.map((seat) => seat.line);
}

function withSwarm(swarm: RouteLines['swarm'], lines: RouteLines = LINES): RouteLines {
  return { ...lines, swarm };
}

const SHIPPED_SWARM = SECTIONS.swarm;

describe('seatsDecision skip rules', () => {
  it.each<[string, ProviderUsage[], Partial<SeatsRequest>, RouteLines, string[], string, string, string | undefined]>([
    ['the shipped exclude', [rw('claude-work', 10, 10)], {}, withSwarm(SHIPPED_SWARM), [], 'claude-work', 'excluded', 'excluded'],
    ['--exclude', [rw('codex', 10, 10)], { exclude: ['codex'] }, LINES, [], 'codex', 'excluded', 'excluded'],
    ['routing off', [rw('agy', 10, 10)], {}, LINES, ['agy'], 'agy', 'ineligible', 'routing off'],
    ['a failed probe', [down('grok')], {}, LINES, [], 'grok', 'unavailable', 'unavailable'],
    ['no usage', [], {}, LINES, [], 'grok', 'unavailable', 'unavailable'],
    ['an ok probe with no windows', [ok('codex', [])], {}, LINES, [], 'codex', 'unavailable', 'no usage windows'],
    ['cursor with only its api window', [ok('cursor', [weekly(10, 72, 'api')])], {}, LINES, [], 'cursor', 'unavailable', 'no usage windows'],
    ['kilo not ok', [down('kilo')], {}, LINES, [], 'kilo', 'unavailable', 'unavailable'],
    ['a route limit', [rw('codex', 10, 76)], {}, { ...LINES, route: { ...LINES.route, codex: { ...LINES.route.codex, limit: 75 } } }, [], 'codex', 'limited', 'limited at 76% (limit 75%)'],
    ['the swarm trip', [rw('claude', 83, 10)], {}, LINES, [], 'claude', 'tripped', 'tripped at 83%'],
    ['no headless template', [rw('agy', 10, 10)], {}, { ...LINES, headless: { claude: TEMPLATE } }, [], 'agy', 'no-headless', 'no headless template for agy'],
    ['--spread on an account outside the chain', [rw('kimi', 10, 10)], { mode: 'spread' }, LINES, [], 'kimi', 'not-in-chain', 'not in the --high chain'],
    ['--spread with every rank gated', [ok('cursor', [weekly(85, 72, 'total')])], { mode: 'spread' }, LINES, [], 'cursor', 'not-in-chain', 'no --high rank under 80%'],
    ['the headroom rule', [ok('grok', [weekly(88, 72, 'credits')])], {}, LINES, [], 'grok', 'spent', 'spent: 12% left, one seat needs 15%'],
    ['--cap 0', [rw('codex', 10, 10)], { cap: { codex: 0 } }, LINES, [], 'codex', 'spent', 'cap 0'],
    ['swarm.cap 0', [rw('codex', 10, 10)], {}, withSwarm({ cap: { codex: 0 } }), [], 'codex', 'spent', 'cap 0'],
    ['kilo --cap 0', [kilo(14.15)], { cap: { kilo: 0 } }, LINES, [], 'kilo', 'spent', 'cap 0'],
    ['kilo at exactly $10', [kilo(10)], {}, LINES, [], 'kilo', 'balance', 'balance $10.00, needs above $10.00'],
    ['kilo in another currency', [kilo(14.15, 'USD')], {}, LINES, [], 'kilo', 'balance', 'balance USD14.15, needs above $10.00'],
    ['kilo without a balance', [ok('kilo', [])], {}, LINES, [], 'kilo', 'balance', 'balance unavailable']
  ])('%s', (_case, usages, extra, lines, ineligible, id, reason, text) => {
    const account = accountOf(decide(usages, request(6, extra), lines, ineligible), id);
    expect(account.target).toBe(0);
    expect(account.skip).toMatchObject({ reason, text });
  });

  it('takes the first reason that applies', () => {
    const decision = decide([rw('codex', 95, 10), rw('agy', 85, 10)], request(2, { exclude: ['codex'] }), { ...LINES, headless: {} }, ['agy']);
    expect(skipOf(decision, 'codex').reason).toBe('excluded');
    expect(skipOf(decision, 'agy').reason).toBe('ineligible');
    const tripped = decide([rw('agy', 85, 10)], request(2), { ...LINES, headless: {} });
    expect(skipOf(tripped, 'agy').reason).toBe('tripped');
  });

  it('sets backAt to the latest reset of the tripping or limiting windows, and leaves it out when one is unknown or past', () => {
    const twoTripping = ok('claude', [rolling(85, 2), { label: 'other session', kind: 'rolling', usedPct: 95, resetsAt: inHours(4) }, weekly(10)]);
    expect(accountOf(decide([twoTripping], request(1)), 'claude').skip).toEqual({ reason: 'tripped', text: 'tripped at 95%', backAt: inHours(4) });
    const unknown = ok('claude', [{ label: 'session', kind: 'rolling', usedPct: 85 }]);
    expect(accountOf(decide([unknown], request(1)), 'claude').skip).toEqual({ reason: 'tripped', text: 'tripped at 85%' });
    const limited = { ...LINES, route: { ...LINES.route, codex: { ...LINES.route.codex, limit: 50 } } };
    expect(accountOf(decide([rw('codex', 10, 60)], request(1), limited), 'codex').skip).toEqual({ reason: 'limited', text: 'limited at 60% (limit 50%)', backAt: inHours(72) });
  });

  it('lets --include lift the shipped exclude for one call', () => {
    const lines = withSwarm(SHIPPED_SWARM);
    expect(seatLines(decide([rw('claude-work', 10, 10)], request(2), lines))).toEqual([]);
    expect(seatLines(decide([rw('claude-work', 10, 10)], request(2, { include: ['claude-work'] }), lines))).toEqual(['model-a high claude-work', 'model-a high claude-work']);
    expect(seatLines(decide([rw('claude-work', 10, 10)], request(2, { include: ['claude-work'], exclude: ['claude-work'] }), lines))).toHaveLength(2);
  });
});

describe('seatsDecision swarm trip', () => {
  it.each<[number, Partial<SeatsRequest>, RouteLines, number, number]>([
    [80, {}, LINES, 80, 0],
    [79, {}, LINES, 80, 1],
    [80, { trip: 85 }, LINES, 85, 1],
    [84.9, { trip: 85 }, LINES, 85, 1],
    [85, { trip: 85 }, LINES, 85, 0],
    [70, {}, withSwarm({ trip: 70 }), 70, 0],
    [70, { trip: 75 }, withSwarm({ trip: 70 }), 75, 1]
  ])('a rolling window at %s%% with %j gives %i seats', (used, extra, lines, trip, target) => {
    const decision = decide([rw('claude', used, 10)], request(1, extra), lines);
    expect(accountOf(decision, 'claude').target).toBe(target);
    expect(decision.trip).toBe(trip);
  });

  it('never trips on a weekly window', () => {
    expect(accountOf(decide([rw('claude', 10, 89)], request(1)), 'claude').target).toBe(0);
    expect(skipOf(decide([rw('claude', 10, 89)], request(1)), 'claude').reason).toBe('spent');
    expect(accountOf(decide([rw('claude', 10, 85)], request(1)), 'claude').target).toBe(1);
  });
});

describe('seatsDecision held seats', () => {
  it('keeps held seats first, marked held, so an unchanged snapshot does not churn', () => {
    const usages = [rw('claude', 0, 0), rw('codex', 10, 10)];
    const lines = withSwarm({ cap: { default: 3 } });
    const decision = decide(usages, request(2, { held: { codex: 2 } }), lines);
    expect(decision.seats.map(({ account, held }) => [account, held])).toEqual([['codex', true], ['codex', true]]);
    expect(accountOf(decision, 'codex')).toMatchObject({ held: 2, target: 2 });
    expect(seatLines(decide(usages, request(2), lines))).toEqual(['model-a high claude', 'model-a high claude']);
  });

  it('gives a tripped held account target 0 and fills elsewhere', () => {
    const decision = decide([rw('claude', 5, 5), rw('codex', 85, 10)], request(2, { held: { codex: 2 } }));
    expect(accountOf(decision, 'codex')).toMatchObject({ held: 2, target: 0, skip: { reason: 'tripped' } });
    expect(decision.seats.map(({ account, held }) => [account, held])).toEqual([['claude', false], ['claude', false]]);
  });

  it('keeps at most what the account still allows, then adds seats after the kept ones', () => {
    const decision = decide([rw('claude', 5, 5), rw('codex', 10, 70)], request(4, { held: { codex: 4, claude: 1 } }));
    expect(decision.seats.map(({ account, held }) => [account, held])).toEqual([['claude', true], ['codex', true], ['codex', true], ['claude', false]]);
  });

  it('drops kept seats beyond N from the lowest scores first, kilo first, and the later account on a tie', () => {
    const scored = decide([rw('codex', 10, 40), rw('agy', 10, 10)], request(3, { held: { codex: 2, agy: 2 } }));
    expect(scored.seats.map(({ account, held }) => [account, held])).toEqual([['agy', true], ['agy', true], ['codex', true]]);
    const withKilo = decide([rw('agy', 10, 10), kilo(14.15)], request(2, { held: { agy: 2, kilo: 1 } }));
    expect(withKilo.seats.map(({ account }) => account)).toEqual(['agy', 'agy']);
    const tie = decide([rw('agy', 10, 10), rw('codex', 10, 10)], request(3, { held: { agy: 2, codex: 2 } }));
    expect(tie.seats.map(({ account }) => account)).toEqual(['agy', 'agy', 'codex']);
  });

  it('gives kept pack seats the line their account gets now', () => {
    const decision = decide([rw('agy', 10, 50, 2), kilo(14.15)], request(3, { held: { agy: 1, kilo: 1 } }));
    expect(decision.seats.map(({ line, kind, held }) => [line, kind, held])).toEqual([
      ['model-c max agy', 'evaporating', true],
      ['vendor/model-k max kilo', 'balance', true],
      ['model-c max agy', 'evaporating', false]
    ]);
  });
});

describe('seatsDecision --pack', () => {
  it('serves an evaporating account first with its max line, up to its allowance, then the rest on headroom', () => {
    const decision = decide([rw('claude', 10, 10), rw('agy', 10, 50, 2)], request(4));
    expect(decision.seats.map(({ line, kind }) => [line, kind])).toEqual([
      ['model-c max agy', 'evaporating'],
      ['model-c max agy', 'evaporating'],
      ['model-a high claude', 'headroom'],
      ['model-a high claude', 'headroom']
    ]);
    expect(accountOf(decision, 'agy').evaporating).toBe(true);
    expect(accountOf(decision, 'claude').evaporating).toBe(false);
  });

  it('serves the evaporating account with the most left first, and the earlier one on a tie', () => {
    const most = decide([rw('agy', 10, 60, 2), rw('kimi', 10, 40, 2)], request(4));
    expect(seatLines(most)).toEqual(['model-d max kimi', 'model-d max kimi', 'model-c max agy', 'model-c max agy']);
    const tie = decide([rw('kimi', 10, 50, 2), rw('agy', 10, 50, 2)], request(1));
    expect(seatLines(tie)).toEqual(['model-c max agy']);
  });

  it('leaves out an account whose shared window is spent, as route does', () => {
    const claude = ok('claude', [rolling(10), weekly(100), weekly(50, 2, 'weekly Fable')]);
    expect(accountOf(decide([claude], request(1)), 'claude')).toMatchObject({ evaporating: false, score: 0 });
  });

  it('gives each next seat to the highest effective score, ties in dashboard order', () => {
    const lines = withSwarm({ cap: { default: 4 } });
    expect(decide([rw('claude', 0, 20), rw('codex', 0, 45)], request(4), lines).seats.map(({ account }) => account)).toEqual(['claude', 'claude', 'claude', 'codex']);
    expect(decide([rw('claude', 0, 20), rw('codex', 0, 50)], request(5), lines).seats.map(({ account }) => account)).toEqual(['claude', 'claude', 'claude', 'claude', 'codex']);
  });

  it('applies the headroom rule, the caps and the burn rates', () => {
    const lines = withSwarm({ cap: { default: 4 } });
    expect(accountOf(decide([rw('codex', 0, 70)], request(10), lines), 'codex')).toMatchObject({ target: 2, cap: 4, score: 30 });
    expect(accountOf(decide([rw('codex', 0, 70)], request(10, { cap: { codex: 1 } }), lines), 'codex')).toMatchObject({ target: 1, cap: 1 });
    expect(accountOf(decide([rw('codex', 0, 0)], request(10), withSwarm({ cap: { default: 20 }, burnPerSeatHour: { codex: 30 } })), 'codex').target).toBe(3);
    expect(accountOf(decide([rw('codex', 0, 0)], request(10), withSwarm({ minLeft: 50, burnPerSeatHour: { default: 0 } })), 'codex').target).toBe(2);
    expect(skipOf(decide([rw('codex', 0, 60)], request(10), withSwarm({ minLeft: 40 })), 'codex').text).toBe('spent: 40% left, one seat needs 50%');
  });

  it('gives kilo seats only when no windowed account can take another', () => {
    const full = decide([rw('codex', 0, 70), kilo(14.15)], request(10));
    expect(full.seats.map(({ line, kind }) => [line, kind])).toEqual([
      ['model-i high codex', 'headroom'],
      ['model-i high codex', 'headroom'],
      ['vendor/model-k max kilo', 'balance']
    ]);
    expect(accountOf(full, 'kilo')).toMatchObject({ cap: 1, target: 1, score: null, balance: 14.15, skip: null });
    expect(seatLines(decide([rw('codex', 0, 70), kilo(14.15)], request(2)))).toEqual(['model-i high codex', 'model-i high codex']);
    expect(accountOf(decide([kilo(14.15)], request(5), withSwarm({ cap: { kilo: 3 } })), 'kilo').target).toBe(3);
    expect(accountOf(decide([kilo(14.15)], request(5, { cap: { kilo: 2 } })), 'kilo').target).toBe(2);
  });

  it('stops at N, and returns no seats when nothing can take one', () => {
    expect(decide([rw('claude', 0, 0), rw('codex', 0, 0)], request(3)).seats).toHaveLength(3);
    expect(decide([], request(3)).seats).toEqual([]);
  });
});

describe('seatsDecision --spread', () => {
  const RANKED = [ok('claude', [rolling(5), weekly(5), weekly(10, 72, 'weekly Fable')]), rw('codex', 5, 5), ok('cursor', [weekly(5, 72, 'total'), weekly(5, 72, 'auto'), weekly(5, 72, 'api')]), ok('grok', [weekly(5, 72, 'credits')]), rw('agy', 5, 5)];
  const spread = (requested: number, extra: Partial<SeatsRequest> = {}) => request(requested, { mode: 'spread', ...extra });

  it('gives exactly one seat per rank, in chain order, with the rank line', () => {
    const decision = decide(RANKED, spread(6), withSwarm({ cap: { default: 3 } }));
    expect(decision.seats.map(({ line, kind, rank, rankName }) => [line, kind, rank, rankName])).toEqual([
      ['model-h1 max claude', 'chain', 1, 'fable'],
      ['model-i xhigh codex', 'chain', 2, 'codex'],
      ['model-f cursor', 'chain', 3, 'cursor'],
      ['model-a max claude', 'chain', 4, 'opus'],
      ['model-e xhigh grok', 'chain', 5, 'grok'],
      ['model-c high agy', 'chain', 6, 'agy']
    ]);
  });

  it('gives a second seat per rank only where the account caps and headroom allow', () => {
    const decision = decide(RANKED, spread(12), withSwarm({ cap: { default: 2, claude: 3 } }));
    expect(decision.seats.map(({ rankName }) => rankName)).toEqual(['fable', 'codex', 'cursor', 'opus', 'grok', 'agy', 'fable', 'codex', 'cursor', 'grok', 'agy']);
    const names = decision.seats.map(({ rankName }) => rankName);
    expect(names.every((name) => names.filter((each) => each === name).length <= 2)).toBe(true);
    expect(accountOf(decision, 'claude').target).toBe(3);
  });

  it('puts a rank on its best account, and skips ranks gated at the swarm trip', () => {
    const lines = withSwarm({ exclude: [] });
    const usages = [ok('claude', [rolling(30), weekly(30), weekly(85, 72, 'weekly Fable')]), ok('claude-work', [rolling(5), weekly(5), weekly(5, 72, 'weekly Fable')])];
    expect(decide(usages, spread(2), lines).seats.map(({ line }) => line)).toEqual(['model-h1 max claude-work', 'model-a max claude-work']);
    expect(decide(usages, spread(3), lines).seats.map(({ line }) => line)).toEqual(['model-h1 max claude-work', 'model-a max claude-work', 'model-a max claude']);
  });

  it('counts a kept seat as a turn of the highest rank its account is available for', () => {
    const decision = decide(RANKED, spread(3, { held: { agy: 1, claude: 1 } }), withSwarm({ cap: { default: 3 } }));
    expect(decision.seats.map(({ rankName, held }) => [rankName, held])).toEqual([['fable', true], ['agy', true], ['codex', false]]);
  });
});

describe('seatsDecision accounts', () => {
  it('lists every routed account in dashboard order with its cap, held, target, score, balance and windows', () => {
    const cursor = ok('cursor', [weekly(20.4, 72, 'total'), weekly(10, 72, 'auto'), weekly(95, 72, 'api')]);
    const decision = decide([cursor, kilo(14.15)], request(1, { held: { cursor: 1 } }));
    expect(decision.accounts.map((account) => account.id)).toEqual(ACCOUNTS);
    expect(accountOf(decision, 'cursor')).toEqual({ id: 'cursor', command: 'cursor-agent', cap: 2, held: 1, target: 1, score: 79.6, evaporating: false, balance: null, skip: null, windows: cursor.windows });
    expect(accountOf(decision, 'kilo')).toMatchObject({ command: 'kilo', cap: 1, held: 0, target: 0, score: null, balance: 14.15, skip: null, windows: [] });
    expect(accountOf(decision, 'claude')).toMatchObject({ score: null, windows: [], skip: { reason: 'unavailable' } });
    expect(accountOf(decide([kilo(14.15, 'USD')], request(1)), 'kilo').balance).toBeNull();
  });

  it('builds each seat from its line: model, effort or null, command, and the lab of the longest matching prefix or unknown', () => {
    const lines: RouteLines = { ...LINES, lab: { 'model-': 'lab-a', 'model-i': 'lab-i' } };
    const decision = decide([rw('codex', 0, 0), ok('cursor', [weekly(0, 72, 'total')]), ok('hermes', [weekly(0, 72, 'credits')])], request(6), lines);
    const seat = (account: string) => decision.seats.find((each) => each.account === account);
    expect(seat('codex')).toEqual({ account: 'codex', line: 'model-i high codex', model: 'model-i', effort: 'high', command: 'codex', lab: 'lab-i', kind: 'headroom', rank: null, rankName: null, held: false });
    expect(seat('cursor')).toMatchObject({ line: 'model-f cursor', model: 'model-f', effort: null, command: 'cursor-agent', lab: 'lab-a' });
    expect(seat('hermes')).toMatchObject({ model: 'vendor/model-h', lab: 'unknown' });
  });
});

describe('renderSeats', () => {
  const ZONE = 'UTC';
  const output = (usages: ProviderUsage[], extra: Partial<SeatsOutputRequest> = {}, lines: RouteLines = LINES) =>
    renderSeats(lines, usages, [], { ...request(2), now: NOW, zone: ZONE, json: false, why: false, ...extra });

  it('prints one line per seat and exits 0', () => {
    expect(output([rw('codex', 10, 10)])).toEqual({ out: 'model-i high codex\nmodel-i high codex\n', err: '', code: 0 });
  });

  it('prints none and exits 1 with no seat', () => {
    expect(output([])).toEqual({ out: 'none\n', err: '', code: 1 });
  });

  it('adds one # skip line per skipped account in dashboard order with --why, local back times included', () => {
    const { out, code } = output([rw('claude', 83, 10), rw('codex', 10, 10)], { why: true, requested: 1 });
    expect(code).toBe(0);
    const lines = out.trimEnd().split('\n');
    expect(lines.slice(0, 3)).toEqual(['model-i high codex', '# skip claude: tripped at 83%, back Thu 13:00', '# skip claude-work: unavailable']);
    expect(lines.filter((line) => line.startsWith('# skip '))).toHaveLength(13);
    expect(output([], { why: true }).out.split('\n')[0]).toBe('none');
  });

  it('prints the contract JSON on one line, with skip text, backAt and rounded windows', () => {
    const { out, code } = output([rw('claude', 83.4, 10), ok('codex', [rolling(30.4), weekly(10.6)])], { json: true, requested: 3, held: { codex: 1 } });
    expect(code).toBe(0);
    expect(out.endsWith('}\n')).toBe(true);
    expect(out.trimEnd().split('\n')).toHaveLength(1);
    const object = JSON.parse(out);
    expect(Object.keys(object)).toEqual(['generatedAt', 'mode', 'requested', 'trip', 'seats', 'accounts']);
    expect(object).toMatchObject({ generatedAt: NOW, mode: 'pack', requested: 3, trip: 80 });
    expect(object.seats[0]).toEqual({ account: 'codex', line: 'model-i high codex', model: 'model-i', effort: 'high', command: 'codex', lab: 'lab-a', kind: 'headroom', rank: null, rankName: null, held: true });
    const codex = object.accounts.find((account: { id: string }) => account.id === 'codex');
    expect(Object.keys(codex)).toEqual(['id', 'command', 'cap', 'held', 'target', 'score', 'evaporating', 'balance', 'skip', 'windows']);
    expect(codex.windows).toEqual([{ label: 'session', kind: 'rolling', usedPct: 30, resetsAt: inHours(3) }, { label: 'weekly', kind: 'weekly', usedPct: 11, resetsAt: inHours(72) }]);
    const claude = object.accounts.find((account: { id: string }) => account.id === 'claude');
    expect(claude.skip).toEqual({ reason: 'tripped', text: 'tripped at 83%, back Thu 13:00', backAt: inHours(3) });
    const grok = object.accounts.find((account: { id: string }) => account.id === 'grok');
    expect(grok.skip).toEqual({ reason: 'unavailable', text: 'unavailable', backAt: null });
    expect(object.accounts).toHaveLength(14);
  });

  it('prints the JSON with an empty seats list and exits 1 when nothing can take a seat', () => {
    const { out, code } = output([], { json: true, mode: 'spread' });
    expect(code).toBe(1);
    expect(JSON.parse(out)).toMatchObject({ mode: 'spread', seats: [] });
  });
});
