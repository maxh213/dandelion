import { runApp, RealCommandRunner } from './app/wiring.ts';
import { fileURLToPath } from 'url';

export async function main(
  env: Record<string, string | undefined>,
  stream: { write(str: string): void },
  nowStr: string
): Promise<void> {
  const runner = new RealCommandRunner();
  const output = await runApp(runner, env, nowStr);
  stream.write(output + '\n');
}

export function runIfMain(metaUrl: string, argv1: string | undefined): void {
  if (argv1 && fileURLToPath(new URL(metaUrl.split('?')[0])).replace(/\.ts$/, '.js').endsWith(argv1.replace(/\.ts$/, '.js'))) {
    main(process.env, process.stdout, new Date().toISOString()).catch(console.error);
  }
}

runIfMain(import.meta.url, process.argv[1]);
