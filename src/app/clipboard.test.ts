import { describe, expect, it, vi } from 'vitest';
import { openClipboard } from './clipboard.ts';

function setup(available: string[], writeFails = false) {
  const tried: string[][] = [];
  const write = vi.fn((_text: string) => {
    if (writeFails) throw new Error('closed');
  });
  const tryCommand = async (command: string, args: string[], input: string) => {
    tried.push([command, ...args, input]);
    return available.includes(command);
  };
  return { tried, write, clipboard: openClipboard({ tryCommand, write }) };
}

describe('clipboard', () => {
  it('uses wl-copy first and nothing else when it works', async () => {
    const { clipboard, tried, write } = setup(['wl-copy', 'xclip']);
    expect(await clipboard.copy('m high claude')).toBe(true);
    expect(tried).toEqual([['wl-copy', 'm high claude']]);
    expect(write).not.toHaveBeenCalled();
  });

  it('falls back to xclip -selection clipboard', async () => {
    const { clipboard, tried, write } = setup(['xclip']);
    expect(await clipboard.copy('m high claude')).toBe(true);
    expect(tried).toEqual([['wl-copy', 'm high claude'], ['xclip', '-selection', 'clipboard', 'm high claude']]);
    expect(write).not.toHaveBeenCalled();
  });

  it('falls back to an OSC 52 sequence on the screen', async () => {
    const { clipboard, write } = setup([]);
    expect(await clipboard.copy('m high claude')).toBe(true);
    expect(write).toHaveBeenCalledWith(`\x1b]52;c;${Buffer.from('m high claude').toString('base64')}\x07`);
  });

  it('reports failure when the screen write throws too', async () => {
    const { clipboard } = setup([], true);
    expect(await clipboard.copy('x')).toBe(false);
  });
});
