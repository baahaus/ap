import { createInterface, Interface } from 'node:readline';

export interface InputOptions {
  prompt?: string;
  multiline?: boolean;
}

export function createInput(): {
  readline: Interface;
  getLine: (prompt?: string) => Promise<string>;
  close: () => void;
} {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  function getLine(prompt = '> '): Promise<string> {
    return new Promise((resolve) => {
      readline.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  function close(): void {
    readline.close();
  }

  return { readline, getLine, close };
}

export function isCommand(input: string): boolean {
  return input.startsWith('/');
}

export function parseCommand(input: string): { name: string; args: string } {
  const trimmed = input.slice(1).trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { name: trimmed, args: '' };
  }
  return {
    name: trimmed.slice(0, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}
