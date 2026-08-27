import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiProvider } from '@shared/ai';
import { driverInfo } from '@shared/aiDrivers';
import { findExecutable } from '../cli';
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
 * Codex, driven as a subprocess.
 *
 * The same arrangement Claude Code gets and for the same reasons: the CLI signs
 * itself in, so this never reads a credential, and everything about the session
 * is stated on the command line rather than inherited.
 *
 *   - `exec --json` runs it non-interactively and prints its events as JSONL.
 *   - `-s read-only` is the sandbox. Belt and braces: the tools this process
 *     exposes already refuse anything that writes, and the model has no shell
 *     worth the name, but a sandbox is cheap and the failure it prevents is not.
 *   - `--ephemeral` keeps the session out of the reader's Codex history. A
 *     conversation about their database is theirs, not a row in a log some
 *     other tool will show them later.
 *   - `--ignore-user-config` and `--ignore-rules` keep their `config.toml`,
 *     their profiles and their project rules out of a prompt that is supposed
 *     to be about a table. It is the same intent as Claude Code's empty
 *     `--setting-sources`.
 *   - `--skip-git-repo-check`, and a temp directory to run in, because there is
 *     no repository here and nothing in the working directory is any of its
 *     business.
 *
 * **It has no way to replace the system prompt.** Claude Code takes
 * `--system-prompt`; Codex takes a prompt and nothing else, and `AGENTS.md` is
 * a file on disk rather than an argument. So the composed system text is put at
 * the head of what goes in on standard input, which is a real difference and is
 * declared rather than papered over — `system: false` in the catalogue, and the
 * agent is free to read that.
 *
 * Tools reach it the same way they reach Claude Code: a loopback MCP endpoint
 * that lives for the length of one turn. Codex takes a streamable-HTTP server
 * as config, and reads the bearer token from an environment variable rather
 * than from the command line — which is better than the alternative, because a
 * command line is visible to every other process on the machine.
 */

/**
 * Where the CLI is, when the shell's `PATH` is not available to ask.
 *
 * An app launched from the Finder inherits a minimal environment rather than
 * the one the reader's shell builds, so `codex` is very often on the machine
 * and not on the path this process can see.
 */
export const COMMAND = 'codex';

export const CANDIDATES = [
  join(homedir(), '.local', 'bin', 'codex'),
  join(homedir(), '.codex', 'bin', 'codex'),
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
  '/usr/bin/codex',
];

/** Where it is, or the bare name. See the note on Claude Code's. */
function executable(): string {
  return findExecutable(COMMAND, CANDIDATES) ?? COMMAND;
}

/**
 * One event off the stream. Only the shapes that carry an answer matter.
 *
 * Codex reports items when they are *complete* rather than token by token, so
 * there are no deltas to accumulate — an item arrives whole and is handed to
 * the sink in one piece. The sink appends either way, so a caller cannot tell
 * the difference beyond the granularity of the redraw.
 */
interface Line {
  readonly type?: string;
  readonly message?: string;
  readonly error?: { readonly message?: string };
  readonly item?: {
    readonly type?: string;
    readonly text?: string;
  };
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
}

function parseFrame(line: string): Line | undefined {
  try {
    return JSON.parse(line) as Line;
  } catch {
    // The CLI prints the occasional plain line. Not every line is an event, and
    // one that is not is not a failure.
    return undefined;
  }
}

