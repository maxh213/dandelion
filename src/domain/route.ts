export type WindowKind = 'rolling' | 'weekly' | 'other';

type RoutableWindow = { label: string; kind: WindowKind; usedPct: number; resetsAt?: string };

type RoutableUsage = { id: string; status: string; windows: RoutableWindow[]; balance?: { amount: number; currency: string } };

type RouteEntry = { standard: string; max: string; limit?: number };

export type HeadlessTemplate = { before: string[]; after: string[]; stdin: boolean };

type Counts = Partial<Record<string, number>>;

type SwarmSection = { trip?: number; minLeft?: number; exclude?: string[]; cap?: Counts; burnPerSeatHour?: Counts };

export type RouteLines = {
  route: Record<string, RouteEntry>;
  high: Record<string, string>;
  swarm?: SwarmSection;
  lab?: Record<string, string>;
  headless?: Partial<Record<string, HeadlessTemplate>>;
};

export type Limits = Partial<Record<string, number>>;

export type RoutesFault = { path: string; problem: string };

export type Routes = { lines: RouteLines; fault?: undefined } | { lines?: undefined; fault: RoutesFault };

export interface RoutesFile {
  read(path: string): string;
}

const ROUTED_IDS = ['claude', 'claude-work', 'claude-animus', 'claude-deepseek', 'claude-ollama', 'agy', 'kimi', 'grok', 'codex', 'codex-animus', 'cursor', 'junie', 'hermes', 'kilo'];
const COMMANDS: Record<string, string> = {
  claude: 'claude',
  'claude-work': 'claude',
  'claude-animus': 'claude',
  'claude-deepseek': 'claude',
  'claude-ollama': 'claude',
  agy: 'agy',
  kimi: 'kimi',
  grok: 'grok',
  codex: 'codex',
  'codex-animus': 'codex',
  cursor: 'cursor-agent',
  junie: 'junie',
  hermes: 'hermes',
  kilo: 'kilo'
};
const HEADLESS_COMMANDS = [...new Set(Object.values(COMMANDS))];
const WINDOWED_IDS = ROUTED_IDS.filter((id) => id !== 'kilo');
export const NO_ROUTE = 'none';
const UNTOUCHED_LEFT = 97;
const FULL_LEFT = 100;
const TRIP_PCT = 90;
const MIN_SWARM_TRIP = 50;
const MAX_CAP = 20;
const DEFAULT_KEY = 'default';
const DEFAULT_SWARM_TRIP = 80;
const DEFAULT_MIN_LEFT = 5;
const DEFAULT_CAP = 2;
const DEFAULT_KILO_CAP = 1;
const DEFAULT_BURN = 10;
const KILO_MINIMUM_BALANCE = 10;
const OFF_ROUTE_LABELS: Record<string, readonly string[]> = { cursor: ['api'] };
const CREDIT_ACCOUNTS = new Set(['junie', 'hermes']);

type Candidate = { id: string; windows: RoutableWindow[] };

type Pick = { id: string | undefined; score: number };

export type Tonight = { nowMs: number; midnightMs: number };

export function isRoutable(usage: RoutableUsage | undefined): usage is RoutableUsage {
  return usage?.status === 'ok' && usage.windows.length > 0;
}

function eligibleUsages(usages: RoutableUsage[], ineligible: string[]): RoutableUsage[] {
  return usages.filter((usage) => !ineligible.includes(usage.id));
}

export function trips(usedPct: number): boolean {
  return usedPct >= TRIP_PCT;
}

function onAccount(line: string, id: string): string {
  return `${line} ${id}`;
}

function onRoute(id: string, windows: RoutableWindow[]): RoutableWindow[] {
  const offRoute = OFF_ROUTE_LABELS[id] ?? [];
  return windows.filter((window) => !offRoute.includes(window.label));
}

function candidatesOf(usages: RoutableUsage[]): Candidate[] {
  return WINDOWED_IDS.flatMap((id) => {
    const usage = usages.find((each) => each.id === id);
    const windows = isRoutable(usage) ? onRoute(id, usage.windows) : [];
    return windows.length > 0 ? [{ id, windows }] : [];
  });
}

function mostUsedFirst(a: RoutableWindow, b: RoutableWindow): number {
  return b.usedPct - a.usedPct;
}

function trippingWindows({ windows }: Candidate): RoutableWindow[] {
  return windows.filter((window) => window.kind === 'rolling' && trips(window.usedPct)).sort(mostUsedFirst);
}

function isUntripped(candidate: Candidate): boolean {
  return trippingWindows(candidate).length === 0;
}

function hasCreditHeadroom(candidate: Candidate): boolean {
  return !CREDIT_ACCOUNTS.has(candidate.id) || bindingLeft(candidate.windows) > 0;
}

function leftOf(window: RoutableWindow): number {
  return FULL_LEFT - window.usedPct;
}

function resetsTonight(window: RoutableWindow, tonight: Tonight): boolean {
  const resetMs = Date.parse(String(window.resetsAt));
  return resetMs > tonight.nowMs && resetMs < tonight.midnightMs;
}

export function evaporates(window: RoutableWindow, tonight: Tonight): boolean {
  return window.kind === 'weekly' && leftOf(window) < UNTOUCHED_LEFT && leftOf(window) > 0 && resetsTonight(window, tonight);
}

