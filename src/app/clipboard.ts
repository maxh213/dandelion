export interface Clipboard {
  copy(text: string): Promise<boolean>;
}

export type CommandTry = (command: string, args: string[], input: string) => Promise<boolean>;

type ClipboardDeps = { tryCommand: CommandTry; write(text: string): unknown };

const COMMANDS: [string, string[]][] = [
  ['wl-copy', []],
  ['xclip', ['-selection', 'clipboard']]
];

function osc52(text: string): string {
  return `\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`;
}

async function firstCommand(tryCommand: CommandTry, text: string): Promise<boolean> {
  for (const [command, args] of COMMANDS) if (await tryCommand(command, args, text)) return true;
  return false;
}

export function openClipboard({ tryCommand, write }: ClipboardDeps): Clipboard {
  return {
    async copy(text) {
      if (await firstCommand(tryCommand, text)) return true;
      try {
        write(osc52(text));
      } catch {
        return false;
      }
      return true;
    }
  };
}
