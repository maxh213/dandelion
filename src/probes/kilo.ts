import type { Balance } from '../domain/index.ts';
import type { CliProbe } from './cli.ts';

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
  const amount = Number.parseFloat(match[1]);
  const reference = parseReference(rawReference);
  return reference === undefined ? { amount, currency: '$' } : { amount, currency: '$', reference };
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
