export type WindowKind = 'rolling' | 'weekly' | 'other';

type RoutableWindow = { label: string; kind: WindowKind; usedPct: number; resetsAt?: string };

type RoutableUsage = { id: string; status: string; windows: RoutableWindow[] };

type RuleLines = { standard: string; max: string };

export type RouteLines = { route: Record<string, RuleLines>; high: Record<string, string> };

export type RoutesFault = { path: string; problem: string };

export type Routes = { lines: RouteLines; fault?: undefined } | { lines?: undefined; fault: RoutesFault };

export interface RoutesFile {
  read(path: string): string;
}

const ROUTED_IDS = ['claude', 'claude-work', 'claude-deepseek', 'agy', 'kimi', 'grok', 'cursor', 'junie', 'hermes'];
export const NO_ROUTE = 'none';
const UNTOUCHED_LEFT = 97;
const FULL_LEFT = 100;
const TRIP_PCT = 90;
const OFF_ROUTE_LABELS: Record<string, readonly string[]> = { cursor: ['api'] };

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
  return ROUTED_IDS.flatMap((id) => {
    const usage = usages.find((each) => each.id === id);
    const windows = isRoutable(usage) ? onRoute(id, usage.windows) : [];
    return windows.length > 0 ? [{ id, windows }] : [];
  });
}

function trippingWindow({ windows }: Candidate): RoutableWindow | undefined {
  return windows.filter((window) => window.kind === 'rolling' && trips(window.usedPct)).sort((a, b) => b.usedPct - a.usedPct)[0];
}

function isUntripped(candidate: Candidate): boolean {
  return trippingWindow(candidate) === undefined;
}

function leftOf(window: RoutableWindow): number {
  return FULL_LEFT - window.usedPct;
}

function resetsTonight(window: RoutableWindow, tonight: Tonight): boolean {
  const resetMs = Date.parse(String(window.resetsAt));
  return resetMs > tonight.nowMs && resetMs < tonight.midnightMs;
}

