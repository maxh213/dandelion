import { describe, it, expect } from 'vitest';
import { extraArgs, isMaxAge, launchOf } from './launch.ts';

describe('launchOf', () => {
  it('omits the effort flag when a claude line has no effort', () => {
    expect(launchOf('model-x claude', ['-p'], {}, '/h')).toEqual({ command: 'claude', args: ['--model', 'model-x', '-p'], env: {} });
  });

  it('runs claude-deepseek with the model, effort and config dir', () => {
    expect(launchOf('deepseek/deepseek-v4.1-flash max claude-deepseek', [], { DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR: '/cfg/deepseek' }, '/h')).toEqual({
      command: 'claude',
      args: ['--model', 'deepseek/deepseek-v4.1-flash', '--effort', 'max'],
      env: { CLAUDE_CONFIG_DIR: '/cfg/deepseek' }
    });
  });

  it('defaults the claude-deepseek config dir when the env var is unset or empty', () => {
    const launch = { command: 'claude', args: ['--model', 'vendor/model-o', '--effort', 'max'], env: { CLAUDE_CONFIG_DIR: '/h/.claude-deepseek' } };
    expect(launchOf('vendor/model-o max claude-deepseek', [], {}, '/h')).toEqual(launch);
    expect(launchOf('vendor/model-o max claude-deepseek', [], { DANDELION_CLAUDE_DEEPSEEK_CONFIG_DIR: '' }, '/h')).toEqual(launch);
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

  it('drops --max-age and a valid value before -- only', () => {
    expect(extraArgs(['--max-age', '600', 'a', '--', '--max-age', '600'])).toEqual(['a', '--max-age', '600']);
    expect(extraArgs(['a', '--max-age', '0', '--max-age'])).toEqual(['a']);
    expect(extraArgs(['--max-age', '--high', 'a'])).toEqual(['a']);
    expect(extraArgs(['--max-age', 'abc', 'a'])).toEqual(['abc', 'a']);
    expect(extraArgs(['--max-age', '0', '--max-age', '600', 'a'])).toEqual(['a']);
  });

  it.each(['0', '-5', '1.5', '600'])('drops the numeric --max-age value %s', (value) => {
    expect(extraArgs(['--max-age', value, 'a'])).toEqual(['a']);
  });
});

describe('isMaxAge', () => {
  it.each([['1', true], ['600', true], ['0', false], ['-5', false], ['1.5', false], ['abc', false], [undefined, false]])('%s is %s', (value, expected) => {
    expect(isMaxAge(value)).toBe(expected);
  });
});
