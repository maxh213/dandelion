export type WindowKind = 'rolling' | 'weekly' | 'other';

type RoutableWindow = { kind: WindowKind; usedPct: number; resetsAt?: string };

type RoutableUsage = { id: string; status: string; windows: RoutableWindow[] };

type Route = { id: string; standard: string; max: string };

const CLAUDE_LINES = { standard: 'claude-opus-5 high', max: 'claude-opus-5 max' };
const ROUTING_TABLE: Route[] = [
  { id: 'claude', ...CLAUDE_LINES },
  { id: 'claude-work', ...CLAUDE_LINES },
  { id: 'agy', standard: 'gemini-3.1-pro-high medium', max: 'gemini-3.1-pro-high high' },
  { id: 'kimi', standard: 'kimi-code/kimi-for-coding-highspeed', max: 'kimi-code/kimi-for-coding-highspeed' },
  { id: 'grok', standard: 'grok-4.6', max: 'grok-4.6' },
  { id: 'cursor', standard: 'kimi-k3-max', max: 'kimi-k3-max' }
];
export const NO_ROUTE = 'none';
const UNTOUCHED_LEFT = 97;
const FULL_LEFT = 100;

type Candidate = { route: Route; windows: RoutableWindow[] };

type Pick = { route: Route | undefined; score: number };

type Tonight = { nowMs: number; midnightMs: number };

export function isRoutable(usage: RoutableUsage | undefined): usage is RoutableUsage {
  return usage?.status === 'ok' && usage.windows.length > 0;
}

function eligibleUsages(usages: RoutableUsage[], ineligible: string[]): RoutableUsage[] {
  return usages.filter((usage) => !ineligible.includes(usage.id));
}

function candidatesOf(usages: RoutableUsage[]): Candidate[] {
  return ROUTING_TABLE.flatMap((route) => {
    const usage = usages.find((each) => each.id === route.id);
    return isRoutable(usage) ? [{ route, windows: usage.windows }] : [];
  });
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
  return candidates.reduce<Pick>((best, { route, windows }) => {
    const value = score(windows);
    return value > best.score ? { route, score: value } : best;
  }, { route: undefined, score: -Infinity });
}

export function routeLine(usages: RoutableUsage[], now: string, midnight: string, ineligible: string[]): string {
  const candidates = candidatesOf(eligibleUsages(usages, ineligible));
  const tonight = { nowMs: Date.parse(now), midnightMs: Date.parse(midnight) };
  const evaporating = highest(candidates, (windows) => evaporationScore(windows, tonight));
  if (evaporating.route !== undefined) return evaporating.route.max;
  return highest(candidates, bindingLeft).route?.standard ?? NO_ROUTE;
}

const MIDNIGHT_SEARCH_MS = 48 * 60 * 60 * 1000;
const MIDNIGHT_SEARCH_STEPS = 28;

type Bounds = { before: number; after: number };

function localDateIn(zone: string): (ms: number) => string {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (ms) => format.format(new Date(ms));
}

export function nextLocalMidnight(zone: string, now: string): string {
  const dateAt = localDateIn(zone);
  const nowMs = Date.parse(now);
  const today = dateAt(nowMs);
  const start: Bounds = { before: nowMs, after: nowMs + MIDNIGHT_SEARCH_MS };
  const { after } = Array.from({ length: MIDNIGHT_SEARCH_STEPS }).reduce<Bounds>((bounds) => {
    const middle = Math.floor((bounds.before + bounds.after) / 2);
    return dateAt(middle) === today ? { before: middle, after: bounds.after } : { before: bounds.before, after: middle };
  }, start);
  return new Date(after).toISOString();
}