export function evaporates(window: RoutableWindow, tonight: Tonight): boolean {
  return window.kind === 'weekly' && leftOf(window) < UNTOUCHED_LEFT && resetsTonight(window, tonight);
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

type Tripped = { id: string; label: string; usedPct: number };

export type Skipped = { tripped: Tripped[]; ineligible: string[]; unavailable: string[] };

type Chosen = { rule: 'evaporation' | 'headroom'; id: string; left: number; label?: string; resetsAt?: string };

type Rival = { id: string; left: number };

export type RouteDecision = { chosen: Chosen | undefined; rivals: Rival[]; skipped: Skipped };

function trippedOf(candidates: Candidate[]): Tripped[] {
  return candidates.flatMap((candidate) => {
    const window = trippingWindow(candidate);
    return window === undefined ? [] : [{ id: candidate.id, label: window.label, usedPct: window.usedPct }];
  });
}

function skippedOf(all: Candidate[], ineligible: string[]): Skipped {
  return {
    tripped: trippedOf(all),
    ineligible: ROUTED_IDS.filter((id) => ineligible.indexOf(id) !== -1),
    unavailable: ROUTED_IDS.filter((id) => !ineligible.includes(id) && !all.some((candidate) => candidate.id === id))
  };
}

function evaporatingOf({ id, windows }: Candidate, tonight: Tonight): Chosen[] {
  return windows
    .filter((window) => evaporates(window, tonight))
    .map((window) => ({ rule: 'evaporation', id, left: leftOf(window), label: window.label, resetsAt: String(window.resetsAt) }));
}

function evaporationChoice(candidates: Candidate[], tonight: Tonight): Chosen | undefined {
  return candidates
    .flatMap((candidate) => evaporatingOf(candidate, tonight))
    .reduce<Chosen | undefined>((best, each) => (best === undefined || each.left > best.left ? each : best), undefined);
}

function headroomChoice(candidates: Candidate[]): Chosen | undefined {
  const { id, score } = highest(candidates, bindingLeft);
  return id === undefined ? undefined : { rule: 'headroom', id, left: score };
}

function rivalsOf(candidates: Candidate[], chosen: Chosen | undefined): Rival[] {
  if (chosen?.rule !== 'headroom') return [];
  return candidates.filter(({ id }) => id !== chosen.id).map(({ id, windows }) => ({ id, left: bindingLeft(windows) }));
}

export function routeDecision(usages: RoutableUsage[], now: string, midnight: string, ineligible: string[]): RouteDecision {
  const all = candidatesOf(eligibleUsages(usages, ineligible));
  const candidates = all.filter(isUntripped);
  const tonight = { nowMs: Date.parse(now), midnightMs: Date.parse(midnight) };
  const chosen = evaporationChoice(candidates, tonight) ?? headroomChoice(candidates);
  return { chosen, rivals: rivalsOf(candidates, chosen), skipped: skippedOf(all, ineligible) };
}

export function routeDecisionLine(lines: RouteLines, { chosen }: RouteDecision): string {
  if (chosen === undefined) return NO_ROUTE;
  const rule = lines.route[chosen.id];
  return onAccount(chosen.rule === 'evaporation' ? rule.max : rule.standard, chosen.id);
}

export function routeLine(lines: RouteLines, usages: RoutableUsage[], now: string, midnight: string, ineligible: string[]): string {
  return routeDecisionLine(lines, routeDecision(usages, now, midnight, ineligible));
}

type ChainEntry = { rank: number; name: string; providers: readonly string[]; matcher?: string };

export const HIGH_CHAIN: readonly ChainEntry[] = [
  { rank: 1, name: 'fable', providers: ['claude', 'claude-work'], matcher: 'fable' },
  { rank: 2, name: 'cursor', providers: ['cursor'] },
  { rank: 3, name: 'opus', providers: ['claude', 'claude-work'] },
  { rank: 4, name: 'grok', providers: ['grok'] },
  { rank: 5, name: 'agy', providers: ['agy'] }
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

export type HighDecision = { winner: ChainWin | undefined; skipped: ChainSkip[] };

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

export function highDecision(usages: RoutableUsage[], ineligible: string[]): HighDecision {
  const eligible = eligibleUsages(usages, ineligible);
  const skipped: ChainSkip[] = [];
  for (const entry of HIGH_CHAIN) {
    const open = leastUsedOpen(entry, eligible);
    if (open !== undefined) return { winner: { rank: entry.rank, name: entry.name, id: open.id, usedPct: open.used }, skipped };
    skipped.push(skipOf(entry, eligible));
  }
  return { winner: undefined, skipped };
}

export function highDecisionLine(lines: RouteLines, { winner }: HighDecision): string {
  return winner === undefined ? NO_ROUTE : onAccount(lines.high[winner.name], winner.id);
}

export function highRouteLine(lines: RouteLines, usages: RoutableUsage[], ineligible: string[]): string {
  return highDecisionLine(lines, highDecision(usages, ineligible));
}

type Shape = 'line' | { readonly [key: string]: Shape };

function keyed(keys: readonly string[], shape: Shape): Record<string, Shape> {
  return Object.fromEntries(keys.map((key) => [key, shape]));
}

function routesShape(): Shape {
  return {
    route: keyed(ROUTED_IDS, { standard: 'line', max: 'line' }),
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

function unknownKeyProblem(value: Record<string, unknown>, shape: Record<string, Shape>, at: string): string | undefined {
  const unknown = Object.keys(value).find((key) => !Object.hasOwn(shape, key));
  return unknown === undefined ? undefined : `unknown key ${keyPath(at, unknown)}`;
}

function keyProblem(value: Record<string, unknown>, key: string, shape: Shape, at: string): string | undefined {
  const path = keyPath(at, key);
  return Object.hasOwn(value, key) ? problemIn(value[key], shape, path) : `${path} is missing`;
}

function childProblem(value: Record<string, unknown>, shape: Record<string, Shape>, at: string): string | undefined {
  return Object.entries(shape).map(([key, child]) => keyProblem(value, key, child, at)).find((problem) => problem !== undefined);
}

function objectProblem(value: unknown, shape: Record<string, Shape>, at: string): string | undefined {
  if (!isPlainObject(value)) return `${at || 'the file'} is not a JSON object`;
  return unknownKeyProblem(value, shape, at) ?? childProblem(value, shape, at);
}

function problemIn(value: unknown, shape: Shape, at: string): string | undefined {
  return shape === 'line' ? lineProblem(value, at) : objectProblem(value, shape, at);
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
