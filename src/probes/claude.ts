import type { CliProbe, ReadWindow, Reading } from './cli.ts';

const WORK_ID = 'claude-work';
const WORK_PLAN = 'claude · work';
const NO_WORK_CONFIG = 'no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude';

const WINDOW_LINE = /^Current (session|week \(([^)]+)\)): (\d+)% used/;
const RESET_TEXT = /^ · resets (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{1,2})(?::(\d{2}))?(am|pm)(?: \((.+)\))?$/;
const MONTH_INDEX: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

type ResetParts = { month: number; day: number; hour: number; minute: number; zone: string };

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function rememberZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  zoneFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }));
  return zoneFormatter(timeZone);
}

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  return zoneFormatters.get(timeZone) ?? rememberZoneFormatter(timeZone);
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(utcMs));
  const field = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return Date.UTC(field.year, field.month - 1, field.day, field.hour, field.minute, field.second) - utcMs;
}

function instantInYear(parts: ResetParts, year: number): number {
  const wallMs = Date.UTC(year, parts.month, parts.day, parts.hour, parts.minute);
  const firstGuess = wallMs - zoneOffsetMs(wallMs, parts.zone);
  return wallMs - zoneOffsetMs(firstGuess, parts.zone);
}

function nextInstant(parts: ResetParts, now: string): number {
  const nowMs = Date.parse(now);
  const year = new Date(nowMs).getUTCFullYear();
  const thisYear = instantInYear(parts, year);
  return thisYear < nowMs - TWO_DAYS_MS ? instantInYear(parts, year + 1) : thisYear;
}

function instantOrNaN(parts: ResetParts, now: string): number {
  try {
    return nextInstant(parts, now);
  } catch {
    return Number.NaN;
  }
}

function resolveInstant(parts: ResetParts, now: string): string | undefined {
  const instant = instantOrNaN(parts, now);
  return Number.isNaN(instant) ? undefined : new Date(instant).toISOString();
}

function readParts(match: RegExpExecArray): ResetParts {
  return {
    month: MONTH_INDEX[match[1]],
    day: Number(match[2]),
    hour: (Number(match[3]) % 12) + (match[5] === 'pm' ? 12 : 0),
    minute: Number(match[4] ?? 0),
    zone: match[6] ?? 'UTC'
  };
}

function parseReset(text: string, now: string): string | undefined {
  const match = RESET_TEXT.exec(text);
  if (!match) return undefined;
  return resolveInstant(readParts(match), now);
}

function windowLabel(model: string | undefined): string {
  if (model === undefined) return 'session';
  return model === 'all models' ? 'weekly' : `weekly ${model}`;
}

function windowKind(model: string | undefined): ReadWindow['kind'] {
  return model === undefined ? 'rolling' : 'weekly';
}

function parseWindowLine(rawLine: string, now: string): ReadWindow | [] {
  const line = rawLine.trim();
  const match = WINDOW_LINE.exec(line);
  if (!match) return [];
  const resetsAt = parseReset(line.slice(match[0].length), now);
  return { label: windowLabel(match[2]), kind: windowKind(match[2]), usedPct: Number(match[3]), resetsAt };
}

function readClaudeUsage(stdout: string, now: string): Reading {
  const windows = stdout.split('\n').flatMap((line) => parseWindowLine(line, now));
  return { windows: windows.some((window) => window.label === 'weekly') ? windows : [] };
}

export const claudeProbe: CliProbe = {
  id: 'claude',
  planLabel: 'claude · personal',
  args: ['-p', '/usage'],
  timeoutMs: 90000,
  reads: 'usage',
  read: readClaudeUsage
};

export function claudeWorkProbe(env: Record<string, string | undefined>, homeDir: string): CliProbe {
  const configDir = env['DANDELION_CLAUDE_WORK_CONFIG_DIR'] || `${homeDir}/.claude-work`;
  return {
    ...claudeProbe,
    id: WORK_ID,
    command: claudeProbe.id,
    planLabel: WORK_PLAN,
    env: { CLAUDE_CONFIG_DIR: configDir },
    requiresDirectory: { path: configDir, missingReason: NO_WORK_CONFIG }
  };
}
