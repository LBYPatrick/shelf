import type { ConnectionConfig, DatabaseClient, EngineId } from './types';

/**
 * Maps an engine id to its driver.
 *
 * Drivers are imported on first use rather than up front: between them the nine
 * clients pull in tens of megabytes of native modules and cloud SDKs, and
 * loading all of them to open one SQLite file would make the host slow to start
 * for no benefit. The loader is async because that is what makes a dynamic
 * import survive bundling — a lazy `require` of a relative path does not.
 */
type Factory = (config: ConnectionConfig) => DatabaseClient;

const loaders = new Map<EngineId, () => Promise<Factory>>();
/** Resolved factories, so the second connection to an engine is immediate. */
const resolved = new Map<EngineId, Factory>();

export function registerEngine(engine: EngineId, load: () => Promise<Factory>): void {
  loaders.set(engine, load);
}

export async function createClient(config: ConnectionConfig): Promise<DatabaseClient> {
  const cached = resolved.get(config.engine);
  if (cached) return cached(config);

  const load = loaders.get(config.engine);
  if (!load) {
    throw new Error(`Unsupported engine: ${config.engine}`);
  }

  const factory = await load();
  resolved.set(config.engine, factory);
  return factory(config);
}

export function supportedEngines(): readonly EngineId[] {
  return [...loaders.keys()];
}