function bindingLeft(windows: RoutableWindow[]): number {
  return Math.min(FULL_LEFT, ...windows.filter((window) => window.kind !== 'other').map(leftOf));
}

function highest(candidates: Candidate[], score: (windows: RoutableWindow[]) => number): Pick {
  return candidates.reduce<Pick>((best, { id, windows }) => {
    const value = score(windows);
    return value > best.score ? { id, score: value } : best;
  }, { id: undefined, score: -Infinity });
}

type Tripped = { id: string; label: string; usedPct: number; backAt?: string };

type Limited = Tripped & { limit: number };

export type Skipped = { limited: Limited[]; tripped: Tripped[]; ineligible: string[]; unavailable: string[] };

type WindowChosen = { rule: 'evaporation' | 'headroom'; id: string; left: number; label?: string; resetsAt?: string };

type Chosen = WindowChosen | { rule: 'balance'; id: 'kilo' };

type Rival = { id: string; left: number };

export type RouteDecision = { chosen: Chosen | undefined; rivals: Rival[]; skipped: Skipped };

function backAtOf(windows: RoutableWindow[], nowMs: number): string | undefined {
  const resets = windows.map((window) => Date.parse(String(window.resetsAt)));
  const known = resets.every((resetMs) => !Number.isNaN(resetMs));
  const latest = Math.max(...resets);
  return known && latest > nowMs ? new Date(latest).toISOString() : undefined;
}

function heldBack(id: string, windows: RoutableWindow[], nowMs: number): Tripped[] {
  const [worst] = windows;
  if (worst === undefined) return [];
  const backAt = backAtOf(windows, nowMs);
  return [{ id, label: worst.label, usedPct: worst.usedPct, ...(backAt === undefined ? {} : { backAt }) }];
}

function trippedOf(candidates: Candidate[], nowMs: number): Tripped[] {
  return candidates.flatMap((candidate) => heldBack(candidate.id, trippingWindows(candidate), nowMs));
}

function windowsAtLimit({ windows }: Candidate, limit: number): RoutableWindow[] {
  return windows.filter((window) => window.kind !== 'other' && window.usedPct >= limit).sort(mostUsedFirst);
}

function limitedOf(candidates: Candidate[], limits: Limits, nowMs: number): Limited[] {
  return candidates.flatMap((candidate) => {
    const limit = limits[candidate.id] ?? Infinity;
    return heldBack(candidate.id, windowsAtLimit(candidate, limit), nowMs).map((held) => ({ ...held, limit }));
  });
}

function belowLimit<T extends { id: string }>(accounts: T[], limited: Limited[]): T[] {
  return accounts.filter(({ id }) => !limited.some((each) => each.id === id));
}

function skippedOf(all: Candidate[], ineligible: string[], kiloAvailable: boolean, held: { limited: Limited[]; tripped: Tripped[] }): Skipped {
  return {
    ...held,
    ineligible: ROUTED_IDS.filter((id) => ineligible.indexOf(id) !== -1),
    unavailable: ROUTED_IDS.filter((id) => !ineligible.includes(id) && !all.some((candidate) => candidate.id === id) && !(id === 'kilo' && kiloAvailable))
  };
}

function sharedWindows({ id, windows }: Candidate): RoutableWindow[] {
  const claimed = matchersInChainFor(id);
  return windows.filter((window) => !claimed.some((matcher) => matches(window, matcher)));
}

function evaporatingOf({ id, windows }: Candidate, tonight: Tonight): WindowChosen[] {
  return windows
    .filter((window) => evaporates(window, tonight))
    .map((window) => ({ rule: 'evaporation', id, left: leftOf(window), label: window.label, resetsAt: String(window.resetsAt) }));
}

function evaporationChoice(candidates: Candidate[], tonight: Tonight): WindowChosen | undefined {
  return candidates
    .filter((candidate) => bindingLeft(sharedWindows(candidate)) > 0)
    .flatMap((candidate) => evaporatingOf(candidate, tonight))
    .reduce<WindowChosen | undefined>((best, each) => (best === undefined || each.left > best.left ? each : best), undefined);
}

function headroomChoice(candidates: Candidate[]): WindowChosen | undefined {
  const { id, score } = highest(candidates, bindingLeft);
  return id === undefined ? undefined : { rule: 'headroom', id, left: score };
}

function kiloBalance(usages: RoutableUsage[]) {
  const kilo = usages.find((usage) => usage.id === 'kilo');
  if (kilo?.status !== 'ok') return undefined;
  return kilo.balance;
}

function usableKilo(usages: RoutableUsage[]): boolean {
  const balance = kiloBalance(usages);
  if (balance?.currency !== '$') return false;
  return balance.amount > KILO_MINIMUM_BALANCE;
}

function balanceChoice(usages: RoutableUsage[]): Chosen | undefined {
  return usableKilo(usages) ? { rule: 'balance', id: 'kilo' } : undefined;
}

function rivalsOf(candidates: Candidate[], chosen: Chosen | undefined): Rival[] {
  if (chosen?.rule !== 'headroom') return [];
  return candidates.filter(({ id }) => id !== chosen.id).map(({ id, windows }) => ({ id, left: bindingLeft(windows) }));
}

