import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runQa() {
  const files = await readdir(__dirname);
  const e2eFiles = files.filter(f => f.endsWith('.e2e.mjs'));
  
  let failed = false;
  for (const file of e2eFiles) {
    console.log(`Running ${file}...`);
    try {
      const mod = await import(join(__dirname, file));
      await mod.default();
      console.log(`PASS: ${file}`);
    } catch (e) {
      console.error(`FAIL: ${file}`, e);
      failed = true;
    }
  }
  
  if (failed) {
    process.exit(1);
  } else {
    console.log('All QA tests passed.');
  }
}

runQa().catch((e) => {
  console.error(e);
  process.exit(1);
});
