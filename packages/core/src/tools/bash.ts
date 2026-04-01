import { Type, type Static } from '@sinclair/typebox';
import { spawn } from 'node:child_process';

export const BashParams = Type.Object({
  command: Type.String({ description: 'The shell command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in milliseconds', default: 120000 })),
});

export type BashParams = Static<typeof BashParams>;

export async function bash(params: BashParams): Promise<string> {
  const { command, timeout = 120000 } = params;

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      cwd: process.cwd(),
      timeout,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      let result = '';
      if (stdout) result += stdout;
      if (stderr) result += (result ? '\n' : '') + stderr;
      if (code !== 0) {
        result += (result ? '\n' : '') + `Exit code: ${code}`;
      }
      resolve(result || '(no output)');
    });

    proc.on('error', (err) => {
      resolve(`Error executing command: ${err.message}`);
    });
  });
}

export const bashTool = {
  name: 'bash',
  description: 'Execute a shell command and return its output.',
  input_schema: BashParams,
  execute: bash,
};
