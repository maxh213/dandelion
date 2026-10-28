import {
  NO_ROUTE,
  highDecision,
  highDecisionLine,
  formatResetAt,
  highRouteLine,
  limitsOf,
  nextLocalMidnight,
  projectFull,
  routeDecision,
  routeDecisionLine,
  routeLine,
  usageClass,
  type ChainSkip,
  type ChainWin,
  type HighDecision,
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
  return `${Math.round(value)}%`;
}

function dollarBalance(usages: ProviderUsage[]): string {
  const kilo = usages.find(({ id }) => id === 'kilo');
  const balance = kilo?.status === 'ok' ? kilo.balance : undefined;
  return balance === undefined ? 'unavailable' : `${balance.currency}${balance.amount.toFixed(2)}`;
}

function headroomText(chosen: { id: string; left: number }, rivals: RouteDecision['rivals']): string {
  const others = rivals.map(({ id, left }) => `${id} ${percent(left)}`).join(', ');
  const suffix = others === '' ? '' : ` (${others})`;
  return `headroom: ${chosen.id} binding ${percent(chosen.left)} left${suffix}`;
}

function choiceText({ chosen, rivals }: RouteDecision, zone: string, usages: ProviderUsage[]): string {
  if (chosen === undefined) return `${NO_ROUTE}: no account can take the work`;
  if (chosen.rule === 'balance') return `balance: kilo ${dollarBalance(usages)} available; launch requires a fresh balance above $10.00`;
  if (chosen.rule === 'evaporation') return `evaporation: ${chosen.id} ${chosen.label} ${percent(chosen.left)} left resets ${clockIn(zone, String(chosen.resetsAt))} before midnight`;
  return headroomText(chosen, rivals);
}

function backText(backAt: string | undefined, now: string, zone: string): string {
  return backAt === undefined ? '' : `, back ${formatResetAt(backAt, now, zone)}`;
}

function trippedEntry({ id, label, usedPct, backAt }: Skipped['tripped'][number], now: string, zone: string): string {
  return `${id} (${label} ${percent(usedPct)}${backText(backAt, now, zone)})`;
}

function limitedEntry({ id, label, usedPct, limit, backAt }: Skipped['limited'][number], now: string, zone: string): string {
  return `${id} (${label} ${percent(usedPct)}, limit ${limit}%${backText(backAt, now, zone)})`;
}

function limitedText(limited: Skipped['limited'], now: string, zone: string): string {
  return limited.length > 0 ? `limited: ${limited.map((each) => limitedEntry(each, now, zone)).join(', ')}` : '';
}

function unavailableEntry(id: string, usages: ProviderUsage[]): string {
  if (id !== 'kilo') return id;
  const balance = dollarBalance(usages);
  return balance === 'unavailable' ? 'kilo (balance unavailable)' : `kilo (balance ${balance}; requires dollar balance above $10.00)`;
}

function skippedText({ limited, tripped, ineligible, unavailable }: Skipped, now: string, zone: string, usages: ProviderUsage[]): string {
  const parts = [
    limitedText(limited, now, zone),
    tripped.length > 0 ? `tripped: ${tripped.map((each) => trippedEntry(each, now, zone)).join(', ')}` : '',
    ineligible.length > 0 ? `ineligible: ${ineligible.join(', ')}` : '',
    unavailable.length > 0 ? `unavailable: ${unavailable.map((id) => unavailableEntry(id, usages)).join(', ')}` : ''
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

function skipsText({ skipped, limited }: HighDecision, now: string, zone: string): string {
  const parts = [skipped.length === 0 ? '' : `skipped: ${skipped.map(skipReason).join('; ')}`, limitedText(limited, now, zone)];
  return parts.filter((part) => part !== '').join('; ');
}

function withExplanation(line: string, explanation: string[]): RouteOutput {
  const text = [line, ...explanation.filter((each) => each !== '')].join('\n');
  return { out: `${text}\n`, err: '', code: line === NO_ROUTE ? 1 : 0 };
}

function explainHigh(lines: RouteLines, usages: ProviderUsage[], ineligible: string[], { now, zone }: RouteRequest): RouteOutput {
  const decision = highDecision(usages, now, ineligible, limitsOf(lines));
  return withExplanation(highDecisionLine(lines, decision), [winnerText(decision.winner), skipsText(decision, now, zone)]);
}

function explainHeadroom(lines: RouteLines, usages: ProviderUsage[], ineligible: string[], { now, zone }: RouteRequest): RouteOutput {
  const decision = routeDecision(usages, now, nextLocalMidnight(zone, now), ineligible, limitsOf(lines));
  return withExplanation(routeDecisionLine(lines, decision), [choiceText(decision, zone, usages), skippedText(decision.skipped, now, zone, usages)]);
}

function explained(lines: RouteLines, usages: ProviderUsage[], ineligible: string[], request: RouteRequest): RouteOutput {
  switch (request.mode) {
    case 'high':
      return explainHigh(lines, usages, ineligible, request);
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
      return highRouteLine(lines, usages, request.now, ineligible);
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
  return { label, kind, usedPct: Math.round(usedPct), resetsAt, projectedFullAt: projectFull(window, now) };
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
  return { route: routeLine(lines, usages, now, nextLocalMidnight(zone, now), ineligible), routeHigh: highRouteLine(lines, usages, now, ineligible) };
}

export function renderSnapshot(routes: Routes, usages: ProviderUsage[], ineligible: string[], request: SnapshotRequest): string {
  return JSON.stringify({
    generatedAt: request.now,
    providers: usages.map((usage) => providerEntry(usage, ineligible, request.now)),
    ...routeFields(routes, usages, ineligible, request)
  });
}

const ROUTES_ERROR = 'routes file error';

function listedUsages(usages: ProviderUsage[]): { id: string; worst: number }[] {
  return usages
    .filter((usage) => usage.status === 'ok' && usage.windows.length > 0)
    .map(({ id, windows }) => ({ id, worst: Math.round(Math.max(...windows.map(({ usedPct }) => usedPct))) }));
}

function routePart(routes: Routes, usages: ProviderUsage[], ineligible: string[], request: SnapshotRequest): string {
  const { lines, fault } = routes;
  return fault === undefined ? headroomLine(lines, usages, ineligible, { ...request, mode: 'headroom' }) : ROUTES_ERROR;
}

export function renderLine(routes: Routes, usages: ProviderUsage[], ineligible: string[], request: SnapshotRequest): string {
  const segments = listedUsages(usages).map(({ id, worst }) => `${id} ${percent(worst)}`).join(' · ');
  return `${[segments, `→ ${routePart(routes, usages, ineligible, request)}`].filter((part) => part !== '').join(' ')}\n`;
}

export function renderWaybar(routes: Routes, usages: ProviderUsage[], ineligible: string[], request: SnapshotRequest): string {
  const listed = listedUsages(usages);
  const worst = Math.max(0, ...listed.map((entry) => entry.worst));
  return `${JSON.stringify({
    text: routePart(routes, usages, ineligible, request),
    tooltip: listed.map(({ id, worst: used }) => `${id} ${percent(used)}`).join('\n'),
    class: usageClass(worst),
    percentage: worst
  })}\n`;
}
