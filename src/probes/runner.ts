export type RunFailure = 'missing' | 'timeout' | 'exit';

export type CommandRunnerResult = {
  stdout: string;
  stderr: string;
  failure?: RunFailure;
};

export interface CommandRunner {
  run(command: string, args: string[], timeoutMs: number): Promise<CommandRunnerResult>;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected run failure: ${String(value)}`);
}

export function runFailureReason(command: string, timeoutMs: number, failure: RunFailure): string {
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
