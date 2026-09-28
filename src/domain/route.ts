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

const ROUTED_IDS = ['claude', 'claude-work', 'agy', 'kimi', 'grok', 'cursor', 'junie', 'hermes'];
export const NO_ROUTE = 'none';
const UNTOUCHED_LEFT = 97;
const FULL_LEFT = 100;
const TRIP_PCT = 90;

type Candidate = { id: string; windows: RoutableWindow[] };

type Pick = { id: string | undefined; score: number };

type Tonight = { nowMs: number; midnightMs: number };

export function isRoutable(usage: RoutableUsage | undefined): usage is RoutableUsage {
  return usage?.status === 'ok' && usage.windows.length > 0;
}

function eligibleUsages(usages: RoutableUsage[], ineligible: string[]): RoutableUsage[] {
  return usages.filter((usage) => !ineligible.includes(usage.id));
}

function trips(usedPct: number): boolean {
  return usedPct >= TRIP_PCT;
}

function onAccount(line: string, id: string): string {
  return `${line} ${id}`;
}

function candidatesOf(usages: RoutableUsage[]): Candidate[] {
  return ROUTED_IDS.flatMap((id) => {
    const usage = usages.find((each) => each.id === id);
    return isRoutable(usage) ? [{ id, windows: usage.windows }] : [];
  });
}

function isUntripped({ windows }: Candidate): boolean {
  return !windows.some((window) => window.kind === 'rolling' && trips(window.usedPct));
}

function leftOf(window: RoutableWindow): number {
  return FULL_LEFT - window.usedPct;
}

function resetsTonight(window: RoutableWindow, tonight: Tonight): boolean {
  const resetMs = Date.parse(String(window.resetsAt));
  return resetMs > tonight.nowMs && resetMs < tonight.midnightMs;
}

function evaporates(window: RoutableWindow, tonight: Tonight): boolean {
  return window.kind === 'weekly' && leftOf(window) < UNTOUCHED_LEFT && resetsTonight(window, tonight);
}

function evaporationScore(windows: RoutableWindow[], tonight: Tonight): number {
  return Math.max(-Infinity, ...windows.filter((window) => evaporates(window, tonight)).map(leftOf));
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

export function routeLine(lines: RouteLines, usages: RoutableUsage[], now: string, midnight: string, ineligible: string[]): string {
  const candidates = candidatesOf(eligibleUsages(usages, ineligible)).filter(isUntripped);
  const tonight = { nowMs: Date.parse(now), midnightMs: Date.parse(midnight) };
  const evaporating = highest(candidates, (windows) => evaporationScore(windows, tonight)).id;
  if (evaporating !== undefined) return onAccount(lines.route[evaporating].max, evaporating);
  const roomiest = highest(candidates, bindingLeft).id;
  return roomiest === undefined ? NO_ROUTE : onAccount(lines.route[roomiest].standard, roomiest);
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

function entryLine(lines: RouteLines, entry: ChainEntry, usages: RoutableUsage[]): string | undefined {
  const [leastUsed] = openAccounts(entry, usages).sort((a, b) => a.used - b.used);
  return leastUsed === undefined ? undefined : onAccount(lines.high[entry.name], leastUsed.id);
}

export function highRouteLine(lines: RouteLines, usages: RoutableUsage[], ineligible: string[]): string {
  const eligible = eligibleUsages(usages, ineligible);
  return HIGH_CHAIN.map((entry) => entryLine(lines, entry, eligible)).find((line) => line !== undefined) ?? NO_ROUTE;
}

type Shape = 'line' | { readonly [key: string]: Shape };

const LINE_SHAPE = /^\S+( \S+)?$/;

function keyed(keys: readonly string[], shape: Shape): Record<string, Shape> {
  return Object.fromEntries(keys.map((key) => [key, shape]));
}

const ROUTES_SHAPE: Shape = {
  route: keyed(ROUTED_IDS, { standard: 'line', max: 'line' }),
  high: keyed(HIGH_CHAIN.map((entry) => entry.name), 'line')
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function keyPath(at: string, key: string): string {
  return at === '' ? key : `${at}.${key}`;
}

function lineProblem(value: unknown, at: string): string | undefined {
  if (typeof value !== 'string' || value === '') return `${at} is not a non-empty string`;
  return LINE_SHAPE.test(value) ? undefined : `${at} is not "<model>" or "<model> <effort>"`;
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

function attempted<T>(action: () => T): { value: T } | undefined {
  try {
    return { value: action() };
  } catch {
    return undefined;
  }
}

function routesIn(text: string, path: string): Routes {
  const json = attempted((): unknown => JSON.parse(text));
  if (json === undefined) return { fault: { path, problem: 'is not valid JSON' } };
  const problem = problemIn(json.value, ROUTES_SHAPE, '');
  return problem === undefined ? { lines: json.value as RouteLines } : { fault: { path, problem } };
}

export function openRoutes(env: Record<string, string | undefined>, shippedPath: string, file: RoutesFile): Routes {
  const path = env['DANDELION_ROUTES_FILE'] || shippedPath;
  const text = attempted(() => file.read(path));
  return text === undefined ? { fault: { path, problem: 'cannot be read' } } : routesIn(text.value, path);
}

export function faultLine({ path, problem }: RoutesFault): string {
  return `dandelion: routes file ${path}: ${problem}`;
}
