import {
  NO_ROUTE,
  highDecision,
  highDecisionLine,
  highRouteLine,
  nextLocalMidnight,
  projectFull,
  routeDecision,
  routeDecisionLine,
  routeLine,
  type ChainSkip,
  type ChainWin,
  type ProviderUsage,
  type RouteDecision,
  type RouteLines,
  type Routes,
  type RoutesFault,
  type Skipped,
  type UsageWindow
} from '../domain/index.ts';

export type RouteOutput = { out: string; err: string; code: number };

export type RouteMode = 'headroom' | 'high';

export type RouteRequest = { mode: RouteMode; now: string; zone: string; why?: boolean };

function assertNever(value: never): never {
  throw new Error(`Unexpected route mode: ${JSON.stringify(value)}`);
}

function clockIn(zone: string, instant: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
}

function percent(value: number): string {
  return `${value}%`;
}

function choiceText({ chosen, rivals }: RouteDecision, zone: string): string {
  if (chosen === undefined) return `${NO_ROUTE}: no account can take the work`;
  if (chosen.rule === 'evaporation') return `evaporation: ${chosen.id} ${chosen.label} ${percent(chosen.left)} left resets ${clockIn(zone, String(chosen.resetsAt))} before midnight`;
  const others = rivals.map(({ id, left }) => `${id} ${percent(left)}`).join(', ');
  return `headroom: ${chosen.id} binding ${percent(chosen.left)} left${others === '' ? '' : ` (${others})`}`;
}

function skippedText({ tripped, ineligible, unavailable }: Skipped): string {
  const parts = [
    tripped.length > 0 ? `tripped: ${tripped.map(({ id, label, usedPct }) => `${id} (${label} ${percent(usedPct)})`).join(', ')}` : '',
    ineligible.length > 0 ? `ineligible: ${ineligible.join(', ')}` : '',
    unavailable.length > 0 ? `unavailable: ${unavailable.join(', ')}` : ''
  ];
  return parts.filter((part) => part !== '').join('; ');
}

function skipReason({ rank, name, usedPct }: ChainSkip): string {
  return `rank ${rank} ${name} ${usedPct === undefined ? 'no open account' : `tripped at ${percent(usedPct)}`}`;
}

function winnerText(winner: ChainWin | undefined): string {
  if (winner === undefined) return `${NO_ROUTE}: no chain entry is open`;
  return `rank ${winner.rank} ${winner.name} on ${winner.id}: gating ${percent(winner.usedPct)} used`;
}

function skipsText(skipped: ChainSkip[]): string {
  return skipped.length === 0 ? '' : `skipped: ${skipped.map(skipReason).join('; ')}`;
}

function withExplanation(line: string, explanation: string[]): RouteOutput {
  const text = [line, ...explanation.filter((each) => each !== '')].join('\n');
  return { out: `${text}\n`, err: '', code: line === NO_ROUTE ? 1 : 0 };
}

function explainHigh(lines: RouteLines, usages: ProviderUsage[], ineligible: string[]): RouteOutput {
  const decision = highDecision(usages, ineligible);
  return withExplanation(highDecisionLine(lines, decision), [winnerText(decision.winner), skipsText(decision.skipped)]);
}

function explainHeadroom(lines: RouteLines, usages: ProviderUsage[], ineligible: string[], { now, zone }: RouteRequest): RouteOutput {
  const decision = routeDecision(usages, now, nextLocalMidnight(zone, now), ineligible);
  return withExplanation(routeDecisionLine(lines, decision), [choiceText(decision, zone), skippedText(decision.skipped)]);
}

function explained(lines: RouteLines, usages: ProviderUsage[], ineligible: string[], request: RouteRequest): RouteOutput {
  switch (request.mode) {
    case 'high':
      return explainHigh(lines, usages, ineligible);
    case 'headroom':
      return explainHeadroom(lines, usages, ineligible, request);
    default:
      return assertNever(request.mode);
  }
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
  if (request.why === true) return explained(lines, usages, ineligible, request);
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

function windowEntry(window: UsageWindow, now: string): Record<string, unknown> {
  const { label, kind, usedPct, resetsAt } = window;
  return { label, kind, usedPct, resetsAt, projectedFullAt: projectFull(window, now) };
}

function providerEntry(usage: ProviderUsage, ineligible: string[], now: string): Record<string, unknown> {
  return {
    id: usage.id,
    displayName: usage.displayName,
    status: usage.status,
    planLabel: usage.planLabel,
    eligible: !ineligible.includes(usage.id),
    windows: usage.windows.map((window) => windowEntry(window, now)),
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
    providers: usages.map((usage) => providerEntry(usage, ineligible, request.now)),
    ...routeFields(routes, usages, ineligible, request)
  });
}
