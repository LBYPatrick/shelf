import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiProvider } from '@shared/ai';
import { driverInfo } from '@shared/aiDrivers';
import { cliFailure, findExecutable } from '../cli';
import { startToolBridge, BRIDGE_NAME, type ToolBridge } from '../mcp';
import {
  AiError,
  type AiAdapter,
  type AiDriver,
  type AiReply,
  type AiRequest,
  type AiSink,
} from '../types';

/**
 * Grok Build, driven as a subprocess.
 *
 * The third CLI, and the first that does not answer in a private JSONL dialect.
 * `grok agent stdio` speaks the **Agent Client Protocol** — newline-delimited
 * JSON-RPC in both directions — which is a real protocol with a spec rather
 * than an output format, and it changes the shape of this driver in two ways
 * worth stating up front.
 *
 * It is a *conversation*, not a command. Claude Code and Codex take a prompt on
 * their command line, print events, and exit; here the process is opened,
 * handshaken, given a session, asked a question, and shut down. So there is a
 * request id to match, a session id to carry, and a notification stream to read
 * — three things the other two drivers have no equivalent of.
 *
 * And the tools go in as *configuration*, not as a flag. `session/new` takes an
 * `mcpServers` list, so the same loopback bridge the other two use is handed
 * over as one entry with its bearer token in a header. That is the better half
 * of the protocol being a protocol: nothing here has to know how Grok spells a
 * `-c mcp_servers.…` argument, because it does not spell one.
 *
 * Ported from the sibling project's `GrokDriver`, which reaches the same binary
 * the same way — `grok agent stdio`, protocol version 1, `grok-build` as the
 * model. What is not ported is its ACP client library: this needs three calls
 * and one notification, and a schema-validated implementation of the whole
 * protocol to make three calls would be a dependency that has to be kept in
 * step with a spec we use a corner of.
 *
 * **Everything else follows the rules the other two follow.** It signs itself
 * in, so no credential is read here. It runs in a temp directory, because there
 * is no project and the reader's files are none of its business. Its
 * differences are declared in the catalogue rather than discovered by calling
 * something and catching the failure.
 */

/**
 * Where the CLI is, when the shell's `PATH` is not available to ask.
 *
 * An app launched from the Finder inherits a minimal environment rather than
 * the one the reader's shell builds, so `grok` is very often on the machine and
 * not on the path this process can see.
 */
export const COMMAND = 'grok';

export const CANDIDATES = [
  join(homedir(), '.local', 'bin', 'grok'),
  join(homedir(), '.grok', 'bin', 'grok'),
  join(homedir(), '.bun', 'bin', 'grok'),
  '/opt/homebrew/bin/grok',
  '/usr/local/bin/grok',
  '/usr/bin/grok',
];

function executable(): string {
  return findExecutable(COMMAND, CANDIDATES) ?? COMMAND;
}

/**
 * The version of ACP this speaks.
 *
 * A number rather than a range, because the handshake settles it: the agent
 * answers `initialize` with the version *it* chose, and a mismatch is its
 * answer to give rather than ours to negotiate.
 */
const PROTOCOL_VERSION = 1;

/** JSON-RPC, as much of it as three calls and one notification need. */
interface Frame {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message?: string; readonly code?: number };
}

/**
 * A chunk off `session/update`.
 *
 * Two of the many update kinds carry an answer: the message the reader is owed
 * and the model's own account of getting there. The rest — plan updates, tool
 * calls it made through the bridge, mode changes — are the agent narrating work
 * that this app either already knows about or has no view for, and reading them
 * would put a second, worse transcript inside the one being drawn.
 */
export function chunkText(update: Record<string, unknown>): string {
  const content = update['content'];
  if (typeof content !== 'object' || content === null) return '';
  const { type, text } = content as { type?: unknown; text?: unknown };
  return type === 'text' && typeof text === 'string' ? text : '';
}

/**
 * The agent's own word for how it stopped, in ours.
 *
 * `refusal` and the two limits are the ones worth carrying: an answer cut off
 * at a token limit is a different thing from a finished one, and the interface
 * can only say so if it is told. Everything else — `end_turn`, `cancelled`, and
 * whatever a later version of the protocol adds — is an ending, because the
 * alternative is a driver that fails on a word it has not been taught.
 */
export function stopOf(reason: unknown): AiReply['stop'] {
  if (reason === 'refusal') return 'refusal';
  if (reason === 'max_tokens' || reason === 'max_turn_requests') return 'length';
  return 'end';
}

/**
 * Everything the model is told, as one string.
 *
 * ACP has no system role: a prompt is a list of content blocks from the user,
 * and `session/new` takes no instructions. So the composed system text goes at
 * the head of the first block, labelled, exactly as it does for Codex — and for
 * exactly the same reason it is declared `system: false` in the catalogue
 * rather than left for a caller to find out.
 */
function toPrompt(request: AiRequest): string {
  const parts: string[] = [request.system];

  for (const message of request.messages) {
    if (message.role === 'user') parts.push(`Question: ${message.text}`);
    else if (message.role === 'assistant' && message.text) {
      parts.push(`Your previous answer: ${message.text}`);
    }
  }

  return parts.join('\n\n');
}

