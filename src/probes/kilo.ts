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

function parseReference(refEnv: string | undefined): number | undefined {
  if (refEnv === undefined) return 20;
  if (refEnv === '') return undefined;
  return parseFloat(refEnv);
}

function isEnoent(error?: Error): boolean {
  if (!error) return false;
  return error.message.includes('ENOENT');
}

function hasFailed(result: CommandRunnerResult): boolean {
  if (result.code !== 0) return true;
  if (result.error) return true;
  return false;
}

function checkRunnerError(result: CommandRunnerResult): string | undefined {
  if (isEnoent(result.error)) return 'kilo CLI not found in PATH';
  if (result.timedOut) return 'Command timed out after 20s';
  if (hasFailed(result)) return 'Command failed or timed out';
  return undefined;
}

function parseBalance(stdout: string, refEnv: string | undefined): { balance?: Balance; reason?: string } {
  const match = stdout.match(/Balance:\s*\$([0-9.]+)/);
  if (!match) return { reason: 'Could not parse balance from output' };

  const amount = parseFloat(match[1]);
  const reference = parseReference(refEnv);

  const balance: Balance = { amount, currency: '$' };
  if (reference !== undefined) balance.reference = reference;

  return { balance };
}

export async function probeKilo(
  runner: CommandRunner,
  now: string,
  env: Record<string, string | undefined>
): Promise<ProviderUsage> {
  const result = await runner.run('kilo', ['profile'], 20000);
  const baseUsage = { id: 'kilo', displayName: 'kilo', windows: [], fetchedAt: now };

  const errReason = checkRunnerError(result);
  if (errReason) {
    return { ...baseUsage, status: 'unavailable', reason: errReason };
  }

  const { balance, reason } = parseBalance(result.stdout, env['ALLOWANCE_KILO_REFERENCE']);
  if (reason) {
    return { ...baseUsage, status: 'unavailable', reason };
  }

  return { ...baseUsage, balance, status: 'ok' };
}
