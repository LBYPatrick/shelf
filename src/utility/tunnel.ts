import { createServer, connect as tcpConnect, type Server, type Socket } from 'node:net';
import { readFile } from 'node:fs/promises';
import { Client as SshClient } from 'ssh2';
import type { ConnectionConfig } from '@drivers/types';

/**
 * Reaching a database that is not directly reachable.
 *
 * A production database is usually behind something — a bastion you have SSH on,
 * or a SOCKS proxy the network requires — and a client that cannot go through
 * one is a client you cannot use at work. Both were declared in the connection
 * form and neither was implemented: `SshConfig` existed on the type, the form
 * collected it, `capabilities.sshTunnel` said yes, and no driver ever opened
 * anything. The fields were a promise the app did not keep.
 *
 * The shape is deliberately the same for both. A tunnel is a *local* listener,
 * and the driver is told to connect to that instead of to the real host — so
 * every engine gets proxying for free, without a line of proxy code in any
 * driver. The driver believes it is talking to `127.0.0.1`, and what happens on
 * the other side of that socket is this file's business.
 *
 * Port zero: the kernel picks a free one. Choosing a number ourselves means
 * either a collision or a scan, and both are bugs waiting for the day two
 * windows open the same bastion.
 */

export interface Tunnel {
  /** Where the driver should connect instead. */
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

/** Sockets are opened per database connection, and none should hang forever. */
const CONNECT_TIMEOUT_MS = 20_000;

/**
 * A local listener that forwards every connection somewhere else.
 *
 * `forward` is given the destination and must resolve to a duplex stream that
 * reaches it. Everything else — accepting, piping, tearing down both halves
 * when either dies — is the same whatever the transport is, so it is written
 * once here.
 */
function listen(
  target: { host: string; port: number },
  forward: (
    target: { host: string; port: number },
    onReady: (stream: NodeJS.ReadWriteStream) => void,
    onError: (error: Error) => void
  ) => void
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      socket.on('error', () => socket.destroy());

      forward(
        target,
        (stream) => {
          /*
           * Piped both ways and destroyed together. A half-closed pair leaks a
           * file descriptor per connection, which on a pool that reconnects is
           * a leak per reconnect.
           */
          socket.pipe(stream as NodeJS.WritableStream);
          (stream as NodeJS.ReadableStream).pipe(socket);
          (stream as unknown as Socket).on?.('error', () => socket.destroy());
          socket.on('close', () => (stream as unknown as Socket).destroy?.());
        },
        () => socket.destroy()
      );
    });

    server.on('error', reject);
    // Loopback only. A forwarder bound to every interface is an open relay into
    // the network the bastion was protecting.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('The tunnel could not take a local port.'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/* ----------------------------------------------------------------------- ssh */

