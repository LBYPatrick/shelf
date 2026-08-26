/**
 * What the assistant is told, and how what it says is read back.
 *
 * Pure, and unit tested, because both halves fail quietly. A prompt that
 * forgets to name the dialect produces a query that is valid SQL and wrong for
 * this server; an extractor that mishandles a fence produces an editor with
 * half a statement in it and a prose sentence on the end. Neither throws.
 *
 * The prompt is assembled rather than templated in one string so the parts that
 * differ — the engine, the scope, whether the model may run anything — are
 * visible as parts. It is also stable in its ordering, which is what lets a
 * provider cache the long half of it: the schema is the expensive part and it
 * goes before the question, never after.
 */

import { classifyStatement } from './sqlSafety';
import { schemaDocumentText, scopeLabel, type SchemaDocument } from './schemaDoc';

/**
 * The rules, in the order they matter.
 *
 * The read-only rule is stated here *as well as* enforced in the agent. Saying
 * it changes what the model writes — asked to delete something, it produces a
 * statement and an explanation rather than a tool call that gets refused, which
 * is a better answer and one fewer round trip. Enforcing it is what makes it
 * true.
 */
const ROLE =
  'You are a database assistant inside a desktop SQL client. The person you are helping is looking at their own database.';

const ACCURACY =
  'Write queries for the exact engine named below, in its own dialect. Quote identifiers the way that engine does. Never invent a table, column, or function that is not in the schema you were given.';

const MAY_READ =
  'You may run read-only statements yourself to check your work, and you should when the answer depends on what is actually in the data.';

/**
 * The distinction the interface is built around, explained in terms of what it
 * *does* rather than as a label to pick.
 *
 * A model told only "set intent" sets it to whatever it ran last. Told what
 * happens to each — one is folded away, one is put in front of the reader —
 * it chooses the way a person would.
 */
const INTENT =
  'Every query you run is either working or the answer, and you say which with `intent`. Use `check` while you are working things out — counting to be sure, sampling a column, confirming a join exists. A check is folded away in the conversation, so run as many as you need. Use `answer` only for the query whose rows are the reply to what was asked; that one is shown in full, so there should usually be exactly one of them, and often none when the reply is an explanation rather than a table.';

const TITLES =
  'Give every query a `purpose` of a few words that names what it produces — "Albums per artist", "Rows in each table" — not what you are doing, and not a sentence. It is shown as the query\'s name and becomes the name of the tab if the person opens it. When you write a statement out in prose instead of running it, put the same short name on the fence: ```sql title=Albums per artist';

const MAY_NOT_WRITE =
  'You must never run anything that modifies data or schema. If the request calls for INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, TRUNCATE, or GRANT, do not attempt to run it: write the statement out, say plainly what it would change, and leave running it to the person. That is not a limitation to apologise for — it is how this works.';

const NOTHING_RUNS =
  'You cannot run anything here. Answer with the statement itself and a short note about what it does.';

const SHAPE =
  'Prefer one statement that answers the question over several that approach it. Add a LIMIT when a result could be large.';

const BREVITY = 'Be brief. A query and one sentence about it beats three paragraphs.';

/**
 * The language a reply is written in.
 *
 * A default rather than an override, and the distinction is the whole rule: the
 * interface being in Japanese does not mean the question was asked in Japanese,
 * and answering a question in a language it was not asked in is worse than any
 * amount of not knowing which language to use. So the question decides, and the
 * interface's language settles the cases where the question cannot — "orders",
 * a bare table name, a single word.
 *
 * The clause about identifiers is not decoration. Told to answer in Chinese, a
 * model will happily translate `play_count` in the prose around a query and
 * leave the reader looking for a column that does not exist.
 */
const replyIn = (language: string): string =>
  `Reply in the language the question is written in. When that is unclear — a question that is one word, or mostly a name out of the schema — reply in ${language}, which is the language this person reads the interface in. Names out of the database and the SQL itself are always written exactly as they are spelled there, never translated.`;

