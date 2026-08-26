import type { ConnectionConfig, EngineId } from '../drivers/types';
import type { SaveConnectionInput, SavedConnection } from './connections';
import { ENGINES } from './engines';
import { isObject } from './json';

/**
 * Connections as a file.
 *
 * The point of the format is that it is a *preset*: everything needed to reach
 * a database except the credential. Secrets stay in the OS keyring and are
 * never written here, deliberately — a connection document is the thing people
 * commit to a repository, paste into a ticket and mail to a colleague, and a
 * format that sometimes carries a password is one that eventually does.
 *
 * So an imported connection arrives without one, and the editor asks for it the
 * first time it is opened. That is the honest trade, and it is stated in the
 * document itself rather than left to be discovered.
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
}

export interface ConnectionDocument {
  readonly kind: typeof CONNECTION_DOCUMENT_KIND;
  readonly version: number;
  /** Present in the file so the reader learns the rule without being told. */
  readonly note: string;
  readonly connections: readonly ConnectionPreset[];
}

const NOTE =
  'Passwords are not included. They stay in the OS keyring on the machine that saved them.';

const ENGINE_IDS: ReadonlySet<string> = new Set(ENGINES.map((engine) => engine.id));

/** Everything a preset carries, minus anything the keyring owns. */
function presetOf(connection: SavedConnection): ConnectionPreset {
  const { password: _password, ...config } = connection.config as ConnectionConfig;
  return {
    name: connection.name,
    engine: connection.engine,
    labelColor: connection.labelColor,
    readOnly: connection.readOnly,
    config,
  };
}

function toConnectionDocument(connections: readonly SavedConnection[]): ConnectionDocument {
  return {
    kind: CONNECTION_DOCUMENT_KIND,
    version: CONNECTION_DOCUMENT_VERSION,
    note: NOTE,
    connections: connections.map(presetOf),
  };
}

export function serializeConnections(connections: readonly SavedConnection[]): string {
  return `${JSON.stringify(toConnectionDocument(connections), null, 2)}\n`;
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

  return {
    name: name.trim(),
    engine: engine as EngineId,
    labelColor: typeof labelColor === 'string' ? labelColor : null,
    readOnly: readOnly === true,
    // Nothing to remember: the document never carried a secret.
    rememberSecrets: false,
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
