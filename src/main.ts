#!/usr/bin/env node
import { isEntryFile, runApp, runLive, runRoute, realIo, type Keyboard, type ProbeIo, type Screen } from './app/index.ts';

type Terminal = { isTTY?: boolean };

type Proc = {
  argv: string[];
  env: Record<string, string | undefined>;
  stdin: Keyboard & Terminal;
  stdout: Screen & Terminal;
  exit(code: number): void;
};

export async function main(
  io: ProbeIo,
  env: Record<string, string | undefined>,
  stream: { write(str: string): void },
  nowStr: string
): Promise<void> {
  const output = await runApp(io, env, nowStr);
  stream.write(output + '\n');
}

async function route(io: ProbeIo, proc: Proc): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const line = await runRoute(io, proc.env, new Date().toISOString(), zone);
  proc.stdout.write(`${line}\n`);
  if (line === 'none') proc.exit(1);
}

function isLive(proc: Proc): boolean {
  return !proc.argv.includes('--once') && proc.stdin.isTTY === true && proc.stdout.isTTY === true;
}

async function live(io: ProbeIo, proc: Proc): Promise<void> {
  await runLive(io, proc.env, proc.stdin, proc.stdout);
  proc.exit(0);
}

export function runIfMain(metaUrl: string, argv1: string, io: ProbeIo, proc: Proc): Promise<void> {
  if (!isEntryFile(metaUrl, argv1)) return Promise.resolve();
  if (proc.argv[2] === 'route') return route(io, proc);
  if (isLive(proc)) return live(io, proc);
  return main(io, proc.env, proc.stdout, new Date().toISOString());
}

await runIfMain(import.meta.url, process.argv[1], realIo, process);