function createAdapter(instance: AiProvider): AiAdapter {
  return {
    kind: 'grok',
    capabilities: driverInfo('grok').capabilities,

    async send(request: AiRequest, sink: AiSink, signal: AbortSignal): Promise<AiReply> {
      const bridge: ToolBridge | undefined =
        request.execute && request.tools.length > 0
          ? await startToolBridge(request.tools, request.execute)
          : undefined;

      try {
        return await run(request, sink, signal, instance, bridge);
      } finally {
        // Closed on every path. A turn that threw must not leave a socket
        // listening on loopback with a live token on it.
        bridge?.close();
      }
    },
  };
}

function run(
  request: AiRequest,
  sink: AiSink,
  signal: AbortSignal,
  instance: AiProvider,
  bridge: ToolBridge | undefined
): Promise<AiReply> {
  return new Promise<AiReply>((resolve, reject) => {
    const child = spawn(executable(), ['agent', 'stdio'], {
      cwd: tmpdir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let text = '';
    let stderr = '';
    let buffer = '';
    let settled = false;
    let nextId = 1;

    /** What each outstanding call is waiting for. */
    const pending = new Map<number, (frame: Frame) => void>();

    const finish = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      child.kill('SIGTERM');
      outcome();
    };

    function onAbort(): void {
      finish(() => reject(new AiError('Stopped.')));
    }

    signal.addEventListener('abort', onAbort, { once: true });

    function call(method: string, params: Record<string, unknown>): Promise<Frame> {
      return new Promise<Frame>((settle, fail) => {
        const id = nextId++;
        pending.set(id, (frame) => {
          if (frame.error) {
            /*
             * The agent's own words, classified. "Not authenticated" from an
             * ACP error is the same fact the other two report on standard
             * error, and it has to reach the reader as the sheet with the
             * command in it rather than as a red line of prose.
             */
            fail(cliFailure('grok', frame.error.message ?? `Grok refused ${method}.`));
            return;
          }
          settle(frame);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    }

    function consume(line: string): void {
      let frame: Frame;
      try {
        frame = JSON.parse(line) as Frame;
      } catch {
        // Not every line is a frame — a CLI is entitled to print an update
        // notice — and one that is not is not a failure.
        return;
      }

      if (frame.id !== undefined && typeof frame.id === 'number') {
        const waiting = pending.get(frame.id);
        if (waiting) {
          pending.delete(frame.id);
          waiting(frame);
          return;
        }
      }

      /*
       * A request *from* the agent, which this client does not serve.
       *
       * `clientCapabilities` is empty, so a well-behaved agent asks for none of
       * it — but permission prompts and file reads are the two it may try
       * anyway, and a JSON-RPC request that is never answered hangs the session
       * rather than failing it. Answered with an error, the agent moves on.
       */
      if (frame.method && frame.id !== undefined) {
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: frame.id,
            error: { code: -32601, message: `Shelf does not provide ${frame.method}.` },
          })}\n`
        );
        return;
      }

      if (frame.method === 'session/update' && frame.params) {
        const update = frame.params['update'];
        if (typeof update !== 'object' || update === null) return;

        const kind = (update as { sessionUpdate?: unknown }).sessionUpdate;
        const body = chunkText(update as Record<string, unknown>);
        if (!body) return;

        if (kind === 'agent_thought_chunk') {
          sink.thinking(body);
          return;
        }
        if (kind === 'agent_message_chunk') {
          text += body;
          sink.text(body);
        }
      }
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;

      // One frame per line, and a line can arrive in pieces. Anything after the
      // last newline waits for the next chunk to complete it.
      let at = buffer.indexOf('\n');
      while (at !== -1) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf('\n');
        if (line) consume(line);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Kept, and shown only if the session actually fails: the CLI writes
      // ordinary notices here too.
      stderr += chunk;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          new AiError(
            error.code === 'ENOENT'
              ? 'Grok Build is not installed, or is not on this app’s path.'
              : error.message
          )
        )
      );
    });

    /*
     * An exit before the answer is a failure, whatever the code says.
     *
     * The other two drivers settle *on* exit, because exiting is how they
     * finish. This one finishes on a reply to `session/prompt` and exits
     * afterwards, so a process that has gone is a session that was cut off —
     * and the only account of why is whatever it wrote to standard error.
     */
    child.on('exit', (code) => {
      finish(() =>
        reject(
          cliFailure(
            'grok',
            stderr.trim().slice(0, 400) || `Grok Build exited with ${code} before answering.`
          )
        )
      );
    });

    void (async () => {
      try {
        await call('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: 'shelf', version: '1' },
          // Nothing: this client reads no files, runs no terminal and shows no
          // permission prompt, and saying so is what stops the agent asking.
          clientCapabilities: {},
        });

        const session = await call('session/new', {
          cwd: tmpdir(),
          mcpServers: bridge
            ? [
                {
                  type: 'http',
                  name: BRIDGE_NAME,
                  url: bridge.url,
                  headers: [{ name: 'Authorization', value: `Bearer ${bridge.token}` }],
                },
              ]
            : [],
        });

        const sessionId = session.result?.['sessionId'];
        if (typeof sessionId !== 'string') {
          throw new AiError('Grok Build started no session.');
        }

        const answered = await call('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: toPrompt(request) }],
          ...(instance.model && instance.model !== 'default'
            ? { _meta: { model: instance.model } }
            : {}),
        });

        finish(() =>
          resolve({ text, calls: [], stop: stopOf(answered.result?.['stopReason']) })
        );
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new AiError(String(error))));
      }
    })();
  });
}

export const GrokDriver: AiDriver = {
  kind: 'grok',
  capabilities: driverInfo('grok').capabilities,
  create: createAdapter,
};
