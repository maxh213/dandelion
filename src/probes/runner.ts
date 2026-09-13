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
