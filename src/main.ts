import { runApp, realIo, type ProbeIo } from './app/index.ts';
import { fileURLToPath } from 'node:url';

export async function main(
  io: ProbeIo,
  env: Record<string, string | undefined>,
  stream: { write(str: string): void },
  nowStr: string
): Promise<void> {
  const output = await runApp(io, env, nowStr);
  stream.write(output + '\n');
}

function isEntry(metaUrl: string, argv1: string | undefined): boolean {
  return fileURLToPath(metaUrl) === argv1;
}

export function runIfMain(metaUrl: string, argv1: string | undefined, io: ProbeIo): Promise<void> {
  if (!isEntry(metaUrl, argv1)) return Promise.resolve();
  return main(io, process.env, process.stdout, new Date().toISOString());
}

await runIfMain(import.meta.url, process.argv[1], realIo);
