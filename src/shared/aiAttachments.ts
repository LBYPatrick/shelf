import type { AiAttachment } from './ai';

/**
 * Putting an attached file into the question.
 *
 * Text attachments never reach an adapter as attachments: they are folded into
 * the question here, before anything provider-specific happens, which is what
 * makes them work with every provider including the three command-line ones
 * that have nowhere to put a content block. A picture cannot be folded into a
 * sentence, so that one stays an attachment and needs the provider's
 * permission.
 *
 * Pure, and unit tested, because everything here is a guess about content
 * somebody else wrote: a CSV containing a code fence, a log longer than the
 * context window, a file with no extension at all.
 */

/**
 * How much of one file is carried.
 *
 * A schema dump or a day of logs is bigger than the answer is worth, and the
 * cost of finding that out is a turn that fails after the reader has waited for
 * it. Cut, and *say* it was cut — the same rule the schema document follows,
 * because a truncated document presented as whole is the one thing that turns a
 * wrong answer into an unattributable one.
 */
export const ATTACHMENT_LIMIT = 32_000;

/**
 * A fence that cannot be closed by the content it wraps.
 *
 * A file with three backticks in it — a README, a chat log, anything about
 * markdown — closes a three-backtick fence early, and everything after it reads
 * as prose. The fence is always longer than the longest run inside.
 */
function fenceFor(text: string): string {
  const longest = [...text.matchAll(/`+/g)].reduce(
    (most, run) => Math.max(most, run[0].length),
    0
  );
  return '`'.repeat(Math.max(3, longest + 1));
}

/** The language tag for a fence, from the file's own name. */
function tagFor(name: string): string {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const KNOWN: Record<string, string> = {
    sql: 'sql',
    csv: 'csv',
    tsv: 'tsv',
    json: 'json',
    jsonl: 'json',
    md: 'markdown',
    markdown: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
  };
  return KNOWN[extension] ?? '';
}

/** One attachment, as the block that goes under the question. */
function block(name: string, text: string): string {
  const cut = text.length > ATTACHMENT_LIMIT;
  const body = cut ? text.slice(0, ATTACHMENT_LIMIT) : text;
  const fence = fenceFor(body);

  return [
    `Attached file: ${name}`,
    `${fence}${tagFor(name)}`,
    body,
    fence,
    cut
      ? `(Cut off at ${ATTACHMENT_LIMIT.toLocaleString('en-US')} characters. ` +
        'Say so if the answer depends on the rest.)'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The question, with every text attachment written out under it.
 *
 * Under rather than over, because the question is what the model is answering
 * and the files are what it is answering *from* — and a model reading forty
 * thousand characters before it reaches the sentence asking for something is a
 * model that has already lost the thread.
 */
export function questionWithAttachments(
  question: string,
  attachments: readonly AiAttachment[] = []
): string {
  const texts = attachments.filter((one) => one.kind === 'text');
  if (texts.length === 0) return question;

  return [question, ...texts.map((one) => block(one.name, one.text))].join('\n\n');
}

/** The pictures, in the shape the wire wants them. */
export function imagesOf(
  attachments: readonly AiAttachment[] = []
): readonly { readonly mediaType: string; readonly base64: string }[] {
  return attachments
    .filter((one) => one.kind === 'image')
    .map(({ mediaType, base64 }) => ({ mediaType, base64 }));
}

/**
 * The four picture formats every vision provider here takes.
 *
 * A closed list rather than `image/*`, because it is the list the providers
 * agree on — Anthropic narrows its own type to exactly these four — and
 * offering a TIFF that fails at the far end is worse than not offering it.
 */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/**
 * Extensions worth reading as text when the OS says nothing.
 *
 * A file dragged into an Electron window very often arrives with an empty
 * `type`, so the name is the only evidence there is. This is the list a
 * database client actually meets: a dump, a sample, a config, an error someone
 * has copied into a file.
 */
const TEXT_EXTENSIONS = [
  'sql',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ndjson',
  'txt',
  'log',
  'md',
  'markdown',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'env',
  'xml',
  'html',
  'css',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'sh',
];

/** How big a picture may be before it is refused, in bytes of file. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * What this file can be sent as, if anything.
 *
 * `null` means it cannot go — a PDF, a zip, a binary nobody can read as either
 * a picture or a sentence. The composer says so rather than attaching something
 * that arrives at the model as line noise.
 */
export function attachmentKind(name: string, mediaType: string): 'text' | 'image' | null {
  if ((IMAGE_TYPES as readonly string[]).includes(mediaType)) return 'image';
  if (mediaType.startsWith('text/')) return 'text';
  if (mediaType === 'application/json' || mediaType === 'application/xml') return 'text';

  // The OS said nothing useful, so the name is the evidence.
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (name.includes('.') && TEXT_EXTENSIONS.includes(extension)) return 'text';
  return null;
}
