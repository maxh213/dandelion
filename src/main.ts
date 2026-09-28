#!/usr/bin/env node
import { isEntryFile, processZone, routesWarning, runApp, runLive, runRoute, realIo, type Keyboard, type ProbeIo, type RouteMode, type Screen } from './app/index.ts';

type Terminal = { isTTY?: boolean };

type Stream = { write(str: string): unknown };

type Streams = { stdout: Stream; stderr: Stream };

type Proc = Streams & {
  argv: string[];
  env: Record<string, string | undefined>;
  stdin: Keyboard & Terminal;
  stdout: Screen & Terminal;
  exit(code: number): void;
};

export async function main(io: ProbeIo, env: Record<string, string | undefined>, streams: Streams, nowStr: string): Promise<void> {
  const output = await runApp(io, env, nowStr);
  streams.stdout.write(output + '\n');
  streams.stderr.write(routesWarning(env));
}

function routeModeOf(argv: string[]): RouteMode {
  return argv.slice(3).includes('--high') ? 'high' : 'headroom';
}

async function route(io: ProbeIo, proc: Proc): Promise<void> {
  const { out, err, code } = await runRoute(io, proc.env, { mode: routeModeOf(proc.argv), now: new Date().toISOString(), zone: processZone() });
  proc.stdout.write(out);
  proc.stderr.write(err);
  if (code !== 0) proc.exit(code);
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
  return main(io, proc.env, proc, new Date().toISOString());
}

await runIfMain(import.meta.url, process.argv[1], realIo, process);
