export type Launch = { command: string; args: string[]; env: Record<string, string> };

export type RunSpawner = { spawn(launch: Launch): Promise<number | 'missing'> };

type Env = Record<string, string | undefined>;

type Target = { command: string; modelFlag: string; effortFlag?: string };

const TARGETS: Record<string, Target> = {
  claude: { command: 'claude', modelFlag: '--model', effortFlag: '--effort' },
  'claude-work': { command: 'claude', modelFlag: '--model', effortFlag: '--effort' },
  'claude-deepseek': { command: 'claude', modelFlag: '--model', effortFlag: '--effort' },
  agy: { command: 'agy', modelFlag: '--model' },
  kimi: { command: 'kimi', modelFlag: '--model' },
  grok: { command: 'grok', modelFlag: '--model' },
  cursor: { command: 'cursor-agent', modelFlag: '--model' },
  junie: { command: 'junie', modelFlag: '--model' },
  hermes: { command: 'hermes', modelFlag: '--model' }
};

function claudeConfig(env: Env, homeDir: string, name: string, fallback: string): Record<string, string> {
  return { CLAUDE_CONFIG_DIR: env[name] || `${homeDir}/${fallback}` };
}

function accountEnv(account: string, env: Env, homeDir: string): Record<string, string> {
  if (account === 'claude-work') return claudeConfig(env, homeDir, 'DANDELION_CLAUDE_WORK_CONFIG_DIR', '.claude-work');
  if (account === 'claude-deepseek') return claudeConfig(env, homeDir, 'DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR', '.claude-deepseek');
  return {};
}

function flagsOf({ modelFlag, effortFlag }: Target, model: string, effort: string | undefined): string[] {
  const flags = [modelFlag, model];
  if (effortFlag !== undefined && effort !== undefined) flags.push(effortFlag, effort);
  return flags;
}

export function launchOf(routeLine: string, extra: string[], env: Env, homeDir: string): Launch {
  const [model, ...rest] = routeLine.split(' ');
  const account = rest.pop() as string;
  const target = TARGETS[account];
  return { command: target.command, args: [...flagsOf(target, model, rest[0]), ...extra], env: accountEnv(account, env, homeDir) };
}

export function extraArgs(args: string[]): string[] {
  const split = args.indexOf('--');
  const before = (split === -1 ? args : args.slice(0, split)).filter((arg) => arg !== '--high');
  return split === -1 ? before : [...before, ...args.slice(split + 1)];
}
