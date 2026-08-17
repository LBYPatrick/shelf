/**
 * Writing to the application database's key-value store.
 *
 * Everything stored there is assembled from Vue state, and a reactive object is
 * a Proxy. The context bridge clones what crosses it and rejects a Proxy
 * outright — asynchronously, into a promise nobody awaited, so the failure was
 * completely silent: the open-tab session had not been saved for as long as a
 * tab carried a reactive entity reference, and the workspace came back empty on
 * every launch.
 *
 * A JSON round-trip is exactly lossless here, because main writes the value
 * straight to `JSON.stringify`. One guard rather than one per call site, for
 * the same reason the host client has one: a rule every caller has to remember
 * is a rule that gets forgotten.
 */
export async function saveSetting(key: string, value: unknown): Promise<void> {
  await window.shelf.db.setSetting(key, JSON.parse(JSON.stringify(value)) as unknown);
}
