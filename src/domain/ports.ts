export type FetchOutcome = { status: number; body: string } | { failure: 'network' | 'timeout' };

export interface Fetcher {
  get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<FetchOutcome>;
  post(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<FetchOutcome>;
}

export interface FileReader {
  homeDir(): string;
  read(path: string): Promise<string | undefined>;
  isDirectory(path: string): Promise<boolean>;
}

export type ClaudeStatus = { severity: 'warm' | 'hot'; description: string };

export const USAGE_PARSE_FAILURE = 'Could not parse usage from response';

export type Fix = { command: string; args: string[]; env?: Record<string, string> };

export class ProbeUnavailable extends Error {
  readonly fix?: Fix;

  constructor(message: string, fix?: Fix) {
    super(message);
    this.fix = fix;
  }
}

export function isSuccess(outcome: FetchOutcome): outcome is { status: number; body: string } {
  return 'status' in outcome && outcome.status >= 200 && outcome.status < 300;
}

function failureOf(outcome: FetchOutcome, request: string, timeoutMs: number): string {
  if ('status' in outcome) return `${request} failed: HTTP ${outcome.status}`;
  return outcome.failure === 'timeout' ? `${request} timed out after ${timeoutMs / 1000}s` : `${request} failed`;
}

export function successBody(outcome: FetchOutcome, request: string, timeoutMs: number): string {
  if (!isSuccess(outcome)) throw new ProbeUnavailable(failureOf(outcome, request, timeoutMs));
  return outcome.body;
}

export function unavailableReason(error: unknown): string {
  return error instanceof ProbeUnavailable ? error.message : USAGE_PARSE_FAILURE;
}

export function unavailableFix(error: unknown): { fix?: Fix } {
  return error instanceof ProbeUnavailable && error.fix !== undefined ? { fix: error.fix } : {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

export function matchesOnJsonLine<T>(line: string, matchesOn: (value: unknown) => T[]): T[] {
  try {
    return matchesOn(parseJson(line));
  } catch {
    return [];
  }
}

export function isCount(value: unknown): value is number {
  return Number.isFinite(value) && Number(value) >= 0;
}

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\p{Cc}]*|.)`, 'gu');
const CONTROLS = /\p{Cc}/gu;

export function printable(text: string): string {
  return text.replace(ANSI, '').replace(CONTROLS, '').trim();
}

export function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

const DATE_BEFORE_TIME = /\d-\d{2}-\d{2}T/;

export function validInstant(value: unknown): string | undefined {
  return typeof value === 'string' && DATE_BEFORE_TIME.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function lineAround(log: string, at: number): string {
  const end = log.indexOf('\n', at);
  return log.slice(log.lastIndexOf('\n', at) + 1, end === -1 ? undefined : end);
}

export function newestLineMatch<T>(log: string, needle: string, matchesOn: (line: string) => T[]): T | undefined {
  for (let at = log.length, hit = log.lastIndexOf(needle); hit !== at; at = hit, hit = log.lastIndexOf(needle, at - 1)) {
    const [match] = matchesOn(lineAround(log, hit));
    if (match !== undefined) return match;
  }
  return undefined;
}
