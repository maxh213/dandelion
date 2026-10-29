import type { HeadlessTemplate } from '../render/index.ts';
import { tokenize, valuesOf, type Tokens } from './args.ts';

export type Launch = { command: string; args: string[]; env: Record<string, string> };

export type HeadlessLaunch = Launch & { cwd: string; stdin?: string; timeoutMs?: number };

export type HeadlessSpawner = { spawn(launch: HeadlessLaunch): Promise<number | 'missing' | 'timeout'> };

export type Prompt = { path: string; text: string; bytes: number };

export type RunSpawner = { spawn(launch: Launch): Promise<number | 'missing'> };

type Env = Record<string, string | undefined>;

type Target = { command: string; modelFlag: string; effortFlag?: string; effortConfig?: string };

const TARGETS: Record<string, Target> = {
  claude: { command: 'claude', modelFlag: '--model', effortFlag: '--effort' },
  'claude-work': { command: 'claude', modelFlag: '--model', effortFlag: '--effort' },
  'claude-animus': { command: 'claude', modelFlag: '--model', effortFlag: '--effort' },
  'claude-deepseek': { command: 'claude', modelFlag: '--model', effortFlag: '--effort' },
  'claude-ollama': { command: 'claude', modelFlag: '--model', effortFlag: '--effort' },
  agy: { command: 'agy', modelFlag: '--model' },
  kimi: { command: 'kimi', modelFlag: '--model' },
  grok: { command: 'grok', modelFlag: '--model' },
  codex: { command: 'codex', modelFlag: '--model', effortConfig: 'model_reasoning_effort' },
  'codex-animus': { command: 'codex', modelFlag: '--model', effortConfig: 'model_reasoning_effort' },
  cursor: { command: 'cursor-agent', modelFlag: '--model' },
  junie: { command: 'junie', modelFlag: '--model' },
  hermes: { command: 'hermes', modelFlag: '--model' },
  kilo: { command: 'kilo', modelFlag: '--model', effortFlag: '--variant' }
};

type AccountHome = { variable: string; name: string; fallback: string };

const ACCOUNT_HOMES: Record<string, AccountHome> = {
  'claude-work': { variable: 'CLAUDE_CONFIG_DIR', name: 'DANDELION_CLAUDE_WORK_CONFIG_DIR', fallback: '.claude-work' },
  'claude-animus': { variable: 'CLAUDE_CONFIG_DIR', name: 'DANDELION_CLAUDE_ANIMUS_CONFIG_DIR', fallback: '.claude-animus' },
  'claude-deepseek': { variable: 'CLAUDE_CONFIG_DIR', name: 'DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR', fallback: '.claude-deepseek' },
  'claude-ollama': { variable: 'CLAUDE_CONFIG_DIR', name: 'DANDELION_CLAUDE_OLLAMA_CONFIG_DIR', fallback: '.claude-ollama' },
  'codex-animus': { variable: 'CODEX_HOME', name: 'DANDELION_CODEX_ANIMUS_HOME', fallback: '.codex-animus' }
};

function accountEnv(account: string, env: Env, homeDir: string): Record<string, string> {
  const home = ACCOUNT_HOMES[account];
  if (home === undefined) return {};
  return { [home.variable]: env[home.name] || `${homeDir}/${home.fallback}` };
}

function effortFlags({ effortFlag, effortConfig }: Target, effort: string | undefined): string[] {
  if (effort === undefined) return [];
  if (effortConfig !== undefined) return ['-c', `${effortConfig}=${effort}`];
  return effortFlag === undefined ? [] : [effortFlag, effort];
}

function flagsOf(target: Target, model: string, effort: string | undefined): string[] {
  return [target.modelFlag, model, ...effortFlags(target, effort)];
}

export function launchOf(routeLine: string, extra: string[], env: Env, homeDir: string): Launch {
  const [model, ...rest] = routeLine.split(' ');
  const account = rest.pop() as string;
  const target = TARGETS[account];
  return { command: target.command, args: [...flagsOf(target, model, rest[0]), ...extra], env: accountEnv(account, env, homeDir) };
}

const POSITIVE_INTEGER = /^[1-9]\d*$/;

