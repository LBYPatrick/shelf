import type { ConnectionConfig, EngineId } from '../drivers/types';
import type { SaveConnectionInput, SavedConnection } from './connections';
import { ENGINES } from './engines';
import { isObject } from './json';

/**
 * Connections as a file.
 *
 * The document carries everything needed to reach a database, credentials
 * included, so that moving a machine is one file rather than one file and a
 * round of remembering passwords. That is what it is for.
 *
 * The cost is real and is not hidden: this is the one artefact that leaves the
 * machine, and it is the thing people commit to a repository, paste into a
 * ticket and mail to a colleague. So the secrets sit in a field of their own
 * called `secrets` rather than mixed into the configuration, and the note at
 * the top of every document says in the first line what the file holds. A
 * reader who opens it, or who is about to attach it to something, is told by
 * the file itself.
 *
 * On the way back in, a document that carries secrets writes them to the OS
 * keyring like any other saved connection — the file is a transport, not a
 * store, and nothing keeps a plaintext copy afterwards.
 */

export const CONNECTION_DOCUMENT_KIND = 'shelf.connections';
export const CONNECTION_DOCUMENT_VERSION = 1;

/** One connection, as it appears in the file. */
export interface ConnectionPreset {
  readonly name: string;
  readonly engine: EngineId;
  readonly labelColor?: string | null;
  readonly readOnly?: boolean;
  readonly config: Omit<ConnectionConfig, 'password'>;
  /**
   * The credentials, in plain text, when the export was given them.
   *
   * Its own field rather than folded into `config`, so that what is sensitive
   * about the document is one key a reader can see, delete, or refuse to
   * commit — and so that stripping it by hand leaves a file that still parses.
   */
  readonly secrets?: Readonly<Record<string, string>>;
}

export interface ConnectionDocument {
  readonly kind: typeof CONNECTION_DOCUMENT_KIND;
  readonly version: number;
  /** Present in the file so the reader learns the rule without being told. */
  readonly note: string;
  readonly connections: readonly ConnectionPreset[];
}

const NOTE_WITH_SECRETS =
  'This file contains passwords in plain text, under "secrets". Treat it like a ' +
  'password: do not commit it, and delete it once it has been imported.';

const NOTE_WITHOUT_SECRETS =
  'No passwords are included. The connections will ask for them the first time they open.';

const ENGINE_IDS: ReadonlySet<string> = new Set(ENGINES.map((engine) => engine.id));

/**
 * The secrets for a connection, keyed by its id.
 *
 * Passed in rather than read here: this module is shared, and the keyring is
 * the main process's. A caller with nothing to give writes a document without
 * a `secrets` field, which is a valid document and says so in its note.
 */
export type SecretsById = Readonly<Record<string, Readonly<Record<string, string>>>>;

function presetOf(connection: SavedConnection, secrets?: SecretsById): ConnectionPreset {
  const { password: _password, ...config } = connection.config as ConnectionConfig;

  // Empty is the same as absent. A `secrets: {}` in the file would say the
  // export carried credentials when it carried nothing.
  const held = secrets?.[connection.id];
  const carried = held && Object.keys(held).length > 0 ? held : undefined;

  return {
    name: connection.name,
    engine: connection.engine,
    labelColor: connection.labelColor,
    readOnly: connection.readOnly,
    config,
    ...(carried ? { secrets: carried } : {}),
  };
}

function toConnectionDocument(
  connections: readonly SavedConnection[],
  secrets?: SecretsById
): ConnectionDocument {
  const presets = connections.map((connection) => presetOf(connection, secrets));
  return {
    kind: CONNECTION_DOCUMENT_KIND,
    version: CONNECTION_DOCUMENT_VERSION,
    note: presets.some((preset) => preset.secrets) ? NOTE_WITH_SECRETS : NOTE_WITHOUT_SECRETS,
    connections: presets,
  };
}

export function serializeConnections(
  connections: readonly SavedConnection[],
  secrets?: SecretsById
): string {
  return `${JSON.stringify(toConnectionDocument(connections, secrets), null, 2)}\n`;
}

export type ParseResult =
  | { readonly ok: true; readonly connections: readonly SaveConnectionInput[] }
  | { readonly ok: false; readonly error: string };

/**
 * Reads one entry, or says why it could not.
 *
 * Every field is checked rather than cast. This parses a file a person edited
 * by hand, and the failure mode of trusting it is a connection that looks
 * saved and cannot be opened.
 */
function readPreset(value: unknown, index: number): SaveConnectionInput | string {
  const where = `connections[${index}]`;
  if (!isObject(value)) return `${where} is not an object.`;

  const name = value['name'];
  if (typeof name !== 'string' || name.trim() === '') return `${where} has no name.`;

  const engine = value['engine'];
  if (typeof engine !== 'string' || !ENGINE_IDS.has(engine)) {
    return `${where} names an engine this build does not have: ${String(engine)}.`;
  }

  const config = value['config'];
  if (!isObject(config)) return `${where} has no config.`;

  // The engine is carried in two places in the saved shape, and the document's
  // own field is the one that was validated.
  const { password: _password, ...rest } = config;

  const labelColor = value['labelColor'];
  const readOnly = value['readOnly'];

  /*
   * Secrets, if the document brought any. Every value has to be a string —
   * this is a file somebody may have edited, and a number or a nested object
   * here would reach the keyring as `[object Object]` and fail at connect time
   * rather than at import time.
   */
  const given = value['secrets'];
  const secrets: Record<string, string> = {};
  if (isObject(given)) {
    for (const [key, secret] of Object.entries(given)) {
      if (typeof secret !== 'string') return `${where} has a non-text secret: ${key}.`;
      if (secret !== '') secrets[key] = secret;
    }
  }
  const carried = Object.keys(secrets).length > 0;

  return {
    name: name.trim(),
    engine: engine as EngineId,
    labelColor: typeof labelColor === 'string' ? labelColor : null,
    readOnly: readOnly === true,
    // Remembered only when the document actually carried something to remember.
    rememberSecrets: carried,
    ...(carried ? { secrets } : {}),
    config: { ...rest, engine: engine as EngineId } as Omit<ConnectionConfig, 'password'>,
  };
}

/**
 * Parses a connection document.
 *
 * A bare array of presets is accepted as well as the wrapped document, because
 * that is what someone pastes when they have copied one section out of a
 * larger file, and refusing it teaches them nothing.
 */
export function parseConnections(json: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed['connections'])
      ? (parsed['connections'] as unknown[])
      : undefined;

  if (!entries) {
    return { ok: false, error: 'Expected a document with a "connections" array.' };
  }
  if (entries.length === 0) {
    return { ok: false, error: 'The document holds no connections.' };
  }

  const connections: SaveConnectionInput[] = [];
  for (const [index, entry] of entries.entries()) {
    const read = readPreset(entry, index);
    if (typeof read === 'string') return { ok: false, error: read };
    connections.push(read);
  }

  return { ok: true, connections };
}
