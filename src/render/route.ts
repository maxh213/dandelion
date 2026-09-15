import { NO_ROUTE, highRouteLine, nextLocalMidnight, routeLine, type ProviderUsage } from '../domain/index.ts';

export type RouteOutput = { line: string; routed: boolean };

export type RouteMode = 'headroom' | 'high';

export type RouteRequest = { mode: RouteMode; now: string; zone: string };

function lineFor(usages: ProviderUsage[], ineligible: string[], { mode, now, zone }: RouteRequest): string {
  return mode === 'high' ? highRouteLine(usages, ineligible) : routeLine(usages, now, nextLocalMidnight(zone, now), ineligible);
}

export function renderRoute(usages: ProviderUsage[], ineligible: string[], request: RouteRequest): RouteOutput {
  const line = lineFor(usages, ineligible, request);
  return { line, routed: line !== NO_ROUTE };
}
