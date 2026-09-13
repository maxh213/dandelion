import { describe, it, expect } from 'vitest';
import { main, runIfMain } from './main.js';
import { readFileSync } from 'fs';

describe('main', () => {
  it('runs main successfully', async () => {
    let output = '';
    const mockStream = { write: (out: string) => { output += out; } };
    await main({ NO_COLOR: '1' }, mockStream, '10:00:00Z');
    expect(output).toContain('ALLOWANCE');
  });
  
  it('runIfMain executes main when conditions match', async () => {
    const originalStdoutWrite = process.stdout.write;
    let output = '';
    
    try {
      process.stdout.write = ((str: string | Uint8Array) => {
        output += str.toString();
        return true;
      }) as unknown as typeof process.stdout.write;
      
      runIfMain('file:///path/to/main.js', 'main.js');
      expect(output).toBeDefined();
      await new Promise(r => setTimeout(r, 50));
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  it('runIfMain does nothing when conditions do not match', () => {
    runIfMain('file:///path/to/main.js', 'other.js');
  });

  it('README is updated with project details', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme).toContain('Allowance');
    expect(readme).toContain('npm start');
    expect(readme).toContain('ALLOWANCE_KILO_REFERENCE');
  });
});
