#!/usr/bin/env node
import { isEntryFile, processZone, routesWarning, runApp, runJson, runLive, runRoute, runRun, realIo, realRunSpawner, type Keyboard, type ProbeIo, type RouteMode, type Screen } from './app/index.ts';

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

const POSITIVE_INTEGER = /^[1-9]\d*$/;

function maxAgeOf(args: string[]): number | undefined {
  const value = args[args.indexOf('--max-age') + 1];
  return args.includes('--max-age') && POSITIVE_INTEGER.test(String(value)) ? Number(value) : undefined;
}

async function route(io: ProbeIo, proc: Proc): Promise<void> {
  const { out, err, code } = await runRoute(io, proc.env, { mode: routeModeOf(proc.argv), now: new Date().toISOString(), zone: processZone(), why: proc.argv.slice(3).includes('--why'), maxAge: maxAgeOf(proc.argv.slice(3)) });
  proc.stdout.write(out);
  proc.stderr.write(err);
  if (code !== 0) proc.exit(code);
}

async function json(io: ProbeIo, proc: Proc): Promise<void> {
  const { out, err } = await runJson(io, proc.env, { now: new Date().toISOString(), zone: processZone(), maxAge: maxAgeOf(proc.argv.slice(2)) });
  proc.stdout.write(out);
  proc.stderr.write(err);
}

async function run(io: ProbeIo, proc: Proc): Promise<void> {
  const { err, code } = await runRun(io, proc.env, { mode: runModeOf(proc.argv.slice(3)), now: new Date().toISOString(), zone: processZone() }, proc.argv.slice(3), realRunSpawner);
  proc.stderr.write(err);
  proc.exit(code);
}

function runModeOf(args: string[]): RouteMode {
  const split = args.indexOf('--');
  return (split === -1 ? args : args.slice(0, split)).includes('--high') ? 'high' : 'headroom';
}

function isLive(proc: Proc): boolean {
  return !proc.argv.includes('--once') && proc.stdin.isTTY === true && proc.stdout.isTTY === true;
}

async function live(io: ProbeIo, proc: Proc): Promise<void> {
  proc.exit(await runLive(io, proc.env, proc.stdin, proc.stdout));
}

const USAGE = [
  'Usage: dandelion [command]',
  '',
  '  dandelion               live dashboard (re-probes every DANDELION_REFRESH_SECONDS)',
  '  dandelion --once        run every probe once, print the dashboard and exit',
  '  dandelion route         print the subscription to use right now',
  '  dandelion route --high  print the strongest model that still has quota',
  '  dandelion --help        print this usage',
  '',
  'See README.md for keys, environment variables and the other commands.',
  ''
].join('\n');

async function help(_io: ProbeIo, proc: Proc): Promise<void> {
  proc.stdout.write(USAGE);
}

async function unknown(_io: ProbeIo, proc: Proc): Promise<void> {
  proc.stderr.write(`dandelion: unknown command ${proc.argv[2]}\n${USAGE}`);
  proc.exit(2);
}

const SUBCOMMANDS = new Map([['route', route], ['run', run], ['help', help], ['--help', help], ['-h', help]]);

function isUnknownCommand(argv: string[]): boolean {
  return argv.length > 2 && !argv[2].startsWith('-');
}

function modeOf(proc: Proc): (io: ProbeIo, proc: Proc) => Promise<void> {
  if (proc.argv.includes('--json')) return json;
  if (isUnknownCommand(proc.argv)) return unknown;
  return isLive(proc) ? live : (io, p) => main(io, p.env, p, new Date().toISOString());
}

export function runIfMain(metaUrl: string, argv1: string, io: ProbeIo, proc: Proc): Promise<void> {
  if (!isEntryFile(metaUrl, argv1)) return Promise.resolve();
  return (SUBCOMMANDS.get(proc.argv[2]) ?? modeOf(proc))(io, proc);
}

await runIfMain(import.meta.url, process.argv[1], realIo, process);
