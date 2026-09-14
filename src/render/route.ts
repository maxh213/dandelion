import { NO_ROUTE, nextLocalMidnight, routeLine, type ProviderUsage } from '../domain/index.ts';

export type RouteOutput = { line: string; routed: boolean };

export function renderRoute(usages: ProviderUsage[], now: string, zone: string, ineligible: string[]): RouteOutput {
  const line = routeLine(usages, now, nextLocalMidnight(zone, now), ineligible);
  return { line, routed: line !== NO_ROUTE };
}
