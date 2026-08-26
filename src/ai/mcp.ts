import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AiToolCall, AiToolDef, AiToolResult } from './types';

/**
 * The tools, offered to a provider that runs in another process.
 *
 * Every other adapter is handed a list of tools and hands back the calls it
 * wants made; we run them and reply. Claude Code cannot work that way — it is a
 * subprocess with its own agent loop, and it reaches tools the way it reaches
 * every other tool, over MCP. So the tools have to be somewhere it can call.
 *
 * They are here: a JSON-RPC endpoint on the loopback interface, started for one
 * turn and shut down at the end of it. Nothing about it is durable and nothing
 * about it is reachable from off the machine:
 *
 *   - bound to `127.0.0.1` on a port the OS picks, so it is not on the network;
 *   - a bearer token generated per turn, so another process that guessed the
 *     port still cannot call it;
 *   - closed in a `finally`, so a failed turn does not leave a listener behind.
 *
 * The tools themselves are the same two functions the in-process loop calls,
 * with the same read-only rule enforced in the same place. Going out over a
 * socket does not buy the model any more permission than it had.
 *
 * A deliberately small slice of the protocol: initialise, list, call. That is
 * everything a client needs to use a tool, and each additional method would be
 * another shape to keep correct for no gain.
 */

const PROTOCOL = '2025-06-18';

export interface ToolBridge {
  /** What to put in the client's MCP configuration. */
  readonly url: string;
  readonly token: string;
  /** The prefixed names the client will know these tools by. */
  readonly toolNames: readonly string[];
  close(): Promise<void>;
}

/** The name the client sees. MCP namespaces a server's tools by its own name. */
export const BRIDGE_NAME = 'shelf';
export const prefixed = (tool: string) => `mcp__${BRIDGE_NAME}__${tool}`;

interface Rpc {
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: { readonly name?: string; readonly arguments?: Record<string, unknown> };
}

export async function startToolBridge(
  tools: readonly AiToolDef[],
  execute: (call: AiToolCall) => Promise<AiToolResult>
): Promise<ToolBridge> {
  const token = randomUUID();

  const listing = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema,
  }));

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }

    const body = await new Promise<string>((resolve) => {
      let text = '';
      request.on('data', (chunk) => (text += chunk));
      request.on('end', () => resolve(text));
    });

    let message: Rpc;
    try {
      message = JSON.parse(body || '{}') as Rpc;
    } catch {
      response.writeHead(400).end();
      return;
    }

    const send = (result: unknown): void => {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    };

    /*
     * A notification has no id and expects no answer. Replying to one with a
     * result whose id is `undefined` is malformed, and a strict client will
     * hang up on it.
     */
    if (message.method?.startsWith('notifications/')) {
      response.writeHead(202).end();
      return;
    }

    if (message.method === 'initialize') {
      send({
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: BRIDGE_NAME, version: '1' },
      });
      return;
    }

    if (message.method === 'tools/list') {
      send({ tools: listing });
      return;
    }

    if (message.method === 'tools/call') {
      const name = message.params?.name ?? '';
      const outcome = await execute({
        // The client has already stripped its own prefix by the time a call
        // arrives; the id is ours to invent because nothing echoes it back.
        id: `mcp-${String(message.id ?? '0')}`,
        name,
        input: message.params?.arguments ?? {},
      }).catch((error: unknown) => ({
        id: '',
        name,
        content: error instanceof Error ? error.message : String(error),
        isError: true as const,
      }));

      // `isError` is how MCP says a tool failed *without* failing the call — a
      // refused statement is a result the model must read, not a transport
      // fault it should retry.
      send({
        content: [{ type: 'text', text: outcome.content }],
        ...(outcome.isError ? { isError: true } : {}),
      });
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `No such method: ${message.method}` },
      })
    );
  };

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('The tool bridge could not take a port.'));
    });
  });

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    toolNames: tools.map((tool) => prefixed(tool.name)),
    close: () =>
      new Promise<void>((resolve) => {
        // Sockets the client left open would keep the process alive; the turn
        // is over, so they go with it.
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