export function routeDecision(usages: RoutableUsage[], now: string, midnight: string, ineligible: string[], limits: Limits): RouteDecision {
  const eligible = eligibleUsages(usages, ineligible);
  const all = candidatesOf(eligible);
  const tonight = { nowMs: Date.parse(now), midnightMs: Date.parse(midnight) };
  const limited = limitedOf(all, limits, tonight.nowMs);
  const open = belowLimit(all, limited);
  const candidates = open.filter(isUntripped).filter(hasCreditHeadroom);
  const balance = balanceChoice(eligible);
  const chosen = evaporationChoice(candidates, tonight) ?? headroomChoice(candidates) ?? balance;
  return { chosen, rivals: rivalsOf(candidates, chosen), skipped: skippedOf(all, ineligible, balance !== undefined, { limited, tripped: trippedOf(open, tonight.nowMs) }) };
}

export function routeDecisionLine(lines: RouteLines, { chosen }: RouteDecision): string {
  if (chosen === undefined) return NO_ROUTE;
  const rule = lines.route[chosen.id];
  return onAccount(chosen.rule === 'evaporation' ? rule.max : rule.standard, chosen.id);
}

function limitEntries(route: Record<string, RouteEntry>): [string, number][] {
  return Object.entries(route).flatMap(([id, { limit }]) => (limit === undefined ? [] : [[id, limit]]));
}

export function limitsOf(lines: RouteLines | undefined): Limits {
  return lines === undefined ? {} : Object.fromEntries(limitEntries(lines.route));
}

type SwarmSettings = {
  trip: number;
  minLeft: number;
  exclude: string[];
  cap: Counts;
  burnPerSeatHour: Counts;
  lab: Record<string, string>;
  headless: Partial<Record<string, HeadlessTemplate>>;
};

export function swarmOf(lines: RouteLines): SwarmSettings {
  const swarm = { trip: DEFAULT_SWARM_TRIP, minLeft: DEFAULT_MIN_LEFT, exclude: [], ...lines.swarm };
  return {
    trip: swarm.trip,
    minLeft: swarm.minLeft,
    exclude: swarm.exclude,
    cap: { [DEFAULT_KEY]: DEFAULT_CAP, kilo: DEFAULT_KILO_CAP, ...swarm.cap },
    burnPerSeatHour: { [DEFAULT_KEY]: DEFAULT_BURN, ...swarm.burnPerSeatHour },
    lab: { ...lines.lab },
    headless: { ...lines.headless }
  };
}

export function routeLine(lines: RouteLines, usages: RoutableUsage[], now: string, midnight: string, ineligible: string[]): string {
  return routeDecisionLine(lines, routeDecision(usages, now, midnight, ineligible, limitsOf(lines)));
}

type ChainEntry = { rank: number; name: string; providers: readonly string[]; matcher?: string };

export const HIGH_CHAIN: readonly ChainEntry[] = [
  { rank: 1, name: 'fable', providers: ['claude', 'claude-work', 'claude-animus'], matcher: 'fable' },
  { rank: 2, name: 'codex', providers: ['codex'] },
  { rank: 3, name: 'cursor', providers: ['cursor'] },
  { rank: 4, name: 'opus', providers: ['claude', 'claude-work', 'claude-animus'] },
  { rank: 5, name: 'grok', providers: ['grok'] },
  { rank: 6, name: 'agy', providers: ['agy'] }
] satisfies readonly ChainEntry[];

type Account = { id: string; used: number };

type MatcherEntry = ChainEntry & { matcher: string };

function hasMatcher(entry: ChainEntry): entry is MatcherEntry {
  return entry.matcher !== undefined;
}

function matches(window: RoutableWindow, matcher: string): boolean {
  return window.label.toLowerCase().includes(matcher.toLowerCase());
}

function matchersInChainFor(id: string): string[] {
  return HIGH_CHAIN.filter(hasMatcher).filter((entry) => entry.providers.includes(id)).map((entry) => entry.matcher);
}

function gatingWindows(entry: ChainEntry, usage: RoutableUsage): RoutableWindow[] {
  if (hasMatcher(entry)) return usage.windows.filter((window) => window.kind === 'rolling' || matches(window, entry.matcher));
  const claimedByOtherEntries = matchersInChainFor(usage.id);
  return usage.windows.filter((window) => !claimedByOtherEntries.some((other) => matches(window, other)));
}

function highestUsed(windows: RoutableWindow[]): number {
  return Math.max(0, ...windows.map((window) => window.usedPct));
}

function openAccounts(entry: ChainEntry, usages: RoutableUsage[]): Account[] {
  return entry.providers
    .map((id) => usages.find((each) => each.id === id))
    .filter(isRoutable)
    .map((usage) => ({ id: usage.id, used: highestUsed(gatingWindows(entry, usage)) }))
    .filter((account) => !trips(account.used));
}

export type ChainSkip = { rank: number; name: string; usedPct: number | undefined };

export type ChainWin = { rank: number; name: string; id: string; usedPct: number };

export type HighDecision = { winner: ChainWin | undefined; skipped: ChainSkip[]; limited: Limited[] };

function leastUsedOpen(entry: ChainEntry, usages: RoutableUsage[]): Account | undefined {
  return openAccounts(entry, usages).sort((a, b) => a.used - b.used)[0];
}

