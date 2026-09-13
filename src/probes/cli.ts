import type { Balance, ProviderUsage, UsageWindow } from '../domain/index.ts';

export type RunFailure = 'missing' | 'timeout' | 'exit';

export type CommandRunnerResult = {
  stdout: string;
  stderr: string;
  failure?: RunFailure;
};

export interface CommandRunner {
  run(command: string, args: string[], timeoutMs: number): Promise<CommandRunnerResult>;
}

export type ReadWindow = { label: string; usedPct: number; resetsAt: string | undefined };

export type Reading = { windows: ReadWindow[]; balance?: Balance };

export type CliProbe = {
  id: string;
  planLabel: string;
  args: string[];
  timeoutMs: number;
  reads: 'usage' | 'balance';
  read(stdout: string, now: string): Reading;
};

function assertNever(value: never): never {
  throw new Error(`Unexpected run failure: ${String(value)}`);
}

function runFailureReason(command: string, timeoutMs: number, failure: RunFailure): string {
  switch (failure) {
    case 'missing':
      return `${command} CLI not found in PATH`;
    case 'timeout':
      return `Command timed out after ${timeoutMs / 1000}s`;
    case 'exit':
      return 'Command failed or timed out';
    default:
      return assertNever(failure);
  }
}

function usageWindow({ label, usedPct, resetsAt }: ReadWindow): UsageWindow {
  if (resetsAt === undefined) return { label, usedPct };
  return { label, usedPct, resetsAt };
}

function isEmpty(reading: Reading): boolean {
  return reading.windows.length === 0 && reading.balance === undefined;
}

export async function probeCli(runner: CommandRunner, probe: CliProbe, now: string): Promise<ProviderUsage> {
  const result = await runner.run(probe.id, probe.args, probe.timeoutMs);
  const usage = { id: probe.id, displayName: probe.id, planLabel: probe.planLabel, windows: [], fetchedAt: now };

  if (result.failure) {
    return { ...usage, status: 'unavailable', reason: runFailureReason(probe.id, probe.timeoutMs, result.failure) };
  }

  const reading = probe.read(result.stdout, now);
  if (isEmpty(reading)) return { ...usage, status: 'unavailable', reason: `Could not parse ${probe.reads} from output` };

  return { ...usage, ...reading, windows: reading.windows.map(usageWindow), status: 'ok' };
}
