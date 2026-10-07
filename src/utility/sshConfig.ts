import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SshConfig } from '@drivers/types';

export function expandHome(path: string): string {
  return path === '~'
    ? homedir()
    : path.startsWith('~/')
      ? join(homedir(), path.slice(2))
      : path;
}

/** OpenSSH resolves Host aliases and Includes without opening a connection. */
export async function resolveSshEndpoint(ssh: SshConfig): Promise<{
  host: string;
  port: number;
  username: string;
}> {
  const fallback = { host: ssh.host, port: ssh.port || 22, username: ssh.username };
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'ssh',
        ['-G', '-p', String(fallback.port), '-l', ssh.username, '--', ssh.host],
        { timeout: 5_000, maxBuffer: 1024 * 1024 },
        (error, output) => (error ? reject(error) : resolve(output))
      );
    });
    const hostname = stdout.split('\n').find((line) => line.startsWith('hostname '));
    return { ...fallback, host: hostname?.slice('hostname '.length).trim() || ssh.host };
  } catch (error) {
    // ssh2 still supports direct hosts on machines without the OpenSSH CLI.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error('SSH tunnel: could not read the local OpenSSH configuration.');
  }
}
