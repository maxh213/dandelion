import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function() {
  const readme = await readFile(join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /Allowance/i);
  assert.match(readme, /npm start/);
  assert.match(readme, /ALLOWANCE_KILO_REFERENCE/);
}
