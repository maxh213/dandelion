import type { Balance } from '../domain/index.ts';
import type { CliProbe, CommandRunner } from './cli.ts';

type ParsedAmount = { amount: number; currency?: string };

function numberAmount(value: number): ParsedAmount | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return { amount: value };
}

function stringAmount(value: string): ParsedAmount | undefined {
  const match = /^(\$)?([0-9]+(?:\.[0-9]+)?)$/.exec(value.trim());
  if (match === null) return undefined;
  const amount = { amount: Number(match[2]) };
  return match[1] === undefined ? amount : { ...amount, currency: '$' };
}

function validAmount(value: unknown): ParsedAmount | undefined {
  if (typeof value === 'number') return numberAmount(value);
  if (typeof value === 'string') return stringAmount(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function currencyOf(value: unknown, fallback: string): string | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value;
}

function withCurrency(parsed: ParsedAmount | undefined, rawCurrency: unknown): Balance | undefined {
  if (parsed === undefined) return undefined;
  const currency = currencyOf(rawCurrency, parsed.currency ?? '$');
  return currency === undefined ? undefined : { amount: parsed.amount, currency };
}

function balanceOf(value: unknown, profileCurrency: unknown): Balance | undefined {
  if (!isRecord(value)) return withCurrency(validAmount(value), profileCurrency);
  const parsed = validAmount(value['amount'] ?? value['balance']);
  return withCurrency(parsed, value['currency'] ?? profileCurrency);
}

function readKiloProfile(stdout: string): Balance | undefined {
  try {
    const profile: unknown = JSON.parse(stdout);
    if (!isRecord(profile)) return undefined;
    return balanceOf(profile['balance'], profile['currency']);
  } catch {
    return undefined;
  }
}

function dollarBalance(stdout: string): number | undefined {
  const balance = readKiloProfile(stdout);
  return balance?.currency === '$' ? balance.amount : undefined;
}

export async function freshKiloBalance(runner: CommandRunner): Promise<number | undefined> {
  try {
    const probe = kiloProbe();
    const result = await runner.run('kilo', probe.args, probe.timeoutMs);
    return result.failure === undefined ? dollarBalance(result.stdout) : undefined;
  } catch {
    return undefined;
  }
}

export function kiloProbe(): CliProbe {
  return {
    id: 'kilo',
    planLabel: 'api balance',
    args: ['profile', '--json'],
    timeoutMs: 20000,
    reads: 'balance',
    read: (stdout) => ({ windows: [], balance: readKiloProfile(stdout) })
  };
}