async function openSsh(config: ConnectionConfig): Promise<Tunnel> {
  const ssh = config.ssh;
  if (!ssh) throw new Error('No SSH configuration.');

  const client = new SshClient();

  await new Promise<void>((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', (error: Error) => reject(new Error(`SSH tunnel: ${error.message}`)));

    void (async () => {
      try {
        client.connect({
          host: ssh.host,
          port: ssh.port || 22,
          username: ssh.username,
          readyTimeout: CONNECT_TIMEOUT_MS,
          ...(ssh.keepaliveInterval ? { keepaliveInterval: ssh.keepaliveInterval } : {}),
          ...(ssh.mode === 'keyfile' && ssh.keyfile
            ? {
                privateKey: await readFile(ssh.keyfile),
                ...(ssh.passphrase ? { passphrase: ssh.passphrase } : {}),
              }
            : {}),
          ...(ssh.mode === 'password' && ssh.password ? { password: ssh.password } : {}),
          // `agent` mode: ssh2 reads the socket from the environment, which is
          // the whole point of an agent — the key never leaves it.
          ...(ssh.mode === 'agent' ? { agent: process.env['SSH_AUTH_SOCK'] ?? undefined } : {}),
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });

  const { server, port } = await listen(destinationOf(config), (target, onReady, onError) => {
    client.forwardOut('127.0.0.1', 0, target.host, target.port, (error, stream) => {
      if (error) onError(error);
      else onReady(stream);
    });
  });

  return {
    host: '127.0.0.1',
    port,
    async close() {
      await closeServer(server);
      client.end();
    },
  };
}

/* --------------------------------------------------------------------- socks */

/**
 * SOCKS5 CONNECT, by hand.
 *
 * Forty lines against a dependency, and worth it: the protocol is a fixed
 * handshake with two replies, and the alternative pulls a package into the one
 * process that holds live credentials. The host name is sent as a name rather
 * than resolved here — that is the point of a SOCKS proxy on a private network,
 * where the name only means something on the far side.
 */
function socksConnect(
  proxy: { host: string; port: number; username?: string; password?: string },
  target: { host: string; port: number }
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect(proxy.port, proxy.host);
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(`SOCKS proxy: ${message}`));
    };

    socket.on('error', (error) => fail(error.message));
    socket.on('timeout', () => fail('the proxy did not answer.'));

    const authed = Boolean(proxy.username);
    let stage: 'greeting' | 'auth' | 'connect' = 'greeting';

    socket.on('connect', () => {
      // Version 5, one method offered: username/password if we have one, else
      // none. Offering both invites the proxy to pick the one we cannot do.
      socket.write(Buffer.from([0x05, 1, authed ? 0x02 : 0x00]));
    });

    socket.on('data', (chunk: Buffer) => {
      if (stage === 'greeting') {
        if (chunk[0] !== 0x05) return fail('not a SOCKS5 proxy.');
        if (chunk[1] === 0xff) return fail('it refused every authentication method offered.');

        if (chunk[1] === 0x02) {
          const user = Buffer.from(proxy.username ?? '', 'utf8');
          const pass = Buffer.from(proxy.password ?? '', 'utf8');
          socket.write(
            Buffer.concat([
              Buffer.from([0x01, user.length]),
              user,
              Buffer.from([pass.length]),
              pass,
            ])
          );
          stage = 'auth';
          return;
        }

        stage = 'connect';
        sendConnect();
        return;
      }

      if (stage === 'auth') {
        if (chunk[1] !== 0x00) return fail('the proxy rejected those credentials.');
        stage = 'connect';
        sendConnect();
        return;
      }

      // The CONNECT reply. Byte 1 is the status; anything but zero is a refusal,
      // and the rest of the packet is the bound address we do not need.
      if (chunk[1] !== 0x00) return fail(`it refused the connection (code ${chunk[1]}).`);

      socket.setTimeout(0);
      socket.removeAllListeners('data');
      resolve(socket);
    });

    function sendConnect(): void {
      const name = Buffer.from(target.host, 'utf8');
      const port = Buffer.alloc(2);
      port.writeUInt16BE(target.port);
      // Address type 3 is a domain name, length-prefixed.
      socket.write(
        Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, port])
      );
    }
  });
}

/**
 * SOCKS4a CONNECT.
 *
 * The "a" is the only part worth knowing: plain SOCKS4 carries a four-byte
 * address, so it cannot name a host the client has not already resolved.
 * Writing an address that cannot be real and appending the name is the
 * documented way to ask the proxy to resolve it — and on a private network that
 * is the only useful form, so it is the one "socks4" means here.
 */
function socks4Connect(
  proxy: { host: string; port: number; username?: string },
  target: { host: string; port: number }
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect(proxy.port, proxy.host);
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(`SOCKS proxy: ${message}`));
    };

    socket.on('error', (error) => fail(error.message));
    socket.on('timeout', () => fail('the proxy did not answer.'));

    socket.on('connect', () => {
      const port = Buffer.alloc(2);
      port.writeUInt16BE(target.port);

      socket.write(
        Buffer.concat([
          Buffer.from([0x04, 0x01]),
          port,
          // 0.0.0.1 — an address that cannot be real, which is how 4a says
          // "the host name follows".
          Buffer.from([0, 0, 0, 1]),
          Buffer.from(`${proxy.username ?? ''}\0`, 'utf8'),
          Buffer.from(`${target.host}\0`, 'utf8'),
        ])
      );
    });

    socket.on('data', (chunk: Buffer) => {
      // Byte 1 is the reply code; 0x5a is "request granted".
      if (chunk[1] !== 0x5a) return fail(`it refused the connection (code ${chunk[1]}).`);

      socket.setTimeout(0);
      socket.removeAllListeners('data');
      resolve(socket);
    });
  });
}

/**
 * HTTP CONNECT — the proxy most corporate networks already have.
 *
 * Unlike the two binary protocols above, the reply is a status line and headers
 * terminated by a blank line, and it can arrive in pieces — so it is
 * accumulated rather than read out of the first chunk.
 */
