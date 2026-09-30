import { NO_ROUTE, highRouteLine, nextLocalMidnight, routeLine, type ProviderUsage, type RouteLines, type Routes, type RoutesFault } from '../domain/index.ts';

export type RouteOutput = { out: string; err: string; code: number };

export type RouteMode = 'headroom' | 'high';

export type RouteRequest = { mode: RouteMode; now: string; zone: string };

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

export function renderRoutesFault({ path, problem }: RoutesFault): RouteOutput {
  return { out: '', err: `dandelion: routes file ${path}: ${problem}\n`, code: 2 };
}

export type SnapshotRequest = { now: string; zone: string };

function statusFields(usage: ProviderUsage): Record<string, unknown> {
  if (usage.status !== 'ok') return { reason: usage.reason };
  return { balance: usage.balance, snapshotAt: usage.snapshotAt, note: usage.note };
}

function providerEntry(usage: ProviderUsage, ineligible: string[]): Record<string, unknown> {
  return {
    id: usage.id,
    displayName: usage.displayName,
    status: usage.status,
    planLabel: usage.planLabel,
    eligible: !ineligible.includes(usage.id),
    windows: usage.windows.map(({ label, kind, usedPct, resetsAt }) => ({ label, kind, usedPct, resetsAt })),
    ...statusFields(usage),
    fetchedAt: usage.fetchedAt
  };
}

function routeFields(routes: Routes, usages: ProviderUsage[], ineligible: string[], { now, zone }: SnapshotRequest): Record<string, unknown> {
  const { lines, fault } = routes;
  if (fault !== undefined) return { route: null, routeHigh: null, routesError: `${fault.path}: ${fault.problem}` };
  return { route: routeLine(lines, usages, now, nextLocalMidnight(zone, now), ineligible), routeHigh: highRouteLine(lines, usages, ineligible) };
}

export function renderSnapshot(routes: Routes, usages: ProviderUsage[], ineligible: string[], request: SnapshotRequest): string {
  return JSON.stringify({
    generatedAt: request.now,
    providers: usages.map((usage) => providerEntry(usage, ineligible)),
    ...routeFields(routes, usages, ineligible, request)
  });
}