function lowestUsed(entry: ChainEntry, usages: RoutableUsage[]): number | undefined {
  const used = entry.providers
    .map((id) => usages.find((each) => each.id === id))
    .filter(isRoutable)
    .map((usage) => highestUsed(gatingWindows(entry, usage)));
  return used.length === 0 ? undefined : Math.min(...used);
}

function skipOf(entry: ChainEntry, usages: RoutableUsage[]): ChainSkip {
  return { rank: entry.rank, name: entry.name, usedPct: lowestUsed(entry, usages) };
}

const CHAIN_IDS = WINDOWED_IDS.filter((id) => HIGH_CHAIN.some((entry) => entry.providers.includes(id)));

function chainCandidates(usages: RoutableUsage[]): Candidate[] {
  return CHAIN_IDS.flatMap((id) => {
    const usage = usages.find((each) => each.id === id);
    return isRoutable(usage) ? [{ id, windows: usage.windows }] : [];
  });
}

function chainWalk(usages: RoutableUsage[]): Omit<HighDecision, 'limited'> {
  const skipped: ChainSkip[] = [];
  for (const entry of HIGH_CHAIN) {
    const open = leastUsedOpen(entry, usages);
    if (open !== undefined) return { winner: { rank: entry.rank, name: entry.name, id: open.id, usedPct: open.used }, skipped };
    skipped.push(skipOf(entry, usages));
  }
  return { winner: undefined, skipped };
}

export function highDecision(usages: RoutableUsage[], now: string, ineligible: string[], limits: Limits): HighDecision {
  const eligible = eligibleUsages(usages, ineligible);
  const limited = limitedOf(chainCandidates(eligible), limits, Date.parse(now));
  return { ...chainWalk(belowLimit(eligible, limited)), limited };
}

export function highDecisionLine(lines: RouteLines, { winner }: HighDecision): string {
  return winner === undefined ? NO_ROUTE : onAccount(lines.high[winner.name], winner.id);
}

export function highRouteLine(lines: RouteLines, usages: RoutableUsage[], now: string, ineligible: string[]): string {
  return highDecisionLine(lines, highDecision(usages, now, ineligible, limitsOf(lines)));
}

export const ACCOUNT_IDS: readonly string[] = ROUTED_IDS;

type SeatsMode = 'pack' | 'spread';

export type SeatsRequest = { mode: SeatsMode; requested: number; held: Counts; include: string[]; exclude: string[]; trip?: number; cap: Counts };

type SkipReason = 'excluded' | 'ineligible' | 'unavailable' | 'limited' | 'tripped' | 'no-headless' | 'not-in-chain' | 'spent' | 'balance';

export type SeatSkip = { reason: SkipReason; text: string; backAt?: string };

type SeatKind = 'evaporating' | 'headroom' | 'balance' | 'chain';

type Seat = {
  account: string;
  line: string;
  model: string;
  effort: string | null;
  command: string;
  lab: string;
  kind: SeatKind;
  rank: number | null;
  rankName: string | null;
  held: boolean;
};

export type SeatAccount = {
  id: string;
  command: string;
  cap: number;
  held: number;
  target: number;
  score: number | null;
  evaporating: boolean;
  balance: number | null;
  skip: SeatSkip | null;
  windows: RoutableWindow[];
};

export type SeatsDecision = { trip: number; seats: Seat[]; accounts: SeatAccount[] };

type SeatContext = {
  lines: RouteLines;
  usages: RoutableUsage[];
  request: SeatsRequest;
  swarm: SwarmSettings;
  trip: number;
  excluded: string[];
  ineligible: string[];
  limits: Limits;
  tonight: Tonight;
};

type Facts = {
  id: string;
  usage: RoutableUsage | undefined;
  windows: RoutableWindow[];
  command: string;
  cap: number;
  burn: number;
  reported: RoutableWindow[];
  binding: number | null;
  evaporation: number | undefined;
  ranks: ChainEntry[];
};

type Seatable = Facts & { skip: SeatSkip | null; allowed: number };

type Allocation = { given: Map<string, number>; turns: Map<string, number>; seats: Seat[] };

function wholePercent(value: number): string {
  return `${Math.round(value)}%`;
}

function countOf(counts: Counts, id: string): number {
  return Number(counts[id] ?? counts[DEFAULT_KEY]);
}

function capOf(id: string, { request, swarm }: SeatContext): number {
  return request.cap[id] ?? countOf(swarm.cap, id);
}

function routedWindows(id: string, usage: RoutableUsage | undefined): RoutableWindow[] {
  return isRoutable(usage) ? onRoute(id, usage.windows) : [];
}

function bindingOf(windows: RoutableWindow[]): number | null {
  return windows.length === 0 ? null : bindingLeft(windows);
}

function evaporationOf(candidate: Candidate, tonight: Tonight): number | undefined {
  if (!(bindingLeft(sharedWindows(candidate)) > 0)) return undefined;
  const lefts = evaporatingOf(candidate, tonight).map((chosen) => chosen.left);
  return lefts.length === 0 ? undefined : Math.max(...lefts);
}

function isRankOpen(entry: ChainEntry, usage: RoutableUsage, trip: number): boolean {
  return entry.providers.includes(usage.id) && highestUsed(gatingWindows(entry, usage)) < trip;
}

function ranksOf(usage: RoutableUsage | undefined, trip: number): ChainEntry[] {
  return isRoutable(usage) ? HIGH_CHAIN.filter((entry) => isRankOpen(entry, usage, trip)) : [];
}

