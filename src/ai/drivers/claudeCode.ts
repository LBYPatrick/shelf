import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiProvider } from '@shared/ai';
import { driverInfo } from '@shared/aiDrivers';
import { startToolBridge, type ToolBridge } from '../mcp';
import { parseFrame } from '../sse';
import {
  AiError,
  type AiAdapter,
  type AiDriver,
  type AiReply,
  type AiRequest,
  type AiSink,
} from '../types';

/**
 * Claude Code, driven as a subprocess.
 *
 * The one provider that needs no key. If the reader already has the CLI on this
 * machine it is already signed in, and the whole of configuring the assistant
 * becomes choosing this row — which is a real difference to someone who would
 * otherwise have to go and create an API key before the feature does anything.
 *
 * Ported straight from the sibling project's provider layer, which drives every
 * agent it supports this way. The important property is what is *not* done: the
 * CLI's credentials are never read, copied, or sent anywhere. It authenticates
 * itself, as it does when a person runs it, and this process only ever writes a
 * prompt to its standard input and reads JSON back.
 *
 * Some flags do the work of keeping it a *database* assistant rather than a
 * coding agent, and they are the whole security story of this file:
 *
 *   - `--tools` names exactly the tools the session may have, and the only ones
 *     named are ours. Left empty it has none; left off it has all of them, and
 *     "all of them" includes `Bash`, `Write` and `Edit`. It is spelled out
 *     rather than defaulted for that reason.
 *   - `--system-prompt` *replaces* the built-in prompt rather than appending to
 *     it, so what it is told is exactly what `aiPrompt.ts` composed.
 *   - `--setting-sources` empty, `--strict-mcp-config`, and
 *     `--exclude-dynamic-system-prompt-sections` keep the reader's own settings,
 *     MCP servers, memory files and working directory out of a prompt that is
 *     supposed to be about their database.
 *
 * It runs the two tools, over a loopback MCP endpoint that lives for the length
 * of one turn — see `../mcp.ts`. It could not before, because the tools are
 * functions in this process and a subprocess cannot call a function; the result
 * was a chat that answered "you can run this yourself" to questions it was
 * perfectly able to answer. The rule is unchanged and enforced in the same
 * place: reads run, writes come back as text.
 */

/**
 * Where the CLI is, when the shell's `PATH` is not available to ask.
 *
 * An app launched from the Finder inherits a minimal environment — not the one
 * the reader's shell builds — so `claude` is very often on the machine and not
 * on the path this process can see. Guessing at the handful of places the
 * installers use is far better than reporting "not installed" to someone who
 * can run it in their terminal.
 */
const CANDIDATES = [
  join(homedir(), '.local', 'bin', 'claude'),
  join(homedir(), '.claude', 'local', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  '/usr/bin/claude',
];

function executable(): string {
  for (const candidate of CANDIDATES) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not there, or not executable. Try the next one.
    }
  }
  // Let the shell's own resolution have the last word: a reader who installed
  // it somewhere else entirely still has it on the path we inherited.
  return 'claude';
}

/** One line of the CLI's stream. Only three shapes matter to us. */
interface Line {
  readonly type: string;
  readonly subtype?: string;
  readonly event?: {
    readonly type: string;
    readonly delta?: {
      readonly type?: string;
      readonly text?: string;
      readonly thinking?: string;
    };
  };
  readonly result?: string;
  readonly is_error?: boolean;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
}

/**
 * The conversation as one prompt.
 *
 * `--print` is a single question, so the history is written into it rather than
 * replayed as messages. That is a real difference from the other adapters and
 * it is why this one keeps no `raw`: there is no per-turn structure to preserve
 * because there are no turns on the wire, only a transcript.
 */
function toPrompt(request: AiRequest): string {
  const parts: string[] = [];

  for (const message of request.messages) {
    if (message.role === 'user') parts.push(`Question: ${message.text}`);
    else if (message.role === 'assistant' && message.text) {
      parts.push(`Your previous answer: ${message.text}`);
    }
    // Tool traffic cannot occur here — `tools` is false, so the agent never
    // offers any and none can come back.
  }

  return parts.join('\n\n');
}

