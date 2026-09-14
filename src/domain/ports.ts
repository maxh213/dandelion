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

export const USAGE_PARSE_FAILURE = 'Could not parse usage from response';

export class ProbeUnavailable extends Error {}

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
