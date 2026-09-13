import type { ProviderUsage, Balance } from '../domain/index.ts';
import type { CommandRunner, RunFailure } from './runner.ts';

const PROFILE_TIMEOUT_MS = 20000;
const DEFAULT_REFERENCE = 20;
const BALANCE_LINE = /Balance:\s*\$([0-9.]+)/;

function parseReference(rawReference: string | undefined): number | undefined {
  if (rawReference === undefined) return DEFAULT_REFERENCE;
  if (rawReference === '') return undefined;
  return Number.parseFloat(rawReference);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected run failure: ${String(value)}`);
}

function runFailureReason(failure: RunFailure): string {
  switch (failure) {
    case 'missing':
      return 'kilo CLI not found in PATH';
    case 'timeout':
      return 'Command timed out after 20s';
    case 'exit':
      return 'Command failed or timed out';
    default:
      return assertNever(failure);
  }
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

  if (result.failure) return { ...usage, status: 'unavailable', reason: runFailureReason(result.failure) };

  const balance = parseBalance(result.stdout, env['ALLOWANCE_KILO_REFERENCE']);
  if (!balance) return { ...usage, status: 'unavailable', reason: 'Could not parse balance from output' };

  return { ...usage, balance, status: 'ok' };
}
