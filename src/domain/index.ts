export {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  isSuccess,
  successBody,
  unavailableReason,
  type FetchOutcome,
  type Fetcher,
  type FileReader
} from './ports.ts';

export type WindowKind = 'rolling' | 'weekly' | 'other';

export type UsageWindow = {
  label: string;
  kind: WindowKind;
  usedPct: number;
  resetsAt?: string;
};

export type Balance = {
  amount: number;
  currency: string;
  reference?: number;
};

type ProviderIdentity = {
  id: string;
  displayName: string;
  planLabel?: string;
  windows: UsageWindow[];
  fetchedAt: string;
};

export type ProviderUsage =
  | (ProviderIdentity & { status: 'ok'; balance?: Balance; snapshotAt?: string; note?: string })
  | (ProviderIdentity & { status: 'unavailable' | 'error'; reason: string });

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function isCount(value: unknown): value is number {
  return Number.isFinite(value) && Number(value) >= 0;
}

const DATE_BEFORE_TIME = /\d-\d{2}-\d{2}T/;

export function validInstant(value: unknown): string | undefined {
  return typeof value === 'string' && DATE_BEFORE_TIME.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

export const HOT_PCT = 80;

export type FleetReset = { id: string; label: string; resetsAt: string };

export type FleetSummary = { hot: number; windows: number; next: FleetReset | undefined };

type FleetWindow = UsageWindow & { id: string };

function fleetWindows(usages: ProviderUsage[]): FleetWindow[] {
  return usages.flatMap((usage) => (usage.status === 'ok' ? usage.windows.map((window) => ({ ...window, id: usage.id })) : []));
}

function isFuture(window: FleetWindow, now: string): window is FleetWindow & FleetReset {
  return Date.parse(String(window.resetsAt)) > Date.parse(now);
}

function soonestReset(windows: FleetWindow[], now: string): FleetReset | undefined {
  const future = windows.filter((window) => isFuture(window, now));
  future.sort((a, b) => Date.parse(a.resetsAt) - Date.parse(b.resetsAt));
  return future[0];
}

export function summariseFleet(usages: ProviderUsage[], now: string): FleetSummary {
  const windows = fleetWindows(usages);
  const hot = windows.filter((window) => window.usedPct >= HOT_PCT).length;
  return { hot, windows: windows.length, next: soonestReset(windows, now) };
}

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
const NO_ROUTE = 'none';
const UNTOUCHED_LEFT = 97;
const FULL_LEFT = 100;

type Candidate = { route: Route; windows: UsageWindow[] };

type Pick = { route: Route | undefined; score: number };

type Tonight = { nowMs: number; midnightMs: number };

function isCandidate(usage: ProviderUsage | undefined): usage is ProviderUsage & { status: 'ok' } {
  return usage?.status === 'ok' && usage.windows.length > 0;
}

function candidatesOf(usages: ProviderUsage[]): Candidate[] {
  return ROUTING_TABLE.flatMap((route) => {
    const usage = usages.find((each) => each.id === route.id);
    return isCandidate(usage) ? [{ route, windows: usage.windows }] : [];
  });
}

function leftOf(window: UsageWindow): number {
  return FULL_LEFT - window.usedPct;
}

function resetsTonight(window: UsageWindow, tonight: Tonight): boolean {
  const resetMs = Date.parse(String(window.resetsAt));
  return resetMs > tonight.nowMs && resetMs < tonight.midnightMs;
}

function evaporates(window: UsageWindow, tonight: Tonight): boolean {
  return window.kind === 'weekly' && leftOf(window) < UNTOUCHED_LEFT && resetsTonight(window, tonight);
}

function evaporationScore(windows: UsageWindow[], tonight: Tonight): number {
  return Math.max(-Infinity, ...windows.filter((window) => evaporates(window, tonight)).map(leftOf));
}

function bindingLeft(windows: UsageWindow[]): number {
  return Math.min(FULL_LEFT, ...windows.filter((window) => window.kind !== 'other').map(leftOf));
}

function highest(candidates: Candidate[], score: (windows: UsageWindow[]) => number): Pick {
  return candidates.reduce<Pick>((best, { route, windows }) => {
    const value = score(windows);
    return value > best.score ? { route, score: value } : best;
  }, { route: undefined, score: -Infinity });
}

export function routeLine(usages: ProviderUsage[], now: string, midnight: string): string {
  const candidates = candidatesOf(usages);
  const tonight = { nowMs: Date.parse(now), midnightMs: Date.parse(midnight) };
  const evaporating = highest(candidates, (windows) => evaporationScore(windows, tonight));
  if (evaporating.route !== undefined) return evaporating.route.max;
  return highest(candidates, bindingLeft).route?.standard ?? NO_ROUTE;
}

const MIDNIGHT_SEARCH_MS = 48 * 60 * 60 * 1000;

function localDateIn(zone: string): (ms: number) => string {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (ms) => format.format(new Date(ms));
}

export function nextLocalMidnight(zone: string, now: string): string {
  const dateAt = localDateIn(zone);
  const today = dateAt(Date.parse(now));
  let before = Date.parse(now);
  let after = before + MIDNIGHT_SEARCH_MS;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (dateAt(middle) === today) before = middle;
    else after = middle;
  }
  return new Date(after).toISOString();
}

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export function formatCountdown(resetsAt: string, now: string): string {
  const remainingMs = Math.max(0, new Date(resetsAt).getTime() - new Date(now).getTime());

  const hours = Math.floor(remainingMs / MS_PER_HOUR);
  const minutes = Math.floor((remainingMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d${hours % 24}h`;
  return `${hours}h${minutes}m`;
}
