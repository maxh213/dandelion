import { validInstant, type WindowKind } from '../domain/index.ts';
import type { CliProbe, ReadWindow, Reading } from './cli.ts';

const REMAINING_PERCENT = /^(\d+)%$/;

function remainingPercent(columns: string[]): number | undefined {
  if (columns.length !== 4) return undefined;
  const match = REMAINING_PERCENT.exec(columns[2]);
  return match ? Number(match[1]) : undefined;
}

function withoutWord(text: string, word: string): string {
  return text
    .split(' ')
    .filter((part) => part !== word)
    .join(' ');
}

function parseRow(line: string): ReadWindow | [] {
  const columns = line.trim().split('\t');
  const remaining = remainingPercent(columns);
  if (remaining === undefined) return [];
  const [group, label, , reset] = columns;
  const windowName = withoutWord(label, 'Remaining');
  return { label: `${group} · ${windowName}`, kind: kindOf(windowName), usedPct: 100 - remaining, resetsAt: validInstant(reset) };
}

function kindOf(windowName: string): WindowKind {
  if (windowName.endsWith('Five Hour Limit')) return 'rolling';
  return /week/i.test(windowName) ? 'weekly' : 'other';
}

function readAgyUsage(stdout: string): Reading {
  return { windows: stdout.split('\n').flatMap(parseRow) };
}

export const agyProbe: CliProbe = {
  id: 'agy',
  planLabel: 'agy',
  args: ['-p', '/usage'],
  timeoutMs: 60000,
  reads: 'usage',
  read: readAgyUsage
};
