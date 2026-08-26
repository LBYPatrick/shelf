import type { AiProvider } from '@shared/ai';
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
 * Gemini's generative-language API.
 *
 * Three things about it differ enough from the other two to be worth naming,
 * because each is a place a shared implementation would have been wrong:
 *
 *   - The assistant's role is `model`, and the system prompt is a field of its
 *     own rather than a first message.
 *   - A function call carries **no id**. There is nothing to echo back, so a
 *     result is matched to its call by *name*, and the ids this adapter reports
 *     upward are positions it made up so the layer above can keep its shape.
 *   - Reasoning arrives as ordinary text parts flagged `thought`, in the same
 *     list as the answer. Reading the flag is the whole difference between a
 *     chat that shows working and one that pastes it into the reply.
 */

interface Part {
  readonly text?: string;
  readonly thought?: boolean;
  readonly functionCall?: { readonly name: string; readonly args?: Record<string, unknown> };
}

interface Frame {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly Part[] };
    readonly finishReason?: string;
  }[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
  };
}

function toContents(request: AiRequest): unknown[] {
  const contents: unknown[] = [];
  /** Which call each synthesised id belonged to, so a result can name it. */
  const nameOf = new Map<string, string>();

  for (const message of request.messages) {
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.text }] });
      continue;
    }

    if (message.role === 'assistant') {
      const parts: unknown[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.calls) {
        nameOf.set(call.id, call.name);
        parts.push({ functionCall: { name: call.name, args: call.input } });
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
      continue;
    }

    contents.push({
      role: 'user',
      parts: message.results.map((result) => ({
        functionResponse: {
          name: nameOf.get(result.id) ?? result.name,
          /*
           * The response must be an object, and the tools here answer with
           * JSON text. Wrapping it in one field rather than parsing it keeps
           * an answer that is a list — or that failed and is a sentence — from
           * having to be reshaped to fit.
           */
          response: { result: result.content },
        },
      })),
    });
  }

  return contents;
}

function createAdapter(instance: AiProvider, apiKey: string | undefined): AiAdapter {
  const base = resolveBaseUrl('google', instance.baseUrl);

  return {
    kind: 'google',
    capabilities: driverInfo('google').capabilities,

    async send(request: AiRequest, sink: AiSink, signal: AbortSignal): Promise<AiReply> {
      const url = `${base}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;

      const response = await fetch(url, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          // In the header rather than the query string: a key in a URL ends up
          // in every log the request passes through.
          ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: toContents(request),
          ...(request.tools.length > 0
            ? {
                tools: [
                  {
                    functionDeclarations: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.schema,
                    })),
                  },
                ],
              }
            : {}),
          generationConfig: { maxOutputTokens: request.maxTokens },
        }),
      });

      if (!response.ok) throw await describeFailure(response);

      let text = '';
      let finish = '';
      const calls: AiToolCall[] = [];
      let usage: AiReply['usage'];

      for await (const data of sseData(response, signal)) {
        const frame = parseFrame<Frame>(data);
        if (!frame) continue;

        if (frame.usageMetadata) {
          usage = {
            ...(frame.usageMetadata.promptTokenCount !== undefined
              ? { inputTokens: frame.usageMetadata.promptTokenCount }
              : {}),
            ...(frame.usageMetadata.candidatesTokenCount !== undefined
              ? { outputTokens: frame.usageMetadata.candidatesTokenCount }
              : {}),
          };
        }

        const candidate = frame.candidates?.[0];
        if (!candidate) continue;
        if (candidate.finishReason) finish = candidate.finishReason;

        for (const part of candidate.content?.parts ?? []) {
          if (part.functionCall) {
            calls.push({
              id: `call_${calls.length}`,
              name: part.functionCall.name,
              input: part.functionCall.args ?? {},
            });
            continue;
          }
          if (!part.text) continue;
          if (part.thought) {
            sink.thinking(part.text);
            continue;
          }
          text += part.text;
          sink.text(part.text);
        }
      }

      return {
        text,
        calls,
        stop: calls.length > 0 ? 'tools' : finish === 'MAX_TOKENS' ? 'length' : 'end',
        ...(usage ? { usage } : {}),
      };
    },
  };
}

export const GoogleDriver: AiDriver = {
  kind: 'google',
  capabilities: driverInfo('google').capabilities,
  create: createAdapter,
};
