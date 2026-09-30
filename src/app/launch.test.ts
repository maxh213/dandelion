import { describe, it, expect } from 'vitest';
import { extraArgs, launchOf } from './launch.ts';

describe('launchOf', () => {
  it('omits the effort flag when a claude line has no effort', () => {
    expect(launchOf('model-x claude', ['-p'], {}, '/h')).toEqual({ command: 'claude', args: ['--model', 'model-x', '-p'], env: {} });
  });

  it.each([['cursor', 'cursor-agent'], ['agy', 'agy'], ['kimi', 'kimi'], ['grok', 'grok'], ['junie', 'junie'], ['hermes', 'hermes']])('runs %s as %s with the model only', (account, command) => {
    expect(launchOf(`model-x high ${account}`, [], {}, '/h')).toEqual({ command, args: ['--model', 'model-x'], env: {} });
  });
});

describe('extraArgs', () => {
  it('drops --high before -- and keeps everything after it', () => {
    expect(extraArgs(['a', '--high', '--', '--high', 'b'])).toEqual(['a', '--high', 'b']);
    expect(extraArgs(['--high', 'a'])).toEqual(['a']);
  });
});