function factsOf(id: string, ctx: SeatContext): Facts {
  const usage = ctx.usages.find((each) => each.id === id);
  const windows = routedWindows(id, usage);
  return {
    id,
    usage,
    windows,
    command: COMMANDS[id],
    reported: usage?.windows ?? [],
    cap: capOf(id, ctx),
    burn: countOf(ctx.swarm.burnPerSeatHour, id),
    binding: bindingOf(windows),
    evaporation: evaporationOf({ id, windows }, ctx.tonight),
    ranks: ranksOf(usage, ctx.trip)
  };
}

function skipped(reason: SkipReason, text: string): SeatSkip {
  return { reason, text };
}

function heldText(held: Tripped, text: string): string {
  return `${text} at ${wholePercent(held.usedPct)}`;
}

function backOf(reason: SkipReason, held: Tripped, text: string): SeatSkip {
  return held.backAt === undefined ? skipped(reason, text) : { reason, text, backAt: held.backAt };
}

function excludedSkip({ id }: Facts, { excluded }: SeatContext): SeatSkip | undefined {
  return excluded.includes(id) ? skipped('excluded', 'excluded') : undefined;
}

function ineligibleSkip({ id }: Facts, { ineligible }: SeatContext): SeatSkip | undefined {
  return ineligible.includes(id) ? skipped('ineligible', 'routing off') : undefined;
}

function isUnavailable({ id, usage, windows }: Facts): boolean {
  return id === 'kilo' ? usage?.status !== 'ok' : windows.length === 0;
}

function unavailableSkip(facts: Facts): SeatSkip | undefined {
  if (!isUnavailable(facts)) return undefined;
  return skipped('unavailable', facts.usage?.status === 'ok' ? 'no usage windows' : 'unavailable');
}

function limitedSkip({ id, windows }: Facts, { limits, tonight }: SeatContext): SeatSkip | undefined {
  const limit = limits[id] ?? Infinity;
  const [held] = heldBack(id, windowsAtLimit({ id, windows }, limit), tonight.nowMs);
  return held === undefined ? undefined : backOf('limited', held, `${heldText(held, 'limited')} (limit ${limit}%)`);
}

function swarmTripping(windows: RoutableWindow[], trip: number): RoutableWindow[] {
  return windows.filter((window) => window.kind === 'rolling' && window.usedPct >= trip).sort(mostUsedFirst);
}

function trippedSkip({ id, windows }: Facts, { trip, tonight }: SeatContext): SeatSkip | undefined {
  const [held] = heldBack(id, swarmTripping(windows, trip), tonight.nowMs);
  return held === undefined ? undefined : backOf('tripped', held, heldText(held, 'tripped'));
}

function headlessSkip({ command }: Facts, { swarm }: SeatContext): SeatSkip | undefined {
  return Object.hasOwn(swarm.headless, command) ? undefined : skipped('no-headless', `no headless template for ${command}`);
}

function chainText(id: string, trip: number): string {
  return HIGH_CHAIN.some((entry) => entry.providers.includes(id)) ? `no --high rank under ${trip}%` : 'not in the --high chain';
}

function chainSkip({ id, ranks }: Facts, { request, trip }: SeatContext): SeatSkip | undefined {
  return request.mode === 'spread' && ranks.length === 0 ? skipped('not-in-chain', chainText(id, trip)) : undefined;
}

function seatsUnder(facts: Facts, minLeft: number): number {
  const binding = Number(facts.binding);
  return Array.from({ length: facts.cap }, (_, index) => index + 1).filter((count) => binding - count * facts.burn >= minLeft).length;
}

function allowedOf(facts: Facts, { swarm }: SeatContext): number {
  return facts.id === 'kilo' ? facts.cap : seatsUnder(facts, swarm.minLeft);
}

function spentText(facts: Facts, { swarm }: SeatContext): string {
  if (facts.cap === 0) return 'cap 0';
  return `spent: ${wholePercent(Number(facts.binding))} left, one seat needs ${wholePercent(facts.burn + swarm.minLeft)}`;
}

function spentSkip(facts: Facts, ctx: SeatContext): SeatSkip | undefined {
  return allowedOf(facts, ctx) === 0 ? skipped('spent', spentText(facts, ctx)) : undefined;
}

function balanceText({ usages }: SeatContext): string {
  const balance = kiloBalance(usages);
  return balance === undefined ? 'balance unavailable' : `balance ${balance.currency}${balance.amount.toFixed(2)}, needs above $${KILO_MINIMUM_BALANCE.toFixed(2)}`;
}

function balanceSkip({ id }: Facts, ctx: SeatContext): SeatSkip | undefined {
  return id !== 'kilo' || usableKilo(ctx.usages) ? undefined : skipped('balance', balanceText(ctx));
}

const SKIP_RULES: ((facts: Facts, ctx: SeatContext) => SeatSkip | undefined)[] = [
  excludedSkip,
  ineligibleSkip,
  unavailableSkip,
  limitedSkip,
  trippedSkip,
  headlessSkip,
  chainSkip,
  spentSkip,
  balanceSkip
];

