import { NO_ROUTE, highRouteLine, nextLocalMidnight, routeLine, type ProviderUsage } from '../domain/index.ts';

export type RouteOutput = { line: string; routed: boolean };

export type RouteMode = 'headroom' | 'high';

export type RouteRequest = { mode: RouteMode; now: string; zone: string };

function assertNever(value: never): never {
  throw new Error(`Unexpected route mode: ${JSON.stringify(value)}`);
}

function headroomLine(usages: ProviderUsage[], ineligible: string[], { now, zone }: RouteRequest): string {
  return routeLine(usages, now, nextLocalMidnight(zone, now), ineligible);
}

function lineFor(usages: ProviderUsage[], ineligible: string[], request: RouteRequest): string {
  switch (request.mode) {
    case 'high':
      return highRouteLine(usages, ineligible);
    case 'headroom':
      return headroomLine(usages, ineligible, request);
    default:
      return assertNever(request.mode);
  }
}

export function renderRoute(usages: ProviderUsage[], ineligible: string[], request: RouteRequest): RouteOutput {
  const line = lineFor(usages, ineligible, request);
  return { line, routed: line !== NO_ROUTE };
}
