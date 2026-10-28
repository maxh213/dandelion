export type WindowKind = 'rolling' | 'weekly' | 'other';

type RoutableWindow = { label: string; kind: WindowKind; usedPct: number; resetsAt?: string };

type RoutableUsage = { id: string; status: string; windows: RoutableWindow[]; balance?: { amount: number; currency: string } };

type RouteEntry = { standard: string; max: string; limit?: number };

export type RouteLines = { route: Record<string, RouteEntry>; high: Record<string, string> };

export type Limits = Partial<Record<string, number>>;

export type RoutesFault = { path: string; problem: string };

export type Routes = { lines: RouteLines; fault?: undefined } | { lines?: undefined; fault: RoutesFault };

export interface RoutesFile {
  read(path: string): string;
}

const ROUTED_IDS = ['claude', 'claude-work', 'claude-animus', 'claude-deepseek', 'claude-ollama', 'agy', 'kimi', 'grok', 'codex', 'codex-animus', 'cursor', 'junie', 'hermes', 'kilo'];
const WINDOWED_IDS = ROUTED_IDS.filter((id) => id !== 'kilo');
export const NO_ROUTE = 'none';
const UNTOUCHED_LEFT = 97;
const FULL_LEFT = 100;
const TRIP_PCT = 90;
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

type Shape = 'line' | 'limit' | { readonly [key: string]: Shape };

function keyed(keys: readonly string[], shape: Shape): Record<string, Shape> {
  return Object.fromEntries(keys.map((key) => [key, shape]));
}

function routesShape(): Shape {
  return {
    route: { ...keyed(WINDOWED_IDS, { standard: 'line', max: 'line', limit: 'limit' }), kilo: { standard: 'line', max: 'line' } },
    high: keyed(HIGH_CHAIN.map((entry) => entry.name), 'line')
  };
}

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

function isWholePercent(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= FULL_LEFT;
}

function limitProblem(value: unknown, at: string): string | undefined {
  return isWholePercent(value) ? undefined : `${at} is not a whole percent from 1 to 100`;
}

function unknownKeyProblem(value: Record<string, unknown>, shape: Record<string, Shape>, at: string): string | undefined {
  const unknown = Object.keys(value).find((key) => !Object.hasOwn(shape, key));
  return unknown === undefined ? undefined : `unknown key ${keyPath(at, unknown)}`;
}

function keyProblem(value: Record<string, unknown>, key: string, shape: Shape, at: string): string | undefined {
  const path = keyPath(at, key);
  if (Object.hasOwn(value, key)) return problemIn(value[key], shape, path);
  return shape === 'limit' ? undefined : `${path} is missing`;
}

function childProblem(value: Record<string, unknown>, shape: Record<string, Shape>, at: string): string | undefined {
  return Object.entries(shape).map(([key, child]) => keyProblem(value, key, child, at)).find((problem) => problem !== undefined);
}

function objectProblem(value: unknown, shape: Record<string, Shape>, at: string): string | undefined {
  if (!isPlainObject(value)) return `${at || 'the file'} is not a JSON object`;
  return unknownKeyProblem(value, shape, at) ?? childProblem(value, shape, at);
}

const LEAF_PROBLEMS = { line: lineProblem, limit: limitProblem };

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