function seatableOf(facts: Facts, ctx: SeatContext): Seatable {
  const skip = SKIP_RULES.reduce<SeatSkip | undefined>((found, rule) => found ?? rule(facts, ctx), undefined) ?? null;
  return { ...facts, skip, allowed: skip === null ? allowedOf(facts, ctx) : 0 };
}

function labOf(lab: Record<string, string>, model: string): string {
  const [prefix] = Object.keys(lab).filter((each) => model.slice(0, each.length) === each).sort((a, b) => b.length - a.length);
  return prefix === undefined ? 'unknown' : lab[prefix];
}

function rankFields(rank: ChainEntry | undefined): { rank: number | null; rankName: string | null } {
  return rank === undefined ? { rank: null, rankName: null } : { rank: rank.rank, rankName: rank.name };
}

type SeatChoice = { account: Seatable; kind: SeatKind; rank?: ChainEntry };

type RankChoice = SeatChoice & { rank: ChainEntry };

function lineOf({ account, kind, rank }: SeatChoice, lines: RouteLines): string {
  if (rank !== undefined) return lines.high[rank.name];
  return kind === 'evaporating' ? lines.route[account.id].max : lines.route[account.id].standard;
}

function seatOf(choice: SeatChoice, ctx: SeatContext, held: boolean): Seat {
  const line = lineOf(choice, ctx.lines);
  const [model, effort] = line.split(' ');
  const { id, command } = choice.account;
  return { account: id, line: onAccount(line, id), model, effort: effort ?? null, command, lab: labOf(ctx.swarm.lab, model), kind: choice.kind, ...rankFields(choice.rank), held };
}

function givenTo(allocation: Allocation, id: string): number {
  return allocation.given.get(id) ?? 0;
}

function hasRoom(account: Seatable, allocation: Allocation): boolean {
  return givenTo(allocation, account.id) < account.allowed;
}

function nextScore(account: Seatable, seats: number): number {
  return account.binding === null ? -Infinity : account.binding - (seats + 1) * account.burn;
}

function give(allocation: Allocation, choice: SeatChoice, ctx: SeatContext, held: boolean): void {
  allocation.given.set(choice.account.id, givenTo(allocation, choice.account.id) + 1);
  allocation.seats.push(seatOf(choice, ctx, held));
}

function bestBy<T>(items: T[], score: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((best, item) => (best === undefined || score(item) > score(best) ? item : best), undefined);
}

function packKind(account: Seatable): SeatKind {
  if (account.id === 'kilo') return 'balance';
  return account.evaporation === undefined ? 'headroom' : 'evaporating';
}

function withRoom(accounts: Seatable[], allocation: Allocation): Seatable[] {
  return accounts.filter((account) => hasRoom(account, allocation));
}

function evaporatingChoice(open: Seatable[]): SeatChoice | undefined {
  const account = bestBy(open.filter((each) => each.evaporation !== undefined), (each) => Number(each.evaporation));
  return account === undefined ? undefined : { account, kind: 'evaporating' };
}

function packHeadroomChoice(open: Seatable[], allocation: Allocation): SeatChoice | undefined {
  const account = bestBy(open.filter((each) => each.id !== 'kilo'), (each) => nextScore(each, givenTo(allocation, each.id)));
  return account === undefined ? undefined : { account, kind: 'headroom' };
}

function kiloChoice(open: Seatable[]): SeatChoice | undefined {
  const account = open.find((each) => each.id === 'kilo');
  return account === undefined ? undefined : { account, kind: 'balance' };
}

function nextPackSeat(accounts: Seatable[], allocation: Allocation): SeatChoice | undefined {
  const open = withRoom(accounts, allocation);
  return evaporatingChoice(open) ?? packHeadroomChoice(open, allocation) ?? kiloChoice(open);
}

function turnsOf(allocation: Allocation, entry: ChainEntry): number {
  return allocation.turns.get(entry.name) ?? 0;
}

function rankChoice(entry: ChainEntry, open: Seatable[], allocation: Allocation): RankChoice | undefined {
  const account = bestBy(open.filter((each) => each.ranks.includes(entry)), (each) => nextScore(each, givenTo(allocation, each.id)));
  return account === undefined ? undefined : { account, kind: 'chain', rank: entry };
}

function nextSpreadSeat(accounts: Seatable[], allocation: Allocation): SeatChoice | undefined {
  const open = withRoom(accounts, allocation);
  const choices = HIGH_CHAIN.flatMap((entry) => rankChoice(entry, open, allocation) ?? []);
  return bestBy(choices, (choice) => -turnsOf(allocation, choice.rank));
}

function countTurn(allocation: Allocation, choice: SeatChoice): void {
  if (choice.rank !== undefined) allocation.turns.set(choice.rank.name, turnsOf(allocation, choice.rank) + 1);
}

function keptChoice(account: Seatable, mode: SeatsMode): SeatChoice {
  return mode === 'spread' ? { account, kind: 'chain', rank: account.ranks[0] } : { account, kind: packKind(account) };
}

function heldOn(held: Counts, id: string): number {
  return held[id] ?? 0;
}

function keptCounts(accounts: Seatable[], held: Counts): Map<string, number> {
  return new Map(accounts.map((account) => [account.id, Math.min(heldOn(held, account.id), account.allowed)]));
}

function lastKeptScore(account: Seatable, kept: Map<string, number>): number {
  return -nextScore(account, Number(kept.get(account.id)) - 1);
}