export function isMaxAge(value: string | undefined): boolean {
  return POSITIVE_INTEGER.test(String(value));
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function withoutMaxAge(args: string[]): string[] {
  return args.filter((arg, index) => arg !== '--max-age' && !(args[index - 1] === '--max-age' && NUMBER.test(arg)));
}

export function extraArgs(args: string[]): string[] {
  const split = args.indexOf('--');
  const before = withoutMaxAge(split === -1 ? args : args.slice(0, split)).filter((arg) => arg !== '--high');
  return split === -1 ? before : [...before, ...args.slice(split + 1)];
}

export type HeadlessArgs = { seat?: string; promptFile: string; cwd: string; timeoutMs?: number; high: boolean; maxAge?: number };

type ParsedHeadless = { args: HeadlessArgs; problem?: undefined } | { args?: undefined; problem: string };

const HEADLESS_GRAMMAR = { switches: ['--headless', '--high'], valued: ['--seat', '--prompt-file', '--cwd', '--timeout'] };
const REQUIRED = ['--prompt-file', '--cwd'];
const SEAT = /^\S+( \S+)? (\S+)$/;
const PROMPT_LIMIT_BYTES = 120000;
const MS_PER_SECOND = 1000;

function lastValue(tokens: Tokens, flag: string): string | undefined {
  return valuesOf(tokens, flag).at(-1);
}

function positionalProblem({ positionals }: Tokens): string | undefined {
  return positionals.length === 0 ? undefined : `unexpected argument ${positionals[0]}`;
}

function requiredProblem(tokens: Tokens): string | undefined {
  const missing = REQUIRED.find((flag) => lastValue(tokens, flag) === undefined);
  return missing === undefined ? undefined : `${missing} is required`;
}

function timeoutProblem(tokens: Tokens): string | undefined {
  const timeout = lastValue(tokens, '--timeout');
  return timeout === undefined || isMaxAge(timeout) ? undefined : `--timeout must be a positive whole number of seconds, not ${timeout}`;
}

function seatProblem(tokens: Tokens): string | undefined {
  const seat = lastValue(tokens, '--seat');
  if (seat === undefined) return undefined;
  const match = SEAT.exec(seat);
  if (match === null) return `--seat "${seat}" is not "<model> [effort] <account>"`;
  return Object.hasOwn(TARGETS, match[2]) ? undefined : `unknown account ${match[2]}`;
}

function millisecondsOf(seconds: string | undefined): number | undefined {
  return seconds === undefined ? undefined : Number(seconds) * MS_PER_SECOND;
}

function headlessArgsOf(tokens: Tokens): HeadlessArgs {
  return {
    seat: lastValue(tokens, '--seat'),
    promptFile: String(lastValue(tokens, '--prompt-file')),
    cwd: String(lastValue(tokens, '--cwd')),
    timeoutMs: millisecondsOf(lastValue(tokens, '--timeout')),
    high: tokens.switches.includes('--high'),
    maxAge: isMaxAge(tokens.maxAge) ? Number(tokens.maxAge) : undefined
  };
}

export function parseHeadlessArgs(args: string[]): ParsedHeadless {
  const tokens = tokenize(args, HEADLESS_GRAMMAR);
  const problem = [tokens.problems[0], positionalProblem(tokens), requiredProblem(tokens), timeoutProblem(tokens), seatProblem(tokens)].find((each) => each !== undefined);
  return problem === undefined ? { args: headlessArgsOf(tokens) } : { problem };
}

export function promptProblem(command: string, template: HeadlessTemplate, prompt: Prompt): string | undefined {
  const inline = template.after.some((arg) => arg.includes('{prompt}'));
  return inline && prompt.bytes > PROMPT_LIMIT_BYTES ? `prompt too long for ${command}; use a stdin or {promptFile} template` : undefined;
}

function filled(arg: string, prompt: Prompt): string {
  return arg.replace(/\{prompt(File)?\}/g, (_match, file: string | undefined) => (file === undefined ? prompt.text : prompt.path));
}

export function headlessLaunchOf(launch: Launch, template: HeadlessTemplate, prompt: Prompt, where: { cwd: string; timeoutMs?: number }): HeadlessLaunch {
  return {
    command: launch.command,
    args: [...template.before, ...launch.args, ...template.after.map((arg) => filled(arg, prompt))],
    env: launch.env,
    cwd: where.cwd,
    stdin: template.stdin ? prompt.path : undefined,
    timeoutMs: where.timeoutMs
  };
}
