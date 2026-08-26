import type { AiProvider, AiDriverKind } from '@shared/ai';
import { driverInfo, resolveBaseUrl } from '@shared/aiDrivers';
import { parseFrame, sseData } from '../sse';
import {
  describeFailure,
  type AiAdapter,
  type AiDriver,
  type AiReply,
  type AiRequest,
  type AiSink,
  type AiToolCall,
} from '../types';

/**
 * The chat-completions protocol, which by now is a lingua franca.
 *
 * One adapter serves OpenAI itself and everything that answers the same way —
 * Ollama, LM Studio, vLLM, a gateway on the company network. They differ by a
 * URL and a key, which is a configuration, so they are configurations: two
 * driver kinds share this implementation and are told apart only by which
 * default base URL and which capabilities the catalogue gives them.
 *
 * Written over `fetch` rather than a client library. The protocol is a POST and
 * a stream of JSON frames, and carrying a dependency tree into a desktop app to
 * express that is a poor trade — particularly for the local servers, whose
 * whole appeal is that nothing leaves the machine.
 */

interface Delta {
  readonly content?: string | null;
  /** Reasoning models put their working here, under one of two names. */
  readonly reasoning_content?: string | null;
  readonly reasoning?: string | null;
  readonly tool_calls?: readonly {
    readonly index: number;
    readonly id?: string;
    readonly function?: { readonly name?: string; readonly arguments?: string };
  }[];
}

interface Frame {
  readonly choices?: readonly {
    readonly delta?: Delta;
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  } | null;
}

/** A tool call assembled from however many frames it arrived in. */
interface PartialCall {
  id: string;
  name: string;
  args: string;
}

function toMessages(request: AiRequest): unknown[] {
  const messages: unknown[] = [{ role: 'system', content: request.system }];

  for (const message of request.messages) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: message.text });
      continue;
    }

    if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        // An assistant turn that only called tools has no content, and some
        // servers reject an empty string where they accept a null.
        content: message.text || null,
        ...(message.calls.length > 0
          ? {
              tool_calls: message.calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      });
      continue;
    }

    // One message per result here, unlike the block-based providers.
    for (const result of message.results) {
      messages.push({ role: 'tool', tool_call_id: result.id, content: result.content });
    }
  }

  return messages;
}

function createAdapter(kind: AiDriverKind, instance: AiProvider, apiKey?: string): AiAdapter {
  const base = resolveBaseUrl(kind, instance.baseUrl);
  const info = driverInfo(kind);

  return {
    kind,
    capabilities: info.capabilities,

    async send(request: AiRequest, sink: AiSink, signal: AbortSignal): Promise<AiReply> {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          // A local server has no key and rejects the header outright on some
          // builds, so it is sent only when there is one to send.
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: request.model,
          max_completion_tokens: request.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          messages: toMessages(request),
          ...(request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.schema,
                  },
                })),
              }
            : {}),
        }),
      });

      if (!response.ok) throw await describeFailure(response);

      let text = '';
      let finish = '';
      const partial = new Map<number, PartialCall>();
      let usage: AiReply['usage'];

      for await (const data of sseData(response, signal)) {
        const frame = parseFrame<Frame>(data);
        if (!frame) continue;

        if (frame.usage) {
          usage = {
            ...(frame.usage.prompt_tokens !== undefined
              ? { inputTokens: frame.usage.prompt_tokens }
              : {}),
            ...(frame.usage.completion_tokens !== undefined
              ? { outputTokens: frame.usage.completion_tokens }
              : {}),
          };
        }

        const choice = frame.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;

        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) {
          text += delta.content;
          sink.text(delta.content);
        }

        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (reasoning) sink.thinking(reasoning);

        /*
         * Tool calls arrive a few characters of JSON at a time, keyed by
         * position rather than by id — the id itself only appears on the first
         * frame of each. Accumulating by index is the only way to end up with
         * whole arguments; parsing per frame yields a syntax error per frame.
         */
        for (const call of delta.tool_calls ?? []) {
          const existing = partial.get(call.index) ?? { id: '', name: '', args: '' };
          partial.set(call.index, {
            id: call.id ?? existing.id,
            name: call.function?.name ?? existing.name,
            args: existing.args + (call.function?.arguments ?? ''),
          });
        }
      }

      const calls = [...partial.entries()]
        .sort(([a], [b]) => a - b)
        .map<AiToolCall>(([index, call]) => ({
          // A server that never sent an id still needs one to match the result
          // back to the call; its position is unique within the turn.
          id: call.id || `call_${index}`,
          name: call.name,
          input: parseFrame<Record<string, unknown>>(call.args || '{}') ?? {},
        }));

      return {
        text,
        calls,
        stop:
          calls.length > 0 || finish === 'tool_calls'
            ? 'tools'
            : finish === 'length'
              ? 'length'
              : 'end',
        ...(usage ? { usage } : {}),
      };
    },
  };
}

export const OpenAiDriver: AiDriver = {
  kind: 'openai',
  capabilities: driverInfo('openai').capabilities,
  create: (instance, apiKey) => createAdapter('openai', instance, apiKey),
};

export const OpenAiCompatibleDriver: AiDriver = {
  kind: 'openaiCompatible',
  capabilities: driverInfo('openaiCompatible').capabilities,
  create: (instance, apiKey) => createAdapter('openaiCompatible', instance, apiKey),
};
