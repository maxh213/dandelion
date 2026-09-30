import { evaporates, trips, type Tonight, type WindowKind } from './route.ts';

export {
  ProbeUnavailable,
  USAGE_PARSE_FAILURE,
  fieldOf,
  isCount,
  isFilled,
  isRecord,
  isSuccess,
  matchesOnJsonLine,
  newestLineMatch,
  parseJson,
  successBody,
  unavailableReason,
  validInstant,
  type FetchOutcome,
  type Fetcher,
  type FileReader
} from './ports.ts';

export {
  HIGH_CHAIN,
  NO_ROUTE,
  highDecision,
  highDecisionLine,
  highRouteLine,
  isRoutable,
  openRoutes,
  routeDecision,
  routeDecisionLine,
  routeLine,
  type ChainSkip,
  type ChainWin,
  type RouteDecision,
  type RouteLines,
  type Routes,
  type RoutesFault,
  type RoutesFile,
  type Skipped,
  type WindowKind
} from './route.ts';

export { nextLocalMidnight } from './midnight.ts';

export { openEligibility, openHidden, openHistory, type Eligibility, type Hidden, type History, type HistorySample, type StateFile } from './eligibility.ts';

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
  captionSuffix?: string;
  windows: UsageWindow[];
  fetchedAt: string;
};

export type ProviderUsage =
  | (ProviderIdentity & { status: 'ok'; balance?: Balance; snapshotAt?: string; note?: string })
  | (ProviderIdentity & { status: 'unavailable' | 'error'; reason: string });

export function withReset(window: UsageWindow, resetsAt: string | undefined): UsageWindow {
  return resetsAt === undefined ? window : { ...window, resetsAt };
}

const FULL_PCT = 100;

export function usedPctFromRemaining(remaining: number, grant: number): number {
  return Math.min(FULL_PCT, Math.max(0, Math.round(FULL_PCT - (FULL_PCT * remaining) / grant)));
}

export const HOT_PCT = 80;

type FleetReset = { id: string; label: string; resetsAt: string };

type FleetSummary = { hot: number; windows: number; next: FleetReset | undefined };

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

const WEEKDAY_LIMIT_MS = 6 * 24 * MS_PER_HOUR;

function zonedParts(instant: string, zone: string, fields: Intl.DateTimeFormatOptions): Map<string, string> {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', ...fields });
  return new Map(format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
}

export function formatResetAt(resetsAt: string, now: string, zone: string): string {
  const near = Date.parse(resetsAt) - Date.parse(now) < WEEKDAY_LIMIT_MS;
  const parts = zonedParts(resetsAt, zone, near ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
  const clock = `${parts.get('hour')}:${parts.get('minute')}`;
  return near ? `${parts.get('weekday')} ${clock}` : `${parts.get('month')} ${parts.get('day')} ${clock}`;
}

const CRITICAL_PCT = 95;

export type Notification = { key: string; text: string };

type WindowPair = { id: string; previous: UsageWindow; current: UsageWindow };

function crossed(pair: WindowPair, pct: number): boolean {
  return pair.previous.usedPct < pct && pair.current.usedPct >= pct;
}

function notification(pair: WindowPair, event: string, text: string): Notification[] {
  return [{ key: `${pair.id}|${pair.current.label}|${pair.current.resetsAt}|${event}`, text }];
}

function thresholdEvents(pair: WindowPair): Notification[] {
  const text = `${pair.id} ${pair.current.label} at ${pair.current.usedPct}%`;
  if (crossed(pair, CRITICAL_PCT)) return notification(pair, 'critical', text);
  return crossed(pair, HOT_PCT) ? notification(pair, 'hot', text) : [];
}

function recoveryEvents(pair: WindowPair): Notification[] {
  const recovered = pair.current.kind === 'rolling' && trips(pair.previous.usedPct) && !trips(pair.current.usedPct);
  return recovered ? notification(pair, 'recovered', `${pair.id} ${pair.current.label} recovered at ${pair.current.usedPct}%`) : [];
}

function evaporationEvents(pair: WindowPair, tonight: Tonight, now: string): Notification[] {
  if (evaporates(pair.previous, tonight) || !evaporates(pair.current, tonight)) return [];
  const left = formatCountdown(String(pair.current.resetsAt), now);
  return notification(pair, 'evaporating', `${pair.id} ${pair.current.label} is evaporating, resets in ${left}`);
}

function pairEvents(pair: WindowPair, now: string, midnight: string): Notification[] {
  const tonight = { nowMs: Date.parse(now), midnightMs: Date.parse(midnight) };
  return [...thresholdEvents(pair), ...recoveryEvents(pair), ...evaporationEvents(pair, tonight, now)];
}

export function notificationEvents(previous: ProviderUsage, current: ProviderUsage, now: string, midnight: string): Notification[] {
  if (previous.status !== 'ok' || current.status !== 'ok') return [];
  return current.windows.flatMap((window) => {
    const before = previous.windows.find((each) => each.label === window.label);
    return before === undefined ? [] : pairEvents({ id: current.id, previous: before, current: window }, now, midnight);
  });
}
