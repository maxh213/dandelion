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

export type ProviderUsage = {
  id: string;
  displayName: string;
  planLabel?: string;
  windows: UsageWindow[];
  balance?: Balance;
  fetchedAt: string;
  status: 'ok' | 'unavailable' | 'error';
  reason?: string;
};
