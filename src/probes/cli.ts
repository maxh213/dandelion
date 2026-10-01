import { withReset, type Balance, type FileReader, type Fix, type ProviderUsage, type UsageWindow, type WindowKind } from '../domain/index.ts';

export type RunFailure = 'missing' | 'timeout' | 'exit';

export type CommandRunnerResult = {
  stdout: string;
  stderr: string;
  failure?: RunFailure;
};

export interface CommandRunner {
  run(command: string, args: string[], timeoutMs: number, env?: Record<string, string>): Promise<CommandRunnerResult>;
}

export type CliIo = { runner: CommandRunner; reader: FileReader };

export type ReadWindow = { label: string; kind: WindowKind; usedPct: number; resetsAt: string | undefined };

export type Reading = { windows: ReadWindow[]; balance?: Balance };

type RequiredDirectory = { path: string; missingReason: string; missingFix: Fix };

export type CliProbe = {
  id: string;
  command?: string;
  env?: Record<string, string>;
  requiresDirectory?: RequiredDirectory;
  planLabel: string;
  args: string[];
  timeoutMs: number;
  reads: 'usage' | 'balance';
  read(stdout: string, now: string): Reading;
};

function assertNever(value: never): never {
  throw new Error(`Unexpected run failure: ${String(value)}`);
}

const REASON_CELLS = 72;
const EXIT_REASON = 'Command exited with an error';
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\p{Cc}]*|.)`, 'gu');
const CONTROL = /\p{Cc}/gu;
const SECRET = /Bearer\s+[\w.~+/=-]+|[A-Za-z0-9_-]{32,}/gi;

function cleanLine(line: string): string {
  return line.replace(ANSI, '').replace(CONTROL, '').replace(SECRET, '…').trim();
}

function cutReason(text: string): string {
  const cells = [...text];
  return cells.length > REASON_CELLS ? `${cells.slice(0, REASON_CELLS - 1).join('').trimEnd()}…` : text;
}

function exitReason(stderr: string): string {
  const line = stderr.split(/\r\n|\n|\r/).map(cleanLine).find((text) => text !== '');
  return line === undefined ? EXIT_REASON : cutReason(`${EXIT_REASON}: ${line}`);
}

function runFailureReason(command: string, timeoutMs: number, failure: RunFailure, stderr: string): string {
  switch (failure) {
    case 'missing':
      return `${command} CLI not found in PATH`;
    case 'timeout':
      return `Command timed out after ${timeoutMs / 1000}s`;
    case 'exit':
      return exitReason(stderr);
    default:
      return assertNever(failure);
  }
}

function usageWindow({ resetsAt, ...window }: ReadWindow): UsageWindow {
  return withReset(window, resetsAt);
}

function isEmpty(reading: Reading): boolean {
  return reading.windows.length === 0 && reading.balance === undefined;
}

async function runProbe(runner: CommandRunner, probe: CliProbe, now: string): Promise<ProviderUsage> {
  const command = probe.command ?? probe.id;
  const result = await runner.run(command, probe.args, probe.timeoutMs, probe.env);
  const usage = { id: probe.id, displayName: probe.id, planLabel: probe.planLabel, windows: [], fetchedAt: now };

  if (result.failure) {
    return { ...usage, status: 'unavailable', reason: runFailureReason(command, probe.timeoutMs, result.failure, result.stderr) };
  }

  const reading = probe.read(result.stdout, now);
  if (isEmpty(reading)) return { ...usage, status: 'unavailable', reason: `Could not parse ${probe.reads} from output` };

  return { ...usage, ...reading, windows: reading.windows.map(usageWindow), status: 'ok' };
}

export async function probeCli({ runner, reader }: CliIo, probe: CliProbe, now: string): Promise<ProviderUsage> {
  const required = probe.requiresDirectory;
  if (required === undefined || (await reader.isDirectory(required.path))) return runProbe(runner, probe, now);
  return { id: probe.id, displayName: probe.id, planLabel: probe.planLabel, windows: [], fetchedAt: now, status: 'unavailable', reason: required.missingReason, fix: required.missingFix };
}
