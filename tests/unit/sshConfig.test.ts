import { beforeEach, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFile: execute,
}));

import { resolveSshEndpoint } from '../../src/utility/sshConfig';
import type { SshConfig } from '@drivers/types';

const ssh: SshConfig = {
  enabled: true,
  host: 'work-bastion',
  port: 2222,
  username: 'reader',
  mode: 'agent',
};
beforeEach(() => {
  execute.mockReset();
});

it('uses OpenSSH alias resolution while keeping explicit connection fields', async () => {
  execute.mockImplementation((_file, _args, _options, callback) =>
    callback(null, 'user reader\nhostname bastion.internal\nport 2222\n')
  );
  expect(await resolveSshEndpoint(ssh)).toEqual({
    host: 'bastion.internal',
    port: 2222,
    username: 'reader',
  });
  expect(execute).toHaveBeenCalledWith(
    'ssh',
    ['-G', '-p', '2222', '-l', 'reader', '--', 'work-bastion'],
    expect.objectContaining({ timeout: 5000 }),
    expect.any(Function)
  );
});

it('supports direct hosts when OpenSSH is not installed', async () => {
  execute.mockImplementation((_file, _args, _options, callback) =>
    callback(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  );
  expect(await resolveSshEndpoint(ssh)).toEqual({
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
  });
});

it('reports malformed configuration instead of silently bypassing an alias', async () => {
  execute.mockImplementation((_file, _args, _options, callback) =>
    callback(new Error('Bad configuration'))
  );
  await expect(resolveSshEndpoint(ssh)).rejects.toThrow(
    'could not read the local OpenSSH configuration'
  );
});
