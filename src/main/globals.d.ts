/**
 * The version, compiled in from `VERSION` by the build — see
 * `electron.vite.config.ts`. Declared rather than imported, because the value
 * has to exist before anything runs and a file read at startup is a file that
 * can be missing from a packaged app.
 */
declare const __APP_VERSION__: string;

/**
 * `owner/repo`, compiled in from `package.json`'s `repository` field by the
 * same build. That field is also what electron-builder resolves its GitHub
 * publish target from, so the feed the updater reads and the page it sends
 * somebody to are derived from one line rather than agreed by hand.
 */
declare const __APP_REPOSITORY__: string;
