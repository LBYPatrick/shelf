/**
 * Markdown, as a tree rather than as HTML.
 *
 * Models write markdown whether or not they are asked to — bold, bullets,
 * backticks, the occasional table — and rendering it as plain text puts
 * `**this**` on screen with its asterisks. So it has to be parsed.
 *
 * What it must *not* do is produce HTML. The text here is written by a language
 * model, which is to say by something that has read the internet and may be
 * repeating a database column's contents back at us; handing that to `v-html`
 * makes every table cell in someone's database a script tag waiting for a
 * reader. Sanitising afterwards is the usual answer and it is a library, a
 * configuration, and a class of bug that is never quite closed.
 *
 * The alternative is simply not to make HTML: this returns a tree of tagged
 * nodes, and the renderer walks it building real elements with real text nodes.
 * Nothing is ever interpreted as markup, so there is nothing to sanitise.
 *
 * Deliberately a small dialect — the one models actually emit in a chat reply.
 * Fenced code is *not* handled here: `aiPrompt.ts` has already lifted those out
 * into SQL blocks with their own actions, and a second code path for them would
 * be two ways to draw the same thing.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'em'; readonly children: readonly Inline[] }
  | { readonly kind: 'strike'; readonly children: readonly Inline[] }
  /** `href` is kept only when it is a scheme we are willing to open. */
  | { readonly kind: 'link'; readonly text: string; readonly href?: string };

export type Block =
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | {
      readonly kind: 'heading';
      readonly level: 1 | 2 | 3;
      readonly children: readonly Inline[];
    }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly Block[])[];
    }
  | { readonly kind: 'quote'; readonly children: readonly Block[] }
  | { readonly kind: 'rule' }
  | {
      readonly kind: 'table';
      readonly head: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    };

/**
 * Which links we are prepared to hand to the browser.
 *
 * `javascript:` is the obvious one and `data:` is the one people forget — a
 * `data:text/html` URL is a document, and a document is a script. Anything not
 * on this list keeps its text and loses its href, so the reader still sees what
 * was written and nothing can be navigated to.
 */
const SAFE_SCHEME = /^(https?|mailto):/i;

function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  return SAFE_SCHEME.test(trimmed) ? trimmed : undefined;
}

/* ------------------------------------------------------------------ inline */

/**
 * The inline grammar, in one pass.
 *
 * Code spans are matched before everything else, because their contents are
 * literal: `` `**not bold**` `` is four asterisks and two words. Doing it in the
 * same alternation rather than a separate pre-pass is what keeps that true
 * without having to stash and restore the spans.
 */
const INLINE =
  /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<!\w)\*([^*\n]+?)\*(?!\w)|(?<!\w)_([^_\n]+?)_(?!\w)|~~([\s\S]+?)~~|\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\s*(?:"[^"]*")?\)|<((?:https?|mailto):[^>\s]+)>/;

export function parseInline(source: string): readonly Inline[] {
  const nodes: Inline[] = [];
  let rest = source;

  for (;;) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) break;

    if (match.index > 0) nodes.push({ kind: 'text', text: rest.slice(0, match.index) });

    const [
      whole,
      ,
      code,
      strongStar,
      strongUnder,
      emStar,
      emUnder,
      strike,
      linkText,
      href,
      auto,
    ] = match;

    if (code !== undefined) {
      // A span is written with as many backticks as it needs; the padding space
      // that allows a leading backtick inside it is not part of the content.
      nodes.push({ kind: 'code', text: code.replace(/^ | $/g, '') });
    } else if (strongStar ?? strongUnder) {
      nodes.push({ kind: 'strong', children: parseInline((strongStar ?? strongUnder)!) });
    } else if (emStar ?? emUnder) {
      nodes.push({ kind: 'em', children: parseInline((emStar ?? emUnder)!) });
    } else if (strike !== undefined) {
      nodes.push({ kind: 'strike', children: parseInline(strike) });
    } else if (href !== undefined) {
      const safe = safeHref(href);
      nodes.push({
        kind: 'link',
        text: linkText || href,
        ...(safe ? { href: safe } : {}),
      });
    } else if (auto !== undefined) {
      const safe = safeHref(auto);
      nodes.push({ kind: 'link', text: auto, ...(safe ? { href: safe } : {}) });
    }

    rest = rest.slice(match.index + whole!.length);
  }

  if (rest) nodes.push({ kind: 'text', text: rest });
  return nodes;
}

