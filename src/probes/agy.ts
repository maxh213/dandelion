import type { UsageWindow } from '../domain/index.ts';
import { presentOnly, windowOf, type WindowProbe } from './windows.ts';

const REMAINING_PERCENT = /^(\d+)%$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function remainingPercent(columns: string[]): number | undefined {
  if (columns.length !== 4) return undefined;
  const match = REMAINING_PERCENT.exec(columns[2]);
  return match ? Number(match[1]) : undefined;
}

function validInstant(text: string): string | undefined {
  return ISO_INSTANT.test(text) && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

function withoutWord(text: string, word: string): string {
  return text
    .split(' ')
    .filter((part) => part !== word)
    .join(' ')
    .trim();
}

function parseRow(line: string): UsageWindow | undefined {
  const columns = line.trim().split('\t');
  const remaining = remainingPercent(columns);
  if (remaining === undefined) return undefined;
  const [group, label, , reset] = columns;
  const windowName = withoutWord(label, 'Remaining');
  return windowOf(`${group} · ${windowName}`, 100 - remaining, validInstant(reset));
}

function parseAgyUsage(stdout: string): UsageWindow[] {
  return presentOnly(stdout.split('\n').map(parseRow));
}

export const agyProbe: WindowProbe = {
  id: 'agy',
  planLabel: 'agy',
  args: ['-p', '/usage'],
  timeoutMs: 60000,
  parse: parseAgyUsage
};
