import { fieldOf, isFilled, isSuccess, parseJson, printable, type ClaudeStatus, type Fetcher } from '../domain/index.ts';

export type StatusIo = { fetcher: Pick<Fetcher, 'get'> };

const CLAUDE_URL = 'https://status.claude.com/api/v2/status.json';
const OPENAI_URL = 'https://status.openai.com/api/v2/status.json';
const CURSOR_URL = 'https://status.cursor.com/api/v2/status.json';
const TIMEOUT_MS = 10000;
const NONE = 'none';

function urlOf(env: Record<string, string | undefined>, name: string, fallback: string): string {
  return env[name] || fallback;
}

function severityOf(indicator: unknown): ClaudeStatus['severity'] | undefined {
  if (!isFilled(indicator) || indicator === NONE) return undefined;
  return indicator === 'minor' ? 'warm' : 'hot';
}

function statusOf(body: string): ClaudeStatus | undefined {
  const status = fieldOf(parseJson(body), 'status');
  const severity = severityOf(fieldOf(status, 'indicator'));
  const description = fieldOf(status, 'description');
  const text = isFilled(description) ? printable(description) : '';
  return severity !== undefined && text !== '' ? { severity, description: text } : undefined;
}

function parsed(body: string): ClaudeStatus | undefined {
  try {
    return statusOf(body);
  } catch {
    return undefined;
  }
}

async function probeStatus(io: StatusIo, url: string): Promise<ClaudeStatus | undefined> {
  const outcome = await io.fetcher.get(url, {}, TIMEOUT_MS);
  return isSuccess(outcome) ? parsed(outcome.body) : undefined;
}

export function probeClaudeStatus(io: StatusIo, env: Record<string, string | undefined>): Promise<ClaudeStatus | undefined> {
  return probeStatus(io, urlOf(env, 'DANDELION_CLAUDE_STATUS_URL', CLAUDE_URL));
}

export function probeOpenAiStatus(io: StatusIo, env: Record<string, string | undefined>): Promise<ClaudeStatus | undefined> {
  return probeStatus(io, urlOf(env, 'DANDELION_OPENAI_STATUS_URL', OPENAI_URL));
}

export function probeCursorStatus(io: StatusIo, env: Record<string, string | undefined>): Promise<ClaudeStatus | undefined> {
  return probeStatus(io, urlOf(env, 'DANDELION_CURSOR_STATUS_URL', CURSOR_URL));
}
