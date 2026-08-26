/**
 * Reading a server-sent-event stream, once, for the adapters that need one.
 *
 * Two of the three providers stream over SSE and neither ships a client we are
 * already carrying, so this is the shared half: split on blank lines, keep the
 * `data:` payloads, stop at the sentinel. Written out rather than reached for,
 * because the interesting part is the part a naive implementation gets wrong —
 * a chunk boundary lands in the middle of a frame far more often than it lands
 * between two, and a reader that parses per chunk drops a token every few
 * hundred and never says so.
 */

/** Yields the body of each `data:` field, in order, until the stream ends. */
export async function* sseData(
  response: Response,
  signal: AbortSignal
): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      /*
       * A frame ends at a blank line, and the line ending may be either — some
       * gateways rewrite them. Everything after the last blank line is a
       * partial frame and stays in the buffer for the next chunk to complete.
       */
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer[boundary] === '\r' ? 4 : 2));

        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');

        if (data && data !== '[DONE]') yield data;
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
  } finally {
    // Cancelling releases the socket. Without it an aborted turn leaves the
    // connection open until the provider times it out, and a chat where every
    // interruption leaks one is a chat that stops answering after a dozen.
    await reader.cancel().catch(() => undefined);
  }
}

/** `JSON.parse` that skips a frame rather than ending the stream over it. */
export function parseFrame<T>(data: string): T | undefined {
  try {
    return JSON.parse(data) as T;
  } catch {
    return undefined;
  }
}
