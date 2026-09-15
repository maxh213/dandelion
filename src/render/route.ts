import { NO_ROUTE, highRouteLine, nextLocalMidnight, routeLine, type ProviderUsage } from '../domain/index.ts';

export type RouteOutput = { line: string; routed: boolean };

export function renderRoute(usages: ProviderUsage[], now: string, zone: string, ineligible: string[], high: boolean): RouteOutput {
  const line = high ? highRouteLine(usages, ineligible) : routeLine(usages, now, nextLocalMidnight(zone, now), ineligible);
  return { line, routed: line !== NO_ROUTE };
}
