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

export type UsageWindow = {
  label: string;
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
