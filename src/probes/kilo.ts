import type { Balance } from '../domain/index.ts';
import type { CliProbe } from './cli.ts';

const DEFAULT_REFERENCE = 20;
const BALANCE_LINE = /Balance:\s*\$([0-9.]+)/;

function parseReference(rawReference: string | undefined): number | undefined {
  if (rawReference === undefined) return DEFAULT_REFERENCE;
  if (rawReference === '') return undefined;
  const reference = Number.parseFloat(rawReference);
  return reference > 0 ? reference : undefined;
}

function amountIn(stdout: string): number | undefined {
  const captured = BALANCE_LINE.exec(stdout)?.[1];
  return captured === undefined ? undefined : Number.parseFloat(captured);
}

function kiloBalance(amount: number, reference: number | undefined): Balance {
  const balance = { amount, currency: '$' };
  return reference === undefined ? balance : { ...balance, reference };
}

function parseBalance(stdout: string, rawReference: string | undefined): Balance | undefined {
  const amount = amountIn(stdout);
  return amount === undefined ? undefined : kiloBalance(amount, parseReference(rawReference));
}

export function kiloProbe(env: Record<string, string | undefined>): CliProbe {
  return {
    id: 'kilo',
    planLabel: 'api balance',
    args: ['profile'],
    timeoutMs: 20000,
    reads: 'balance',
    read: (stdout) => ({ windows: [], balance: parseBalance(stdout, env['DANDELION_KILO_REFERENCE']) })
  };
}
