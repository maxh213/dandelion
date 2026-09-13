import { runApp, RealCommandRunner } from './app/wiring.ts';
import { fileURLToPath } from 'url';

type CommandRunner = Parameters<typeof runApp>[0];

export async function main(
  runner: CommandRunner,
  env: Record<string, string | undefined>,
  stream: { write(str: string): void },
  nowStr: string
): Promise<void> {
  const output = await runApp(runner, env, nowStr);
  stream.write(output + '\n');
}

function isEntry(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  return fileURLToPath(metaUrl).replace(/\.ts$/, '.js').endsWith(argv1.replace(/\.ts$/, '.js'));
}

export function runIfMain(metaUrl: string, argv1: string | undefined, runner: CommandRunner): Promise<void> {
  if (!isEntry(metaUrl, argv1)) return Promise.resolve();
  return main(runner, process.env, process.stdout, new Date().toISOString());
}

await runIfMain(import.meta.url, process.argv[1], new RealCommandRunner());
