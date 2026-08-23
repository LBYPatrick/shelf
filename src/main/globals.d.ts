/**
 * The version, compiled in from `VERSION` by the build — see
 * `electron.vite.config.ts`. Declared rather than imported, because the value
 * has to exist before anything runs and a file read at startup is a file that
 * can be missing from a packaged app.
 */
declare const __APP_VERSION__: string;