function trimKept(accounts: Seatable[], kept: Map<string, number>, requested: number): Map<string, number> {
  for (let total = [...kept.values()].reduce((sum, count) => sum + count, 0); total > requested; total -= 1) {
    const victim = bestBy([...accounts].reverse().filter((account) => Number(kept.get(account.id)) > 0), (account) => lastKeptScore(account, kept)) as Seatable;
    kept.set(victim.id, Number(kept.get(victim.id)) - 1);
  }
  return kept;
}

function keepHeld(accounts: Seatable[], allocation: Allocation, ctx: SeatContext): void {
  const kept = trimKept(accounts, keptCounts(accounts, ctx.request.held), ctx.request.requested);
  for (const account of accounts) {
    for (let count = 0; count < Number(kept.get(account.id)); count += 1) {
      const choice = keptChoice(account, ctx.request.mode);
      give(allocation, choice, ctx, true);
      countTurn(allocation, choice);
    }
  }
}

function allocate(accounts: Seatable[], ctx: SeatContext): Allocation {
  const allocation: Allocation = { given: new Map(), turns: new Map(), seats: [] };
  keepHeld(accounts, allocation, ctx);
  const next = ctx.request.mode === 'spread' ? nextSpreadSeat : nextPackSeat;
  for (let choice = next(accounts, allocation); choice !== undefined && allocation.seats.length < ctx.request.requested; choice = next(accounts, allocation)) {
    give(allocation, choice, ctx, false);
    countTurn(allocation, choice);
  }
  return allocation;
}

function dollarsOf(usages: RoutableUsage[], id: string): number | null {
  const balance = id === 'kilo' ? kiloBalance(usages) : undefined;
  return balance?.currency === '$' ? balance.amount : null;
}

function accountOf(account: Seatable, allocation: Allocation, ctx: SeatContext): SeatAccount {
  return {
    id: account.id,
    command: account.command,
    cap: account.cap,
    held: heldOn(ctx.request.held, account.id),
    target: givenTo(allocation, account.id),
    score: account.binding,
    evaporating: account.evaporation !== undefined,
    balance: dollarsOf(ctx.usages, account.id),
    skip: account.skip,
    windows: account.reported
  };
}

function excludedOf(swarm: SwarmSettings, request: SeatsRequest): string[] {
  return [...swarm.exclude, ...request.exclude].filter((id) => !request.include.includes(id));
}

function seatContext(lines: RouteLines, usages: RoutableUsage[], request: SeatsRequest, ineligible: string[], tonight: Tonight): SeatContext {
  const swarm = swarmOf(lines);
  return { lines, usages, request, swarm, trip: request.trip ?? swarm.trip, excluded: excludedOf(swarm, request), ineligible, limits: limitsOf(lines), tonight };
}

export function seatsDecision(lines: RouteLines, usages: RoutableUsage[], request: SeatsRequest, ineligible: string[], now: string, midnight: string): SeatsDecision {
  const ctx = seatContext(lines, usages, request, ineligible, { nowMs: Date.parse(now), midnightMs: Date.parse(midnight) });
  const accounts = ROUTED_IDS.map((id) => seatableOf(factsOf(id, ctx), ctx));
  const allocation = allocate(accounts, ctx);
  return { trip: ctx.trip, seats: allocation.seats, accounts: accounts.map((account) => accountOf(account, allocation, ctx)) };
}

type Leaf = 'line' | 'limit' | 'swarm' | 'lab' | 'headless' | 'trip' | 'minLeft' | 'ids' | 'caps' | 'cap' | 'burns' | 'burn' | 'template' | 'args' | 'flag';

type Shape = Leaf | { readonly [key: string]: Shape };

const OPTIONAL = new Set<Shape>(['limit', 'swarm', 'lab', 'headless', 'trip', 'minLeft', 'ids', 'caps', 'cap', 'burns', 'burn', 'template']);

function keyed(keys: readonly string[], shape: Shape): Record<string, Shape> {
  return Object.fromEntries(keys.map((key) => [key, shape]));
}

function routesShape(): Shape {
  return {
    route: { ...keyed(WINDOWED_IDS, { standard: 'line', max: 'line', limit: 'limit' }), kilo: { standard: 'line', max: 'line' } },
    high: keyed(HIGH_CHAIN.map((entry) => entry.name), 'line'),
    swarm: 'swarm',
    lab: 'lab',
    headless: 'headless'
  };
}

const SWARM_SHAPE: Record<string, Shape> = { trip: 'trip', minLeft: 'minLeft', exclude: 'ids', cap: 'caps', burnPerSeatHour: 'burns' };

