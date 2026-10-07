import { generateKeyPairSync } from 'node:crypto';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import { Server } from 'ssh2';
import { expect, it } from 'vitest';
import { openTunnel } from '../../src/utility/tunnel';
import { expandHome } from '../../src/utility/sshConfig';
import type { ConnectionConfig } from '@drivers/types';

it('expands home-directory key paths', () => {
  expect(expandHome('~/.ssh/id_ed25519')).toBe(`${homedir()}/.ssh/id_ed25519`);
  expect(expandHome('/keys/private')).toBe('/keys/private');
});

it('authenticates, forwards the database destination, and closes active SSH sockets', async () => {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem',
  });
  const clients = new Set<{ end(): void }>();
  let requested: { destIP: string; destPort: number } | undefined;
  const server = new Server({ hostKeys: [key] }, (client) => {
    clients.add(client);
    client.on('error', () => undefined);
    client.on('authentication', (context) => {
      if (
        context.method === 'password' &&
        context.username === 'test' &&
        context.password === 'test-password'
      )
        context.accept();
      else context.reject();
    });
    client.on('ready', () =>
      client.on('tcpip', (accept, _reject, info) => {
        requested = info;
        const stream = accept();
        stream.on('data', (data: Buffer) => stream.write(data));
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No SSH port');
  const config = {
    engine: 'postgres',
    host: 'database.internal',
    port: 5432,
    ssh: {
      enabled: true,
      host: '127.0.0.1',
      port: address.port,
      username: 'test',
      mode: 'password',
      password: 'test-password',
    },
  } as ConnectionConfig;
  const socket = new Socket();
  const tunnel = await openTunnel(config);
  try {
    const response = new Promise<string>((resolve, reject) => {
      socket.once('data', (data) => resolve(data.toString()));
      socket.once('error', reject);
    });
    socket.connect(tunnel!.port, tunnel!.host, () => socket.write('ping'));
    expect(await response).toBe('ping');
    expect(requested).toMatchObject({ destIP: 'database.internal', destPort: 5432 });
    await tunnel!.close();
    await expect(
      new Promise<void>((resolve) => {
        if (socket.destroyed) resolve();
        else socket.once('close', () => resolve());
      })
    ).resolves.toBeUndefined();
  } finally {
    socket.destroy();
    await tunnel!.close();
    for (const client of clients) client.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
