import type { CliProbe, ReadWindow, Reading } from './cli.ts';

const WINDOW_LINE = /^Current (session|week \(([^)]+)\)): (\d+)% used(?: · resets (.+))?$/;
const RESET_TEXT = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{1,2})(?::(\d{2}))?(am|pm)(?: \((.+)\))?$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

type ResetParts = { month: number; day: number; hour: number; minute: number; zone: string };

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }).formatToParts(new Date(utcMs));
  const field = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return Date.UTC(field.year, field.month - 1, field.day, field.hour, field.minute, field.second) - utcMs;
}

function instantInYear(parts: ResetParts, year: number): number {
  const wallMs = Date.UTC(year, parts.month, parts.day, parts.hour, parts.minute);
  const firstGuess = wallMs - zoneOffsetMs(wallMs, parts.zone);
  return wallMs - zoneOffsetMs(firstGuess, parts.zone);
}

function resolveInstant(parts: ResetParts, now: string): string | undefined {
  try {
    const nowMs = Date.parse(now);
    const year = new Date(nowMs).getUTCFullYear();
    const thisYear = instantInYear(parts, year);
    const instant = thisYear < nowMs - TWO_DAYS_MS ? instantInYear(parts, year + 1) : thisYear;
    return new Date(instant).toISOString();
  } catch {
    return undefined;
  }
}

function readParts(match: RegExpExecArray): ResetParts {
  return {
    month: MONTHS.indexOf(match[1]),
    day: Number(match[2]),
    hour: (Number(match[3]) % 12) + (match[5] === 'pm' ? 12 : 0),
    minute: Number(match[4] ?? '0'),
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

function parseWindowLine(line: string, now: string): ReadWindow | [] {
  const match = WINDOW_LINE.exec(line.trim());
  if (!match) return [];
  const resetsAt = match[4] === undefined ? undefined : parseReset(match[4], now);
  return { label: windowLabel(match[2]), usedPct: Number(match[3]), resetsAt };
}

function readClaudeUsage(stdout: string, now: string): Reading {
  const windows = stdout.split('\n').flatMap((line) => parseWindowLine(line, now));
  return { windows: windows.some((window) => window.label === 'weekly') ? windows : [] };
}

export const claudeProbe: CliProbe = {
  id: 'claude',
  planLabel: 'claude code',
  args: ['-p', '/usage'],
  timeoutMs: 90000,
  reads: 'usage',
  read: readClaudeUsage
};
