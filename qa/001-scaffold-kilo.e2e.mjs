import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile, chmod, rm } from 'fs/promises';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function() {
  const rootDir = join(__dirname, '..');
  const fixtureDir = join(__dirname, 'fixture_kilo');
  
  await mkdir(fixtureDir, { recursive: true });
  const kiloMock = join(fixtureDir, 'kilo');
  await writeFile(kiloMock, `#!/bin/sh\nconsole="Name: Max\\nEmail: yeti213@googlemail.com\\nTeam: Personal\\nBalance: \\$14.15"\necho "$console"\n`);
  await chmod(kiloMock, 0o755);
  
  try {
    const envWithKilo = { ...process.env, PATH: `${fixtureDir}:${process.env.PATH}`, NO_COLOR: '1' };
    const { stdout } = await exec(process.execPath, ['src/main.ts'], { cwd: rootDir, env: envWithKilo });
    
    if (!stdout.includes('ALLOWANCE')) throw new Error('Missing ALLOWANCE');
    if (!stdout.includes('kilo')) throw new Error('Missing kilo');
    if (!stdout.includes('$14.15')) throw new Error('Missing $14.15');
    
    const envEmptyPath = { ...process.env, PATH: '', NO_COLOR: '1' };
    const { stdout: stdoutEmpty } = await exec(process.execPath, ['src/main.ts'], { cwd: rootDir, env: envEmptyPath });
    
    if (!stdoutEmpty.includes('ALLOWANCE')) throw new Error('Missing ALLOWANCE (empty path)');
    if (!stdoutEmpty.includes('kilo CLI not found in PATH') && !stdoutEmpty.includes('Command failed')) {
      throw new Error('Missing unavailable reason');
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}
