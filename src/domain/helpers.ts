export function formatCountdown(resetsAt: string, now: string): string {
  const resetMs = new Date(resetsAt).getTime();
  const nowMs = new Date(now).getTime();
  const diff = Math.max(0, resetMs - nowMs);

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d${remainingHours}h`;
  }

  return `${hours}h${minutes}m`;
}