/* ------------------------------------------------------------------ blocks */

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const NUMBER = /^(\d+)[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** How deep a line is indented, in units of two spaces. */
function depthOf(line: string): number {
  const spaces = /^[ \t]*/.exec(line)?.[0] ?? '';
  return Math.floor(spaces.replace(/\t/g, '  ').length / 2);
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseMarkdown(source: string): readonly Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let at = 0;

  const paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph.length = 0;
  };

  while (at < lines.length) {
    const line = lines[at]!;
    const trimmed = line.trim();

    if (!trimmed) {
      flush();
      at += 1;
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      at += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2]!),
      });
      at += 1;
      continue;
    }

    /*
     * A table needs its separator row to be a table at all: a line with pipes
     * in it is far more often a sentence than a header, and guessing wrong
     * turns a paragraph into a one-column grid.
     */
    if (trimmed.includes('|') && lines[at + 1] && TABLE_RULE.test(lines[at + 1]!)) {
      flush();
      const head = cells(trimmed).map(parseInline);
      at += 2;

      const rows: (readonly Inline[])[][] = [];
      while (at < lines.length && lines[at]!.includes('|') && lines[at]!.trim()) {
        rows.push(cells(lines[at]!).map(parseInline));
        at += 1;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    if (QUOTE.test(trimmed)) {
      flush();
      const quoted: string[] = [];
      while (at < lines.length && QUOTE.test(lines[at]!.trim())) {
        quoted.push(QUOTE.exec(lines[at]!.trim())![1]!);
        at += 1;
      }
      blocks.push({ kind: 'quote', children: parseMarkdown(quoted.join('\n')) });
      continue;
    }

    if (BULLET.test(trimmed) || NUMBER.test(trimmed)) {
      flush();
      const ordered = NUMBER.test(trimmed);
      const baseDepth = depthOf(line);
      /** The raw lines of each item, parsed once the list has ended. */
      const items: string[][] = [];

      while (at < lines.length) {
        const candidate = lines[at]!;
        const bare = candidate.trim();

        /*
         * A blank line ends the list unless what follows still belongs to it —
         * another item, or an indented continuation. Without this the paragraph
         * after a list was swallowed as a continuation of its last bullet,
         * which is exactly what a model's reply looks like: a list, a blank
         * line, and a closing sentence.
         */
        if (!bare) {
          const next = lines[at + 1]?.trim();
          const continues =
            next !== undefined &&
            next !== '' &&
            (depthOf(lines[at + 1]!) > baseDepth || BULLET.test(next) || NUMBER.test(next));
          if (!continues) break;
          items[items.length - 1]?.push('');
          at += 1;
          continue;
        }

        const depth = depthOf(candidate);
        if (depth < baseDepth) break;

        const marker = BULLET.exec(bare) ?? NUMBER.exec(bare);
        const isItem = marker !== null && depth === baseDepth;

        if (isItem) {
          // A list of a different kind is a different list, not a new item.
          if (NUMBER.test(bare) !== ordered) break;
          items.push([NUMBER.test(bare) ? marker![2]! : marker![1]!]);
        } else if (depth > baseDepth && items.length > 0) {
          // Indented under the current item: a wrapped line, or a nested list.
          // Its own indentation comes off so the recursive parse starts at
          // column zero.
          items[items.length - 1]!.push(candidate.slice(baseDepth * 2 + 2));
        } else {
          break;
        }

        at += 1;
      }

      blocks.push({
        kind: 'list',
        ordered,
        items: items.map((item) => parseMarkdown(item.join('\n')) as Block[]),
      });
      continue;
    }

    paragraph.push(trimmed);
    at += 1;
  }

  flush();
  return blocks;
}

/** Whether a reply has anything in it worth drawing. */
export function isEmpty(blocks: readonly Block[]): boolean {
  return blocks.length === 0;
}
