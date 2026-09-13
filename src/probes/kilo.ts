import type { ProviderUsage, Balance } from '../domain/types.ts';

export interface CommandRunnerResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: Error;
}

export interface CommandRunner {
  run(command: string, args: string[], timeoutMs: number): Promise<CommandRunnerResult>;
}

const PROFILE_TIMEOUT_MS = 20000;
const DEFAULT_REFERENCE = 20;
const BALANCE_LINE = /Balance:\s*\$([0-9.]+)/;

function parseReference(rawReference: string | undefined): number | undefined {
  if (rawReference === undefined) return DEFAULT_REFERENCE;
  if (rawReference === '') return undefined;
  return Number.parseFloat(rawReference);
}

function isMissingBinary(error?: Error): boolean {
  if (!error) return false;
  return error.message.includes('ENOENT');
}

function hasFailed(result: CommandRunnerResult): boolean {
  return result.code !== 0 || result.error !== undefined;
}

function runFailureReason(result: CommandRunnerResult): string | undefined {
  if (isMissingBinary(result.error)) return 'kilo CLI not found in PATH';
  if (result.timedOut) return 'Command timed out after 20s';
  if (hasFailed(result)) return 'Command failed or timed out';
  return undefined;
}

function parseBalance(stdout: string, rawReference: string | undefined): Balance | undefined {
  const match = BALANCE_LINE.exec(stdout);
  if (!match) return undefined;

  const balance: Balance = { amount: Number.parseFloat(match[1]), currency: '$' };
  const reference = parseReference(rawReference);
  if (reference !== undefined) balance.reference = reference;
  return balance;
}

export async function probeKilo(
  runner: CommandRunner,
  now: string,
  env: Record<string, string | undefined>
): Promise<ProviderUsage> {
  const result = await runner.run('kilo', ['profile'], PROFILE_TIMEOUT_MS);
  const usage = { id: 'kilo', displayName: 'kilo', windows: [], fetchedAt: now };

  const failure = runFailureReason(result);
  if (failure) return { ...usage, status: 'unavailable', reason: failure };

  const balance = parseBalance(result.stdout, env['ALLOWANCE_KILO_REFERENCE']);
  if (!balance) return { ...usage, status: 'unavailable', reason: 'Could not parse balance from output' };

  return { ...usage, balance, status: 'ok' };
}
