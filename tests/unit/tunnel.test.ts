import { createServer, Socket, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { openTunnel, through } from '../../src/utility/tunnel';
import type { ConnectionConfig } from '@drivers/types';

/**
 * The SOCKS5 handshake, against a proxy that answers the way the RFC says.
 *
 * Worth testing rather than trusting: it is a byte protocol written by hand, and
 * the failure mode of getting a length prefix wrong is a socket that hangs — not
 * an exception, and not something a driver can report usefully.
 */

const open: { close(): void }[] = [];

afterEach(() => {
  for (const item of open.splice(0)) item.close();
});

/** A proxy that accepts anonymous CONNECT and then echoes. */
function fakeProxy(onConnect: (target: string) => void): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      let stage: 'greeting' | 'connect' = 'greeting';

      socket.on('data', (chunk: Buffer) => {
        if (stage === 'greeting') {
          // Version, one method, no authentication.
          expect(chunk[0]).toBe(0x05);
          socket.write(Buffer.from([0x05, 0x00]));
          stage = 'connect';
          return;
        }

        expect(chunk[0]).toBe(0x05);
        expect(chunk[1]).toBe(0x01); // CONNECT
        expect(chunk[3]).toBe(0x03); // a domain name, not an address

        const length = chunk[4]!;
        onConnect(chunk.subarray(5, 5 + length).toString('utf8'));

        // Success, bound to 0.0.0.0:0 — which the client ignores. The
        // handshake listener has to go before the echo one takes over, or the
        // first payload byte is read as another CONNECT.
        socket.removeAllListeners('data');
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        socket.on('data', (payload: Buffer) => socket.write(payload));
      });
    });

    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Writes a word through the tunnel and returns whatever comes back. */
function roundTrip(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.connect(port, '127.0.0.1', () => socket.write('ping'));
    socket.on('data', (chunk: Buffer) => {
      resolve(chunk.toString('utf8'));
      socket.destroy();
    });
    socket.on('error', reject);
  });
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('connecting through a SOCKS5 proxy', () => {
  it('asks the proxy for the database by name, and forwards the bytes', async () => {
    let asked = '';
    const proxy = await fakeProxy((target) => (asked = target));
    open.push(proxy);

    const config = {
      engine: 'postgres',
      host: 'db.internal',
      port: 5432,
      proxy: { enabled: true, kind: 'socks5', host: '127.0.0.1', port: portOf(proxy) },
    } as unknown as ConnectionConfig;

    const tunnel = await openTunnel(config);
    expect(tunnel).toBeDefined();
    open.push({ close: () => void tunnel?.close() });

    // The driver is pointed at the loopback listener, never at the real host.
    expect(through(config, tunnel).host).toBe('127.0.0.1');
    expect(through(config, tunnel).port).toBe(tunnel!.port);

    const echoed = await roundTrip(tunnel!.port);

    // The name crossed to the proxy unresolved, which is the point of a proxy
    // on a private network.
    expect(asked).toBe('db.internal');
    expect(echoed).toBe('ping');
  });

  it('sends a SOCKS4a request that names the host it could not resolve', async () => {
    let asked = '';

    const server = await new Promise<Server>((resolve) => {
      const proxy = createServer((socket: Socket) => {
        socket.once('data', (chunk: Buffer) => {
          expect(chunk[0]).toBe(0x04);
          expect(chunk[1]).toBe(0x01);
          // 0.0.0.1 is the "a" of 4a: an impossible address meaning the name
          // follows the user id.
          expect([chunk[4], chunk[5], chunk[6], chunk[7]]).toEqual([0, 0, 0, 1]);

          const parts = chunk.subarray(8).toString('utf8').split('\0');
          asked = parts[1] ?? '';

          socket.write(Buffer.from([0x00, 0x5a, 0, 0, 0, 0, 0, 0]));
          socket.on('data', (payload: Buffer) => socket.write(payload));
        });
      });
      proxy.listen(0, '127.0.0.1', () => resolve(proxy));
    });
    open.push(server);

    const config = {
      engine: 'postgres',
      host: 'db.internal',
      port: 5432,
      proxy: { enabled: true, kind: 'socks4', host: '127.0.0.1', port: portOf(server) },
    } as unknown as ConnectionConfig;

    const tunnel = await openTunnel(config);
    open.push({ close: () => void tunnel?.close() });

    await roundTrip(tunnel!.port);
    expect(asked).toBe('db.internal');
  });

  it('speaks HTTP CONNECT, and keeps what arrives with the reply', async () => {
    let line = '';

    const server = await new Promise<Server>((resolve) => {
      const proxy = createServer((socket: Socket) => {
        socket.once('data', (chunk: Buffer) => {
          line = chunk.toString('utf8').split('\r\n')[0] ?? '';
          /*
           * The greeting is written in the *same* packet as the reply, which is
           * what a real proxy does the moment the far end has already spoken.
           * A client that reads the head and throws the tail away loses it.
           */
          socket.write('HTTP/1.1 200 Connection established\r\n\r\nhello');
          socket.on('data', (payload: Buffer) => socket.write(payload));
        });
      });
      proxy.listen(0, '127.0.0.1', () => resolve(proxy));
    });
    open.push(server);

    const config = {
      engine: 'postgres',
      host: 'db.internal',
      port: 5432,
      proxy: { enabled: true, kind: 'http', host: '127.0.0.1', port: portOf(server) },
    } as unknown as ConnectionConfig;

    const tunnel = await openTunnel(config);
    open.push({ close: () => void tunnel?.close() });

    const first = await new Promise<string>((resolve, reject) => {
      const socket = new Socket();
      socket.connect(tunnel!.port, '127.0.0.1');
      socket.on('data', (chunk: Buffer) => {
        resolve(chunk.toString('utf8'));
        socket.destroy();
      });
      socket.on('error', reject);
    });

    expect(line).toBe('CONNECT db.internal:5432 HTTP/1.1');
    expect(first).toBe('hello');
  });

  it('points a URL at the tunnel as well as the fields', async () => {
    const tunnel = { host: '127.0.0.1', port: 15432, close: async () => undefined };
    const config = {
      engine: 'postgres',
      url: 'postgres://sam:secret@db.internal:5432/app',
    } as unknown as ConnectionConfig;

    // Otherwise the driver takes the URL, ignores the rewritten fields, and
    // goes straight out to the network the proxy exists to keep it off.
    expect(through(config, tunnel).url).toBe('postgres://sam:secret@127.0.0.1:15432/app');
  });

  it('leaves a DNS seedlist alone, because there is no host in it to rewrite', () => {
    const tunnel = { host: '127.0.0.1', port: 27017, close: async () => undefined };
    const url = 'mongodb+srv://cluster.example.net/app';
    expect(through({ url } as unknown as ConnectionConfig, tunnel).url).toBe(url);
  });

  it('does nothing at all when neither route is configured', async () => {
    const config = {
      engine: 'postgres',
      host: 'db',
      port: 5432,
    } as unknown as ConnectionConfig;
    expect(await openTunnel(config)).toBeUndefined();
    expect(through(config, undefined)).toBe(config);
  });
});
