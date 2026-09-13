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
  | (ProviderIdentity & { status: 'ok'; balance?: Balance })
  | (ProviderIdentity & { status: 'unavailable' | 'error'; reason: string });

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
