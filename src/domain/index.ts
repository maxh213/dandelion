import { openSnapshot, type Snapshot, type SortOrder, type StateFile } from './eligibility.ts';
import { isRecord, validInstant, type Fix } from './ports.ts';
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
  unavailableFix,
  unavailableReason,
  validInstant,
  type ClaudeStatus,
  type FetchOutcome,
  type Fix,
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

export { openEligibility, openHidden, openHistory, openView, type View, type Eligibility, type Hidden, type History, type HistorySample, type Snapshot, type StateFile } from './eligibility.ts';

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
  fix?: Fix;
  windows: UsageWindow[];
  fetchedAt: string;
};

export type ProviderUsage =
  | (ProviderIdentity & { status: 'ok'; balance?: Balance; snapshotAt?: string; note?: string })
  | (ProviderIdentity & { status: 'unavailable' | 'error'; reason: string });

const WINDOW_KINDS = ['rolling', 'weekly', 'other'];
const STATUSES = ['ok', 'unavailable', 'error'];

type Fields = Record<string, unknown>;

const WINDOW_CHECKS: ((value: Fields) => boolean)[] = [
  (value) => typeof value['label'] === 'string',
  (value) => WINDOW_KINDS.includes(String(value['kind'])),
  (value) => Number.isFinite(value['usedPct']),
  (value) => value['resetsAt'] === undefined || typeof value['resetsAt'] === 'string'
];

function isUsageWindow(value: unknown): boolean {
  return isRecord(value) && WINDOW_CHECKS.every((check) => check(value));
}

const USAGE_CHECKS: ((value: Fields) => boolean)[] = [
  (value) => typeof value['id'] === 'string',
  (value) => typeof value['displayName'] === 'string',
  (value) => validInstant(value['fetchedAt']) !== undefined,
  (value) => Array.isArray(value['windows']) && value['windows'].every(isUsageWindow),
  (value) => STATUSES.includes(String(value['status'])),
  (value) => value['status'] === 'ok' || typeof value['reason'] === 'string'
];

function isProviderUsage(value: unknown): value is ProviderUsage {
  return isRecord(value) && USAGE_CHECKS.every((check) => check(value));
}

export function openUsageSnapshot(env: Record<string, string | undefined>, homeDir: string, file: StateFile): Snapshot<ProviderUsage> {
  return openSnapshot(env, homeDir, file, isProviderUsage);
}

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export function isStale(snapshotAt: string | undefined, now: string): boolean {
  return Date.parse(now) - new Date(snapshotAt ?? Number.NaN).getTime() > STALE_AFTER_MS;
}

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

const ROLLING_LENGTH_MS = 5 * MS_PER_HOUR;
const WEEKLY_LENGTH_MS = 7 * 24 * MS_PER_HOUR;
const MIN_ELAPSED_SHARE = 0.05;

function windowLengthMs(window: UsageWindow): number | undefined {
  if (/week/i.test(window.label)) return WEEKLY_LENGTH_MS;
  return window.kind === 'rolling' ? ROLLING_LENGTH_MS : undefined;
}

function elapsedMs(window: UsageWindow, nowMs: number, resetMs: number): number | undefined {
  const lengthMs = windowLengthMs(window);
  if (lengthMs === undefined || !(resetMs > nowMs)) return undefined;
  const elapsed = lengthMs - (resetMs - nowMs);
  return elapsed >= lengthMs * MIN_ELAPSED_SHARE ? elapsed : undefined;
}

function hasUsage(usedPct: number): boolean {
  return usedPct > 0 && usedPct < FULL_PCT;
}