const TEMPLATE_SHAPE: Record<string, Shape> = { before: 'args', after: 'args', stdin: 'flag' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function keyPath(at: string, key: string): string {
  return at === '' ? key : `${at}.${key}`;
}

function lineProblem(value: unknown, at: string): string | undefined {
  if (typeof value !== 'string' || value === '') return `${at} is not a non-empty string`;
  return /^\S+( \S+)?$/.test(value) ? undefined : `${at} is not "<model>" or "<model> <effort>"`;
}

function isWholeIn(value: unknown, low: number, high: number): boolean {
  return Number.isInteger(value) && Number(value) >= low && Number(value) <= high;
}

function isNumberIn(value: unknown, low: number, high: number): boolean {
  return Number.isFinite(value) && Number(value) >= low && Number(value) <= high;
}

function limitProblem(value: unknown, at: string): string | undefined {
  return isWholeIn(value, 1, FULL_LEFT) ? undefined : `${at} is not a whole percent from 1 to 100`;
}

function tripProblem(value: unknown, at: string): string | undefined {
  return isWholeIn(value, MIN_SWARM_TRIP, TRIP_PCT) ? undefined : `${at} is not a whole percent from ${MIN_SWARM_TRIP} to ${TRIP_PCT}`;
}

function percentProblem(value: unknown, at: string): string | undefined {
  return isNumberIn(value, 0, FULL_LEFT) ? undefined : `${at} is not a number from 0 to 100`;
}

function capProblem(value: unknown, at: string): string | undefined {
  return isWholeIn(value, 0, MAX_CAP) ? undefined : `${at} is not a whole number from 0 to ${MAX_CAP}`;
}

function isListOf(value: unknown, isItem: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(isItem);
}

function isAccountId(item: unknown): boolean {
  return typeof item === 'string' && ROUTED_IDS.includes(item);
}

function idsProblem(value: unknown, at: string): string | undefined {
  return isListOf(value, isAccountId) ? undefined : `${at} is not a list of account ids`;
}

function argsProblem(value: unknown, at: string): string | undefined {
  return isListOf(value, (item) => typeof item === 'string') ? undefined : `${at} is not a list of strings`;
}

function flagProblem(value: unknown, at: string): string | undefined {
  return typeof value === 'boolean' ? undefined : `${at} is not true or false`;
}

function labEntryProblem([prefix, name]: [string, unknown], at: string): string | undefined {
  if (prefix === '') return `${at} has an empty model prefix`;
  return typeof name === 'string' && /^[a-z0-9-]+$/.test(name) ? undefined : `${keyPath(at, prefix)} is not a lab name of a-z, 0-9 and -`;
}

function labProblem(value: unknown, at: string): string | undefined {
  if (!isPlainObject(value)) return `${at} is not a JSON object`;
  return Object.entries(value).map((entry) => labEntryProblem(entry, at)).find((problem) => problem !== undefined);
}

function unknownKeyProblem(value: Record<string, unknown>, shape: Record<string, Shape>, at: string): string | undefined {
  const unknown = Object.keys(value).find((key) => !Object.hasOwn(shape, key));
  return unknown === undefined ? undefined : `unknown key ${keyPath(at, unknown)}`;
}

function keyProblem(value: Record<string, unknown>, key: string, shape: Shape, at: string): string | undefined {
  const path = keyPath(at, key);
  if (Object.hasOwn(value, key)) return problemIn(value[key], shape, path);
  return OPTIONAL.has(shape) ? undefined : `${path} is missing`;
}

function childProblem(value: Record<string, unknown>, shape: Record<string, Shape>, at: string): string | undefined {
  return Object.entries(shape).map(([key, child]) => keyProblem(value, key, child, at)).find((problem) => problem !== undefined);
}

function objectProblem(value: unknown, shape: Record<string, Shape>, at: string): string | undefined {
  if (!isPlainObject(value)) return `${at || 'the file'} is not a JSON object`;
  return unknownKeyProblem(value, shape, at) ?? childProblem(value, shape, at);
}

function sectionOf(shape: Record<string, Shape>): (value: unknown, at: string) => string | undefined {
  return (value, at) => objectProblem(value, shape, at);
}

const LEAF_PROBLEMS: Record<Leaf, (value: unknown, at: string) => string | undefined> = {
  line: lineProblem,
  limit: limitProblem,
  swarm: sectionOf(SWARM_SHAPE),
  lab: labProblem,
  headless: sectionOf(keyed(HEADLESS_COMMANDS, 'template')),
  trip: tripProblem,
  minLeft: percentProblem,
  ids: idsProblem,
  caps: sectionOf(keyed([...ROUTED_IDS, DEFAULT_KEY], 'cap')),
  cap: capProblem,
  burns: sectionOf(keyed([...ROUTED_IDS, DEFAULT_KEY], 'burn')),
  burn: percentProblem,
  template: sectionOf(TEMPLATE_SHAPE),
  args: argsProblem,
  flag: flagProblem
};

function problemIn(value: unknown, shape: Shape, at: string): string | undefined {
  return typeof shape === 'string' ? LEAF_PROBLEMS[shape](value, at) : objectProblem(value, shape, at);
}

function attempted<T>(action: () => T, fault: RoutesFault): { value: T } | { fault: RoutesFault } {
  try {
    return { value: action() };
  } catch {
    return { fault };
  }
}

function routesIn(text: string, path: string): Routes {
  const json = attempted((): unknown => JSON.parse(text), { path, problem: 'is not valid JSON' });
  if ('fault' in json) return json;
  const problem = problemIn(json.value, routesShape(), '');
  return problem === undefined ? { lines: json.value as RouteLines } : { fault: { path, problem } };
}

export function openRoutes(env: Record<string, string | undefined>, shippedPath: string, file: RoutesFile): Routes {
  const path = env['DANDELION_ROUTES_FILE'] || shippedPath;
  const text = attempted(() => file.read(path), { path, problem: 'cannot be read' });
  return 'fault' in text ? text : routesIn(text.value, path);
}