function createAdapter(instance: AiProvider): AiAdapter {
  return {
    kind: 'claudeCode',
    capabilities: driverInfo('claudeCode').capabilities,

    async send(request: AiRequest, sink: AiSink, signal: AbortSignal): Promise<AiReply> {
      /*
       * Only when there is something to run and someone to run it. A request
       * that carries no executor starts no listener at all.
       */
      const bridge: ToolBridge | undefined =
        request.execute && request.tools.length > 0
          ? await startToolBridge(request.tools, request.execute)
          : undefined;

      try {
        return await run(request, sink, signal, instance, bridge);
      } finally {
        // Closed on every path. A turn that threw must not leave a socket
        // listening on this machine.
        await bridge?.close();
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
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--system-prompt',
      request.system,
      /*
       * Exactly our tools and nothing else. `--tools` is a whitelist: with
       * our two MCP names on it the session has those and none of the
       * built-ins, which is the difference between an assistant that can
       * read a table and one that can rewrite the reader's home directory.
       */
      '--tools',
      ...(bridge?.toolNames ?? []),
      ...(bridge
        ? [
            '--mcp-config',
            JSON.stringify({
              mcpServers: {
                shelf: {
                  type: 'http',
                  url: bridge.url,
                  headers: { Authorization: `Bearer ${bridge.token}` },
                },
              },
            }),
            // Pre-approved, so a headless run never stops to ask a question
            // nobody is there to answer. It is safe to pre-approve because
            // the tool itself refuses anything that writes.
            '--allowedTools',
            ...bridge.toolNames,
          ]
        : []),
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--exclude-dynamic-system-prompt-sections',
      ...(instance.model && instance.model !== 'default' ? ['--model', instance.model] : []),
    ];

    const child = spawn(executable(), args, {
      // A directory with nothing in it. The CLI reads memory and settings
      // relative to where it is run, and running it inside whatever the app
      // happened to be launched from would put a stranger's project notes
      // into a prompt about their database.
      cwd: tmpdir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let text = '';
    let stderr = '';
    let usage: AiReply['usage'];
    let failed: string | undefined;
    let buffer = '';
    let settled = false;

    /** One line of the stream, whether it arrived mid-run or at the end. */
    const consume = (line: string): void => {
      const frame = parseFrame<Line>(line);
      if (!frame) return;

      if (frame.type === 'stream_event' && frame.event?.type === 'content_block_delta') {
        const delta = frame.event.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          text += delta.text;
          sink.text(delta.text);
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          sink.thinking(delta.thinking);
        }
        return;
      }

      if (frame.type === 'result') {
        if (frame.is_error) failed = frame.result ?? 'The assistant failed.';
        // The deltas carry the same text, but a run that produced no
        // partial frames at all still has its answer here.
        else if (!text && frame.result) text = frame.result;

        usage = {
          ...(frame.usage?.input_tokens !== undefined
            ? { inputTokens: frame.usage.input_tokens }
            : {}),
          ...(frame.usage?.output_tokens !== undefined
            ? { outputTokens: frame.usage.output_tokens }
            : {}),
        };
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

      /*
       * One JSON object per line, and a line can arrive in pieces. Anything
       * after the last newline is a partial object and waits for the next
       * chunk to complete it — parsing per chunk would drop a delta every
       * few hundred and never say so.
       */
      let at = buffer.indexOf('\n');
      while (at !== -1) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf('\n');
        if (!line) continue;

        consume(line);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Kept, but only shown if the process actually fails: the CLI writes
      // ordinary notices here too, and surfacing those as errors would make
      // every successful turn look broken.
      stderr += chunk;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          new AiError(
            error.code === 'ENOENT'
              ? 'Claude Code is not installed, or is not on this app\u2019s path.'
              : error.message
          )
        )
      );
    });

    /*
     * Settled on `exit`, never on `close`, and this distinction is the
     * whole reason the first build of this hung.
     *
     * `close` fires when the child has exited *and* every pipe it was given
     * has closed. The CLI starts helpers of its own — an MCP server, among
     * others — and those inherit its standard output; when the CLI exits,
     * they keep the pipe open and `close` never comes. The turn sat on a
     * promise that would never settle, showing a spinner, with the answer
     * already delivered and read.
     *
     * `exit` says the process is gone, which is the fact we actually need.
     * The last of the output may still be in flight at that moment, so the
     * stream is given a moment to end on its own before we stop waiting —
     * long enough for a buffer to drain, short enough that a held-open pipe
     * costs a fraction of a second rather than the whole turn.
     */
    const GRACE_MS = 500;
    // Never read before `exit` sets it; the initial value is only here because
    // TypeScript cannot see that ordering.
    let exitCode: number | null | undefined;
    let exited = false;
    let ended = false;
    let grace: NodeJS.Timeout | undefined;

    const conclude = () => {
      clearTimeout(grace);
      finish(() => {
        // Whatever never got a newline is still an answer.
        const tail = buffer.trim();
        if (tail) consume(tail);

        if (failed) return reject(new AiError(failed));
        if (exitCode !== 0) {
          return reject(
            new AiError(stderr.trim().slice(0, 400) || `Claude Code exited with ${exitCode}.`)
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

    // The prompt goes in on standard input rather than as an argument: a
    // schema document is tens of thousands of characters and the command
    // line has a limit that a large database would cross.
    child.stdin.end(toPrompt(request), 'utf8');
  });
}

export const ClaudeCodeDriver: AiDriver = {
  kind: 'claudeCode',
  capabilities: driverInfo('claudeCode').capabilities,
  create: createAdapter,
};
