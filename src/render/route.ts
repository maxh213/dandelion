import { NO_ROUTE, highRouteLine, nextLocalMidnight, routeLine, type ProviderUsage } from '../domain/index.ts';

export type RouteOutput = { line: string; routed: boolean };

export type RouteMode = 'headroom' | 'high';

export type RouteRequest = { mode: RouteMode; now: string; zone: string };

function lineFor(usages: ProviderUsage[], ineligible: string[], request: RouteRequest): string {
  switch (request.mode) {
    case 'high':
      return highRouteLine(usages, ineligible);
    case 'headroom':
      return routeLine(usages, request.now, nextLocalMidnight(request.zone, request.now), ineligible);
  }
}

export function renderRoute(usages: ProviderUsage[], ineligible: string[], request: RouteRequest): RouteOutput {
  const line = lineFor(usages, ineligible, request);
  return { line, routed: line !== NO_ROUTE };
}
