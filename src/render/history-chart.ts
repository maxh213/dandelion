import type { HistorySample } from '../domain/index.ts';
import { WIDTH, bold, cutCells, dim, repeatChar } from './terminal.ts';

const Y_LABEL_CELLS = 5;
const PLOT_CELLS = WIDTH - Y_LABEL_CELLS;
const MAX_CHART_ROWS = 6;
const LEVELS = [...'▁▂▃▄▅▆▇█'];
const FULL_PCT = 100;
const CHROME_ROWS = 3;
const WINDOW_OVERHEAD_ROWS = 2;
const NO_HISTORY = 'no history yet · samples are recorded after each refresh round';
const BACK_HINT = 'esc/q/g back to dashboard';

export type HistoryView = {
  id: string;
  samples: HistorySample[];
  zone: string;
  rows: number;
  now: string;
};

type Column = { usedPct: number; dropped: boolean } | undefined;

function atMs(sample: HistorySample): number {
  return Date.parse(sample.at);
}

function windowLabels(samples: HistorySample[]): string[] {
  return [...new Set(samples.map((sample) => sample.label))];
}

function bucketOf(sample: HistorySample, from: number, span: number): number {
  return Math.min(PLOT_CELLS - 1, Math.floor(((atMs(sample) - from) / span) * PLOT_CELLS));
}

function columnsOf(samples: HistorySample[], from: number, to: number): Column[] {
  const columns: Column[] = Array.from({ length: PLOT_CELLS }, () => undefined);
  const span = Math.max(1, to - from);
  let previous: number | undefined;
  for (const sample of samples) {
    const dropped = previous !== undefined && sample.usedPct < previous;
    const at = bucketOf(sample, from, span);
    columns[at] = { usedPct: sample.usedPct, dropped: dropped || columns[at]?.dropped === true };
    previous = sample.usedPct;
  }
  return columns;
}

function clampPct(usedPct: number): number {
  return Math.min(FULL_PCT, Math.max(0, usedPct));
}

function cellOf(column: Column, row: number, rows: number, noColor: boolean): string {
  if (column === undefined) return ' ';
  const filled = (clampPct(column.usedPct) / FULL_PCT) * rows - row;
  if (filled >= 1) return noColor ? '#' : LEVELS[LEVELS.length - 1];
  if (filled <= 0) return ' ';
  return noColor ? '#' : LEVELS[Math.max(0, Math.ceil(filled * LEVELS.length) - 1)];
}

function yLabel(row: number, rows: number): string {
  if (row === rows - 1) return '100%'.padStart(Y_LABEL_CELLS - 1) + ' ';
  return row === 0 ? '0%'.padStart(Y_LABEL_CELLS - 1) + ' ' : repeatChar(' ', Y_LABEL_CELLS);
}

function chartRows(columns: Column[], rows: number, noColor: boolean): string[] {
  return Array.from({ length: rows }, (_, index) => rows - 1 - index).map(
    (row) => `${yLabel(row, rows)}${columns.map((column) => cellOf(column, row, rows, noColor)).join('')}`
  );
}

function resetRow(columns: Column[], noColor: boolean): string {
  const mark = noColor ? 'v' : '↓';
  return `${repeatChar(' ', Y_LABEL_CELLS)}${columns.map((column) => (column?.dropped ? mark : ' ')).join('')}`;
}

function stamp(ms: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function axisRow(from: number, to: number, zone: string): string {
  const left = stamp(from, zone);
  const right = stamp(to, zone);
  return `${repeatChar(' ', Y_LABEL_CELLS)}${left}${repeatChar(' ', PLOT_CELLS - left.length - right.length)}${right}`;
}

function windowBlock(label: string, samples: HistorySample[], rows: number, range: [number, number], noColor: boolean): string[] {
  const columns = columnsOf(samples, range[0], range[1]);
  const latest = samples[samples.length - 1].usedPct;
  const title = `${cutCells(label, WIDTH - 8)}  ${latest}%`;
  return [bold(title, noColor), ...chartRows(columns, rows, noColor), dim(resetRow(columns, noColor), noColor)];
}

function chartHeight(rows: number, windows: number): number {
  const share = Math.floor((rows - CHROME_ROWS) / windows) - WINDOW_OVERHEAD_ROWS;
  return Math.min(MAX_CHART_ROWS, Math.max(1, share));
}

function header(view: HistoryView, noColor: boolean): string {
  return bold(`${view.id} · usage over time`, noColor);
}

export function renderHistoryView(view: HistoryView, noColor: boolean): string {
  const samples = [...view.samples].sort((a, b) => atMs(a) - atMs(b));
  const head = header(view, noColor);
  const hint = dim(BACK_HINT, noColor);
  if (samples.length === 0) return [head, dim(NO_HISTORY, noColor), hint].slice(0, view.rows).join('\n');
  const range: [number, number] = [atMs(samples[0]), Math.max(atMs(samples[samples.length - 1]), Date.parse(view.now))];
  const labels = windowLabels(samples);
  const height = chartHeight(view.rows, labels.length);
  const blocks = labels.flatMap((label) =>
    windowBlock(label, samples.filter((sample) => sample.label === label), height, range, noColor)
  );
  const axis = dim(axisRow(range[0], range[1], view.zone), noColor);
  return [head, ...blocks.slice(0, Math.max(0, view.rows - CHROME_ROWS)), axis, hint].slice(0, view.rows).join('\n');
}