/**
 * A language tag as a name a model will recognise.
 *
 * `Intl` rather than a table of our own: the interface ships five languages and
 * a table would be a sixth place to remember when a sixth is added, while this
 * answers for any tag and falls back to the tag itself — which a model reads
 * perfectly well — when the runtime has no name for it.
 */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export interface PromptContext {
  readonly document: SchemaDocument;
  /** False when the provider has no tool use, so nothing can be run. */
  readonly canRun: boolean;
  /**
   * The interface's language, as a BCP-47 tag. Absent means say nothing about
   * it, which is what a model does by default anyway.
   */
  readonly locale?: string;
}

export function systemPrompt(context: PromptContext): string {
  const { document } = context;
  const nouns = document.nouns;

  const language = context.locale ? [replyIn(languageName(context.locale))] : [];

  const conduct = context.canRun
    ? [ROLE, ACCURACY, MAY_READ, INTENT, MAY_NOT_WRITE, SHAPE, TITLES, ...language, BREVITY]
    : [ROLE, ACCURACY, NOTHING_RUNS, SHAPE, TITLES, ...language, BREVITY];

  const parts = [
    ...conduct,
    '',
    `Engine: ${document.engine}. Query language: ${document.language}.`,
    `This engine calls them ${nouns.database}s, ${nouns.entity}s, ${nouns.row}s and ${nouns.column}s — use its words.`,
    `You are looking at ${scopeLabel(document.scope)}.`,
    ...(document.omissions?.length
      ? ['', 'What you were not shown:', ...document.omissions.map((note) => `- ${note}`)]
      : []),
    '',
    'Schema, as JSON:',
    schemaDocumentText(document),
  ];

  return parts.join('\n');
}

/**
 * Splits a chat reply into the prose and the statements it contained.
 *
 * The chat draws SQL as SQL — a block with its own actions on it — rather than
 * as monospace text inside a paragraph, so the reply is taken apart here rather
 * than handed to a markdown renderer that would give it a grey background and
 * nothing else. Everything outside a fence stays prose, in order, so a reply
 * that explains, shows, and then explains again reads in that order.
 */
export interface ReplyPart {
  readonly kind: 'text' | 'sql';
  readonly text: string;
  /** What the fence called it, where it said. */
  readonly title?: string;
}

/**
 * The info string is captured whole, not just its language.
 *
 * A block the model wrote out rather than ran has no `purpose` to take a name
 * from, so the name rides on the fence: ```sql title=Albums per artist. Read
 * here rather than asked for a second time, because a round trip to name
 * something already on screen is a round trip the reader waits through.
 */
const ALL_FENCES = /```([^\n]*)\n([\s\S]*?)```/g;

const FENCE_TITLE = /\btitle\s*[=:]\s*"?([^"\n]+?)"?\s*$/i;

export function splitReply(reply: string): readonly ReplyPart[] {
  const parts: ReplyPart[] = [];
  let cursor = 0;

  for (const match of reply.matchAll(ALL_FENCES)) {
    const at = match.index ?? 0;
    const before = reply.slice(cursor, at).trim();
    if (before) parts.push({ kind: 'text', text: before });

    const body = (match[2] ?? '').trim();
    const info = (match[1] ?? '').trim();
    const language = (info.split(/[\s,]/)[0] ?? '').toLowerCase();
    const title = FENCE_TITLE.exec(info)?.[1]?.trim();
    /*
     * A fence with no language is only SQL if it reads like SQL. A model
     * showing a table of results in an unlabelled fence would otherwise get an
     * "Open in query tab" button on a block of numbers.
     */
    const isSql =
      language === 'sql' ||
      language === 'postgresql' ||
      language === 'mysql' ||
      language === 'sqlite' ||
      (language === '' && classifyStatement(body) !== 'unknown');

    if (body) {
      parts.push({
        kind: isSql ? 'sql' : 'text',
        text: body,
        ...(isSql && title ? { title } : {}),
      });
    }
    cursor = at + match[0].length;
  }

  const tail = reply.slice(cursor).trim();
  if (tail) parts.push({ kind: 'text', text: tail });

  return parts;
}