export function projectFull(window: UsageWindow, now: string): string | undefined {
  const nowMs = Date.parse(now);
  const resetMs = Date.parse(String(window.resetsAt));
  const elapsed = elapsedMs(window, nowMs, resetMs);
  if (elapsed === undefined || !hasUsage(window.usedPct)) return undefined;
  const fullMs = nowMs + ((FULL_PCT - window.usedPct) * elapsed) / window.usedPct;
  return fullMs < resetMs ? new Date(fullMs).toISOString() : undefined;
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

function resetPassed(window: UsageWindow, now: string): boolean {
  return window.resetsAt !== undefined && Date.parse(window.resetsAt) <= Date.parse(now);
}

function resetEvents(pair: WindowPair, now: string): Notification[] {
  const { previous, current } = pair;
  const reset = current.kind === 'weekly' && resetPassed(previous, now) && current.usedPct < previous.usedPct;
  return reset ? notification(pair, 'reset', `${pair.id} ${current.label} reset: ${current.usedPct}% used`) : [];
}

function pairEvents(pair: WindowPair, now: string, midnight: string): Notification[] {
  const tonight = { nowMs: Date.parse(now), midnightMs: Date.parse(midnight) };
  return [...thresholdEvents(pair), ...recoveryEvents(pair), ...evaporationEvents(pair, tonight, now), ...resetEvents(pair, now)];
}

export function notificationEvents(previous: ProviderUsage, current: ProviderUsage, now: string, midnight: string): Notification[] {
  if (previous.status !== 'ok' || current.status !== 'ok') return [];
  return current.windows.flatMap((window) => {
    const before = previous.windows.find((each) => each.label === window.label);
    return before === undefined ? [] : pairEvents({ id: current.id, previous: before, current: window }, now, midnight);
  });
}

export type { SortOrder };

const NEXT_ORDER: Record<SortOrder, SortOrder> = { dashboard: 'headroom', headroom: 'reset', reset: 'dashboard' };

export function nextSortOrder(order: SortOrder): SortOrder {
  return NEXT_ORDER[order];
}

function headroomOf(usage: ProviderUsage): number | undefined {
  return usage.windows.length === 0 ? undefined : FULL_PCT - Math.max(...usage.windows.map((window) => window.usedPct));
}

function soonestOf(usage: ProviderUsage, now: string): number | undefined {
  const future = usage.windows.map((window) => Date.parse(String(window.resetsAt))).filter((at) => at > Date.parse(now));
  return future.length === 0 ? undefined : Math.min(...future);
}

function keyOf(usage: ProviderUsage | undefined, order: SortOrder, now: string): number | undefined {
  if (usage === undefined) return undefined;
  const headroom = headroomOf(usage);
  return order === 'headroom' ? (headroom === undefined ? undefined : -headroom) : soonestOf(usage, now);
}

function keyedFirst(keys: (number | undefined)[]): number[] {
  const indexes = keys.map((_, index) => index);
  const keyed = indexes.filter((index) => keys[index] !== undefined);
  const rest = indexes.filter((index) => !keyed.includes(index));
  keyed.sort((a, b) => Number(keys[a]) - Number(keys[b]) || a - b);
  return [...keyed, ...rest];
}

export function orderPanels(usages: (ProviderUsage | undefined)[], order: SortOrder, now: string): number[] {
  if (order === 'dashboard') return usages.map((_, index) => index);
  return keyedFirst(usages.map((usage) => keyOf(usage, order, now)));
}

export function sortSuffix(order: SortOrder): string {
  return order === 'dashboard' ? '' : ` · sort: ${order}`;
}

const REPROBE_GRACE_MS = MS_PER_MINUTE;

export function passedResets(usage: ProviderUsage | undefined, now: string): string[] {
  if (usage?.status !== 'ok') return [];
  const resets = usage.windows.flatMap((window) => (window.resetsAt === undefined ? [] : [window.resetsAt]));
  return resets.filter((resetsAt) => Date.parse(now) - Date.parse(resetsAt) >= REPROBE_GRACE_MS);
}

export function resetKey(index: number, resetsAt: string): string {
  return `${index}|${resetsAt}`;
}

export function dueReprobes(usages: (ProviderUsage | undefined)[], now: string, handled: ReadonlySet<string>): number[] {
  const due = (usage: ProviderUsage | undefined, index: number) => passedResets(usage, now).some((resetsAt) => !handled.has(resetKey(index, resetsAt)));
  return usages.flatMap((usage, index) => (due(usage, index) ? [index] : []));
}
