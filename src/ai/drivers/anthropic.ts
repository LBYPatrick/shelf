import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider } from '@shared/ai';
import { resolveBaseUrl, driverInfo } from '@shared/aiDrivers';
import {
  AiError,
  type AiAdapter,
  type AiDriver,
  type AiReply,
  type AiRequest,
  type AiSink,
  type AiToolCall,
} from '../types';

/**
 * Anthropic, through its own SDK.
 *
 * The one adapter that does not hand-roll its transport, because the SDK is
 * where the retry policy, the stream framing and the error taxonomy already
 * live — reimplementing those over `fetch` would be three things to get wrong
 * for no gain. The other adapters do hand-roll them, and that asymmetry is
 * deliberate rather than untidy: carrying a client library per provider would
 * put four transitive dependency trees inside a desktop app to save four files.
 *
 * Reasoning is asked for and shown. Adaptive thinking is on for these models
 * whether or not it is requested, so the choice is not whether the model thinks
 * but whether the reader can see that it is: the default returns the blocks
 * empty, which during a long turn is a spinner and nothing else.
 *
 * The turn's own content blocks are carried back out through `raw` and returned
 * verbatim on the next request. This is not an optimisation — a turn that
 * thought and then called a tool must present that reasoning again alongside
 * the tool result, and a message rebuilt from text and calls does not have it.
 */

/** Blocks as the API returns them, kept opaque above this file. */
type Content = Anthropic.ContentBlockParam[];

function toContent(request: AiRequest): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const message of request.messages) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: message.text });
      continue;
    }

    if (message.role === 'assistant') {
      // Said back exactly as it was said, where we kept it.
      if (Array.isArray(message.raw) && message.raw.length > 0) {
        messages.push({ role: 'assistant', content: message.raw as Content });
        continue;
      }

      const content: Content = [];
      if (message.text) content.push({ type: 'text', text: message.text });
      for (const call of message.calls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      if (content.length > 0) messages.push({ role: 'assistant', content });
      continue;
    }

    /*
     * Every result for one assistant turn goes in a single user message.
     * Splitting them across several is the documented way to teach a model to
     * stop making parallel calls, and the loop above already batches them.
     */
    messages.push({
      role: 'user',
      content: message.results.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.id,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      })),
    });
  }

  return messages;
}

function createAdapter(instance: AiProvider, apiKey: string | undefined): AiAdapter {
  const client = new Anthropic({
    apiKey: apiKey ?? '',
    baseURL: resolveBaseUrl('anthropic', instance.baseUrl),
    // The host retries nothing else; a rate limit answered by the library is
    // the one place a retry is both correct and invisible.
    maxRetries: 2,
  });

  return {
    kind: 'anthropic',
    capabilities: driverInfo('anthropic').capabilities,

    async send(request: AiRequest, sink: AiSink, signal: AbortSignal): Promise<AiReply> {
      const stream = client.messages.stream(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: [
            {
              type: 'text',
              text: request.system,
              /*
               * The schema is the long half of the prompt and it does not
               * change between turns of a conversation, so it is cached here
               * and the question goes after it. Order is what makes that work:
               * a cache is a prefix match, and anything volatile above this
               * point would invalidate everything below it.
               */
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: toContent(request),
          ...(request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.schema as Anthropic.Tool.InputSchema,
                })),
              }
            : {}),
          thinking: { type: 'adaptive', display: 'summarized' },
        },
        { signal }
      );

      stream.on('text', (delta) => sink.text(delta));
      stream.on('thinking', (delta) => sink.thinking(delta));

      let message: Anthropic.Message;
      try {
        message = await stream.finalMessage();
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof Anthropic.APIError) {
          throw new AiError(error.message, error.status);
        }
        throw error;
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const calls = message.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map<AiToolCall>((block) => ({
          id: block.id,
          name: block.name,
          // Never string-matched: escaping in tool input varies by model, and
          // the SDK has already parsed it into a value.
          input: (block.input ?? {}) as Record<string, unknown>,
        }));

      /*
       * A refusal is an HTTP 200 with nothing usable in it. Reported as an
       * error rather than as an empty reply, which would look like the
       * assistant having nothing to say.
       */
      if (message.stop_reason === 'refusal') {
        throw new AiError(
          message.stop_details?.explanation ?? 'The provider declined to answer this request.'
        );
      }

      return {
        text,
        calls,
        stop:
          message.stop_reason === 'tool_use'
            ? 'tools'
            : message.stop_reason === 'max_tokens'
              ? 'length'
              : 'end',
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
        raw: message.content as unknown,
      };
    },
  };
}

export const AnthropicDriver: AiDriver = {
  kind: 'anthropic',
  capabilities: driverInfo('anthropic').capabilities,
  create: createAdapter,
};
