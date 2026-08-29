import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type { AiDriverKind } from '@shared/ai';
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
      /*
       * A string while there is only text, an array of blocks when a picture
       * came with it. Both are valid; the string is what this sent before
       * attachments existed and is left alone so an ordinary turn is byte for
       * byte the request it always was.
       */
      messages.push({
        role: 'user',
        content:
          message.images && message.images.length > 0
            ? [
                ...message.images.map((image): Anthropic.ContentBlockParam => ({
                  type: 'image',
                  source: {
                    type: 'base64',
                    /*
                     * The SDK narrows this to the four types the API takes.
                     * The composer only ever attaches one of those four, so
                     * the assertion is a restatement of a rule enforced where
                     * the file is chosen rather than a hole in one.
                     */
                    media_type: image.mediaType as Anthropic.Base64ImageSource['media_type'],
                    data: image.base64,
                  },
                })),
                { type: 'text', text: message.text },
              ]
            : message.text,
      });
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

/**
 * The messages API, given something that speaks it.
 *
 * Two drivers reach this: Anthropic's own API and AWS Bedrock. Bedrock is the
 * same models behind a different front door — the SDK's `AnthropicBedrock`
 * exposes the identical `messages.stream`, differing only in that it signs with
 * AWS credentials instead of carrying a key — so the turn logic is shared and
 * the two drivers are the two client constructors. Copying a hundred lines to
 * change one of them would be a hundred lines that stop agreeing.
 *
 * The parameter is the union of the two clients rather than the SDK's shared
 * base class: the base class is the transport and does not declare `messages`,
 * which is the only thing this function uses.
 */
function adapterOver(kind: AiDriverKind, client: Anthropic | AnthropicBedrock): AiAdapter {
  return {
    kind,
    capabilities: driverInfo(kind).capabilities,

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
  create: (instance, apiKey) =>
    adapterOver(
      'anthropic',
      new Anthropic({
        apiKey: apiKey ?? '',
        baseURL: resolveBaseUrl('anthropic', instance.baseUrl),
        // The host retries nothing else; a rate limit answered by the library
        // is the one place a retry is both correct and invisible.
        maxRetries: 2,
      })
    ),
};

/**
 * The same models, through AWS.
 *
 * **No key, and none is asked for.** Bedrock authenticates with AWS
 * credentials, and the SDK reads them the way every other AWS tool on the
 * machine does — the environment, `~/.aws/credentials`, a profile, an SSO
 * session, or an instance role. Copying an access key and a secret into this
 * app's keyring would be a second place for a credential to live and go stale,
 * and it is the one thing somebody with Bedrock access already has set up. So
 * the catalogue declares `acceptsKey: false` and the form shows no field.
 *
 * What it does need is the **region**, because SigV4 signs for one and a
 * request signed for the wrong region is rejected before it is read. That is
 * what this driver keeps in `baseUrl` — declared as a region in the catalogue
 * so the form asks for a region rather than a URL — and the SDK builds the
 * endpoint from it. Passing the endpoint instead does not work: the client
 * takes the URL and goes on signing for `us-east-1`.
 */
export const BedrockDriver: AiDriver = {
  kind: 'bedrock',
  capabilities: driverInfo('bedrock').capabilities,
  create: (instance) =>
    adapterOver(
      'bedrock',
      new AnthropicBedrock({
        awsRegion: resolveBaseUrl('bedrock', instance.baseUrl),
        maxRetries: 2,
      })
    ),
};
