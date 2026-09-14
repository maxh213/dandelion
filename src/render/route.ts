import { nextLocalMidnight, routeLine, type ProviderUsage } from '../domain/index.ts';

export function renderRoute(usages: ProviderUsage[], now: string, zone: string): string {
  return routeLine(usages, now, nextLocalMidnight(zone, now));
}