function httpConnect(
  proxy: { host: string; port: number; username?: string; password?: string },
  target: { host: string; port: number }
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect(proxy.port, proxy.host);
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(`HTTP proxy: ${message}`));
    };

    socket.on('error', (error) => fail(error.message));
    socket.on('timeout', () => fail('the proxy did not answer.'));

    const authority = `${target.host}:${target.port}`;
    let head = '';

    socket.on('connect', () => {
      const credentials = proxy.username
        ? Buffer.from(`${proxy.username}:${proxy.password ?? ''}`, 'utf8').toString('base64')
        : '';

      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\n` +
          `Host: ${authority}\r\n` +
          (credentials ? `Proxy-Authorization: Basic ${credentials}\r\n` : '') +
          '\r\n'
      );
    });

    socket.on('data', (chunk: Buffer) => {
      head += chunk.toString('latin1');
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;

      const status = Number(head.split(' ')[1]);
      if (status !== 200) return fail(`it answered ${head.split('\r\n')[0]}.`);

      socket.setTimeout(0);
      socket.removeAllListeners('data');

      /*
       * Anything past the blank line is already payload from the far end.
       * Dropping it loses the first bytes of the database's greeting — which
       * for Postgres is the whole authentication request.
       *
       * Paused before it is pushed back, because a socket still in flowing mode
       * emits an unshifted chunk immediately — to the listener we have just
       * removed, which is to say into nothing. Paused, it waits in the buffer
       * until whoever is given this socket starts reading.
       */
      const rest = Buffer.from(head.slice(end + 4), 'latin1');
      if (rest.length > 0) {
        socket.pause();
        socket.unshift(rest);
      }

      resolve(socket);
    });
  });
}

async function openProxy(config: ConnectionConfig): Promise<Tunnel> {
  const proxy = config.proxy;
  if (!proxy) throw new Error('No proxy configuration.');

  const credentials = {
    host: proxy.host,
    port: proxy.port,
    ...(proxy.username ? { username: proxy.username } : {}),
    ...(proxy.password ? { password: proxy.password } : {}),
  };

  const dial = { socks5: socksConnect, socks4: socks4Connect, http: httpConnect }[proxy.kind];

  const { server, port } = await listen(destinationOf(config), (target, onReady, onError) => {
    void dial(credentials, target).then(onReady, onError);
  });

  return { host: '127.0.0.1', port, close: () => closeServer(server) };
}

/**
 * Where the driver was actually trying to go.
 *
 * A config may name its destination in fields or in a URL, and a tunnel has to
 * know which — pointing the forwarder at `config.host` when the driver is going
 * to use `config.url` would open a tunnel to the wrong place and then have the
 * URL rewritten to it.
 */
function destinationOf(config: ConnectionConfig): { host: string; port: number } {
  const fromUrl = config.url ? parseUrl(config.url) : undefined;
  return {
    host: fromUrl?.host ?? config.host ?? '127.0.0.1',
    port: fromUrl?.port ?? config.port ?? 0,
  };
}

function parseUrl(url: string): { host: string; port: number } | undefined {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    if (!parsed.hostname || !Number.isFinite(port) || port === 0) return undefined;
    return { host: parsed.hostname, port };
  } catch {
    return undefined;
  }
}

/* ---------------------------------------------------------------------- open */

/**
 * The tunnel a config asks for, or nothing if it asks for none.
 *
 * Only one at a time, and SSH wins: a bastion you reach *through* a SOCKS proxy
 * is a real arrangement, but it is two hops to configure and to explain, and
 * nobody has asked for it. Better to do one thing correctly than to offer a
 * combination that has never been tried.
 */
export async function openTunnel(config: ConnectionConfig): Promise<Tunnel | undefined> {
  if (config.ssh?.enabled) return openSsh(config);
  if (config.proxy?.enabled) return openProxy(config);
  return undefined;
}

/**
 * The config a driver should actually use, once a tunnel is in front of it.
 *
 * The URL is rewritten as well as the fields, and that is not belt and braces:
 * a connection entered as a URL is passed to the driver *as* a URL — Postgres
 * takes it as `connectionString` — so rewriting only the fields would open a
 * tunnel the driver then ignored, and the connection would either fail or, far
 * worse on a restricted network, quietly go direct.
 */
export function through(
  config: ConnectionConfig,
  tunnel: Tunnel | undefined
): ConnectionConfig {
  if (!tunnel) return config;

  return {
    ...config,
    host: tunnel.host,
    port: tunnel.port,
    ...(config.url ? { url: redirect(config.url, tunnel) } : {}),
  };
}

function redirect(url: string, tunnel: Tunnel): string {
  try {
    const parsed = new URL(url);
    /*
     * `mongodb+srv` is a DNS seedlist, not a host: the driver looks up SRV
     * records to find the real members, and rewriting the name it looks up
     * would point it at a lookup that does not exist. Left alone, and the
     * fields carry the tunnel — a seedlist through a proxy is a thing to solve
     * when someone actually needs it, not to guess at here.
     */
    if (parsed.protocol.endsWith('+srv:')) return url;

    parsed.hostname = tunnel.host;
    parsed.port = String(tunnel.port);
    return parsed.toString();
  } catch {
    return url;
  }
}
