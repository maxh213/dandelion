import { ACCOUNT_IDS, type SeatsOutputRequest } from '../render/index.ts';
import { isMaxAge } from './launch.ts';

type SeatsArgs = Omit<SeatsOutputRequest, 'now' | 'zone'> & { maxAge?: number };

type Parsed = { args: SeatsArgs; problem?: undefined } | { args?: undefined; problem: string };

type Tokens = { switches: string[]; values: [string, string][]; positionals: string[]; problems: string[]; maxAge?: string };

const SWITCHES = ['--pack', '--spread', '--json', '--why'];
const VALUED = ['--held', '--include', '--exclude', '--trip', '--cap'];
const NUMBER = /^-?\d+(\.\d+)?$/;
const WHOLE = /^\d+$/;
const MAX_REQUESTED = 200;
const MAX_HELD = 200;
const MAX_CAP = 20;
const MIN_TRIP = 50;
const MAX_TRIP = 90;

function takeValue(args: string[], index: number, tokens: Tokens): number {
  const [flag, value] = [args[index], args[index + 1]];
  if (value === undefined) tokens.problems.push(`${flag} needs a value`);
  else tokens.values.push([flag, value]);
  return index + 2;
}

function takeMaxAge(args: string[], index: number, tokens: Tokens): number {
  const value = args[index + 1];
  if (!NUMBER.test(String(value))) return index + 1;
  tokens.maxAge = value;
  return index + 2;
}

function takeOther(arg: string, index: number, tokens: Tokens): number {
  if (arg.startsWith('-') && !NUMBER.test(arg)) tokens.problems.push(`unknown option ${arg}`);
  else tokens.positionals.push(arg);
  return index + 1;
}

function takeSwitch(arg: string, index: number, tokens: Tokens): number {
  tokens.switches.push(arg);
  return index + 1;
}

function take(args: string[], index: number, tokens: Tokens): number {
  const arg = args[index];
  if (SWITCHES.includes(arg)) return takeSwitch(arg, index, tokens);
  if (arg === '--max-age') return takeMaxAge(args, index, tokens);
  return VALUED.includes(arg) ? takeValue(args, index, tokens) : takeOther(arg, index, tokens);
}

function tokenize(args: string[]): Tokens {
  const tokens: Tokens = { switches: [], values: [], positionals: [], problems: [] };
  let index = 0;
  while (index < args.length) index = take(args, index, tokens);
  return tokens;
}

function isWholeIn(value: string, low: number, high: number): boolean {
  return WHOLE.test(value) && Number(value) >= low && Number(value) <= high;
}

function countProblem({ positionals }: Tokens): string | undefined {
  if (positionals.length === 0) return `missing N, a whole number from 1 to ${MAX_REQUESTED}`;
  if (positionals.length > 1) return `unexpected argument ${positionals[1]}`;
  return isWholeIn(positionals[0], 1, MAX_REQUESTED) ? undefined : `N must be a whole number from 1 to ${MAX_REQUESTED}, not ${positionals[0]}`;
}

function modeProblem({ switches }: Tokens): string | undefined {
  return switches.includes('--pack') && switches.includes('--spread') ? '--pack and --spread cannot be combined' : undefined;
}

function accountProblem(id: string): string | undefined {
  return ACCOUNT_IDS.includes(id) ? undefined : `unknown account ${id}`;
}

function idsProblem(_flag: string, value: string): string | undefined {
  return value.split(',').map(accountProblem).find((problem) => problem !== undefined);
}

function countItemProblem(flag: string, item: string, max: number): string | undefined {
  const match = /^([^=]*)=(.*)$/.exec(item);
  if (match === null) return `${flag} needs <id>=<n>[,<id>=<n>...], not ${item}`;
  const [, id, count] = match;
  return accountProblem(id) ?? (isWholeIn(count, 0, max) ? undefined : `${flag} ${item}: n must be a whole number from 0 to ${max}`);
}

function countsProblem(max: number): (flag: string, value: string) => string | undefined {
  return (flag, value) => value.split(',').map((item) => countItemProblem(flag, item, max)).find((problem) => problem !== undefined);
}

function tripProblem(flag: string, value: string): string | undefined {
  return isWholeIn(value, MIN_TRIP, MAX_TRIP) ? undefined : `${flag} must be a whole percent from ${MIN_TRIP} to ${MAX_TRIP}, not ${value}`;
}

const VALUE_PROBLEMS: Record<string, (flag: string, value: string) => string | undefined> = {
  '--held': countsProblem(MAX_HELD),
  '--cap': countsProblem(MAX_CAP),
  '--include': idsProblem,
  '--exclude': idsProblem,
  '--trip': tripProblem
};

function valuesProblem({ values }: Tokens): string | undefined {
  return values.map(([flag, value]) => VALUE_PROBLEMS[flag](flag, value)).find((problem) => problem !== undefined);
}

function firstProblem(tokens: Tokens): string | undefined {
  return [tokens.problems[0], countProblem(tokens), modeProblem(tokens), valuesProblem(tokens)].find((problem) => problem !== undefined);
}

function valuesOf(tokens: Tokens, flag: string): string[] {
  return tokens.values.filter(([each]) => each === flag).map(([, value]) => value);
}

function countsOf(tokens: Tokens, flag: string): Record<string, number> {
  const items = valuesOf(tokens, flag).flatMap((value) => value.split(','));
  return Object.fromEntries(items.map((item) => item.split('=')).map(([id, count]) => [id, Number(count)]));
}

function idsOf(tokens: Tokens, flag: string): string[] {
  return valuesOf(tokens, flag).flatMap((value) => value.split(','));
}

function numberOf(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function seatsArgsOf(tokens: Tokens): SeatsArgs {
  const switches = new Set(tokens.switches);
  return {
    mode: switches.has('--spread') ? 'spread' : 'pack',
    requested: Number(tokens.positionals[0]),
    json: switches.has('--json'),
    why: switches.has('--why'),
    held: countsOf(tokens, '--held'),
    cap: countsOf(tokens, '--cap'),
    include: idsOf(tokens, '--include'),
    exclude: idsOf(tokens, '--exclude'),
    trip: numberOf(valuesOf(tokens, '--trip').at(-1)),
    maxAge: isMaxAge(tokens.maxAge) ? Number(tokens.maxAge) : undefined
  };
}

export function parseSeatsArgs(args: string[]): Parsed {
  const tokens = tokenize(args);
  const problem = firstProblem(tokens);
  return problem === undefined ? { args: seatsArgsOf(tokens) } : { problem };
}