/**
 * Everything the model is told, as one string.
 *
 * The system text goes first because there is nowhere else for it to go, and it
 * is labelled so the model can tell the standing instructions from the question
 * — a prompt that runs the two together reads as one very long question.
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
    kind: 'codex',
    capabilities: driverInfo('codex').capabilities,

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

const TOKEN_VAR = 'SHELF_MCP_TOKEN';

function run(
  request: AiRequest,
  sink: AiSink,
  signal: AbortSignal,
  instance: AiProvider,
  bridge: ToolBridge | undefined
): Promise<AiReply> {
  return new Promise<AiReply>((resolve, reject) => {
    const args = [
      'exec',
      '--json',
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      ...(bridge
        ? [
            '-c',
            `mcp_servers.${BRIDGE_NAME}.url="${bridge.url}"`,
            /*
             * By name, not by value. The token is read out of the environment
             * of the child rather than written on its command line, where
             * every other process on the machine could read it.
             */
            '-c',
            `mcp_servers.${BRIDGE_NAME}.bearer_token_env_var="${TOKEN_VAR}"`,
          ]
        : []),
      ...(instance.model && instance.model !== 'default' ? ['-m', instance.model] : []),
      // Read the prompt from standard input: a schema document is tens of
      // thousands of characters and a command line has a limit a large
      // database would cross.
      '-',
    ];

    const child = spawn(executable(), args, {
      cwd: tmpdir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(bridge ? { [TOKEN_VAR]: bridge.token } : {}),
      },
    });

    let text = '';
    let stderr = '';
    let usage: AiReply['usage'];
    let failed: string | undefined;
    let buffer = '';
    let settled = false;

    const consume = (line: string): void => {
      const frame = parseFrame(line);
      if (!frame) return;

      if (frame.type === 'item.completed' && frame.item) {
        const body = frame.item.text ?? '';
        if (!body) return;

        if (frame.item.type === 'reasoning') {
          sink.thinking(body);
          return;
        }

        if (frame.item.type === 'agent_message') {
          // Blank line between items, or two paragraphs of an answer run
          // together into one.
          if (text) {
            text += '\n\n';
            sink.text('\n\n');
          }
          text += body;
          sink.text(body);
        }
        return;
      }

      if (frame.type === 'turn.completed' && frame.usage) {
        usage = {
          ...(frame.usage.input_tokens !== undefined
            ? { inputTokens: frame.usage.input_tokens }
            : {}),
          ...(frame.usage.output_tokens !== undefined
            ? { outputTokens: frame.usage.output_tokens }
            : {}),
        };
        return;
      }

      /*
       * `error` and `turn.failed` carry the same sentence, and a failed turn
       * emits both. The first one wins so the reader is told what actually went
       * wrong rather than a summary of it.
       */
      if (frame.type === 'error' || frame.type === 'turn.failed') {
        failed ??= frame.message ?? frame.error?.message ?? 'Codex failed.';
      }
    };

    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      outcome();
    };

    function onAbort(): void {
      child.kill('SIGTERM');
      finish(() => reject(new AiError('Stopped.')));
    }

    signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;

      // One JSON object per line, and a line can arrive in pieces. Anything
      // after the last newline waits for the next chunk to complete it.
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
      // Kept, and shown only if the process actually fails: the CLI writes
      // ordinary notices here too.
      stderr += chunk;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          new AiError(
            error.code === 'ENOENT'
              ? 'Codex is not installed, or is not on this app’s path.'
              : error.message
          )
        )
      );
    });

    /*
     * Settled on `exit` with a grace period, never on `close` — the same
     * arrangement, and for the same reason, as the Claude Code driver: the CLI
     * starts helpers that inherit its standard output, so `close` can wait on a
     * pipe nothing will ever write to again while the answer has already been
     * delivered and read.
     */
    const GRACE_MS = 500;
    let exitCode: number | null | undefined;
    let exited = false;
    let ended = false;
    let grace: NodeJS.Timeout | undefined;

    const conclude = () => {
      clearTimeout(grace);
      finish(() => {
        // Whatever never got a newline is still an event.
        const tail = buffer.trim();
        if (tail) consume(tail);

        if (failed) return reject(new AiError(failed));
        if (exitCode !== 0) {
          return reject(
            new AiError(stderr.trim().slice(0, 400) || `Codex exited with ${exitCode}.`)
          );
        }
        resolve({ text, calls: [], stop: 'end', ...(usage ? { usage } : {}) });
      });
    };

    child.stdout.on('end', () => {
      ended = true;
      if (exited) conclude();
    });

    child.on('exit', (code) => {
      exited = true;
      exitCode = code;
      if (ended) conclude();
      else grace = setTimeout(conclude, GRACE_MS);
    });

    child.stdin.end(toPrompt(request), 'utf8');
  });
}

export const CodexDriver: AiDriver = {
  kind: 'codex',
  capabilities: driverInfo('codex').capabilities,
  create: createAdapter,
};
