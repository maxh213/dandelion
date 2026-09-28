import { NO_ROUTE, faultLine, highRouteLine, nextLocalMidnight, routeLine, type ProviderUsage, type RouteLines, type Routes } from '../domain/index.ts';

export type RouteOutput = { out: string; err: string; code: number };

export type RouteMode = 'headroom' | 'high';

export type RouteRequest = { mode: RouteMode; now: string; zone: string };

type RoutesFault = NonNullable<Routes['fault']>;

function assertNever(value: never): never {
  throw new Error(`Unexpected route mode: ${JSON.stringify(value)}`);
}

function headroomLine(lines: RouteLines, usages: ProviderUsage[], ineligible: string[], { now, zone }: RouteRequest): string {
  return routeLine(lines, usages, now, nextLocalMidnight(zone, now), ineligible);
}

function lineFor(lines: RouteLines, usages: ProviderUsage[], ineligible: string[], request: RouteRequest): string {
  switch (request.mode) {
    case 'high':
      return highRouteLine(lines, usages, ineligible);
    case 'headroom':
      return headroomLine(lines, usages, ineligible, request);
    default:
      return assertNever(request.mode);
  }
}

export function renderRoute(lines: RouteLines, usages: ProviderUsage[], ineligible: string[], request: RouteRequest): RouteOutput {
  const line = lineFor(lines, usages, ineligible, request);
  return { out: `${line}\n`, err: '', code: line === NO_ROUTE ? 1 : 0 };
}

export function renderRoutesFault(fault: RoutesFault): RouteOutput {
  return { out: '', err: `${faultLine(fault)}\n`, code: 2 };
}
