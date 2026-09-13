import type { ProviderUsage, Balance } from '../domain/index.ts';
import { runFailureReason, type CommandRunner } from './runner.ts';

const PROFILE_TIMEOUT_MS = 20000;
const DEFAULT_REFERENCE = 20;
const BALANCE_LINE = /Balance:\s*\$([0-9.]+)/;

function parseReference(rawReference: string | undefined): number | undefined {
  if (rawReference === undefined) return DEFAULT_REFERENCE;
  if (rawReference === '') return undefined;
  return Number.parseFloat(rawReference);
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
  const usage = { id: 'kilo', displayName: 'kilo', planLabel: 'api balance', windows: [], fetchedAt: now };

  if (result.failure) {
    return { ...usage, status: 'unavailable', reason: runFailureReason('kilo', PROFILE_TIMEOUT_MS, result.failure) };
  }

  const balance = parseBalance(result.stdout, env['ALLOWANCE_KILO_REFERENCE']);
  if (!balance) return { ...usage, status: 'unavailable', reason: 'Could not parse balance from output' };

  return { ...usage, balance, status: 'ok' };
}
