export type Tokens = { switches: string[]; values: [string, string][]; positionals: string[]; problems: string[]; maxAge?: string };

type Grammar = { switches: readonly string[]; valued: readonly string[] };

const NUMBER = /^-?\d+(\.\d+)?$/;

function takeSwitch(arg: string, index: number, tokens: Tokens): number {
  tokens.switches.push(arg);
  return index + 1;
}

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

function take(args: string[], index: number, tokens: Tokens, grammar: Grammar): number {
  const arg = args[index];
  if (grammar.switches.includes(arg)) return takeSwitch(arg, index, tokens);
  if (arg === '--max-age') return takeMaxAge(args, index, tokens);
  return grammar.valued.includes(arg) ? takeValue(args, index, tokens) : takeOther(arg, index, tokens);
}

export function tokenize(args: string[], grammar: Grammar): Tokens {
  const tokens: Tokens = { switches: [], values: [], positionals: [], problems: [] };
  let index = 0;
  while (index < args.length) index = take(args, index, tokens, grammar);
  return tokens;
}

export function valuesOf(tokens: Tokens, flag: string): string[] {
  return tokens.values.filter(([each]) => each === flag).map(([, value]) => value);
}
