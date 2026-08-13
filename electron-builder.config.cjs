/**
 * Packaging.
 *
 * Native modules are the only real complexity here. `better-sqlite3` is compiled
 * against Electron's ABI by the postinstall hook and must stay unpacked from the
 * asar archive — a `.node` file inside an archive cannot be dlopen'd.
 */

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.lbypatrick.shelf',
  productName: 'Shelf',
  copyright: `Copyright © ${new Date().getFullYear()} LBYPatrick`,

  directories: {
    output: 'release/${version}',
    buildResources: 'build',
  },

  files: ['out/**/*', 'package.json', '!**/*.map'],

  /*
   * Native modules are rebuilt by the postinstall hook, which targets only the
   * one module that needs it. Letting electron-builder rebuild everything again
   * drags in `cpu-features` — an optional dependency of ssh2 whose npm tarball
   * is missing the sources it needs to compile. ssh2 works without it.
   */
  npmRebuild: false,

  // Native addons cannot be loaded from inside the archive.
  asarUnpack: ['**/*.node', '**/node_modules/better-sqlite3/**'],

  /**
   * Opening a database file from the Finder or Explorer is the fastest possible
   * path to looking at data, so the file-backed engines claim their extensions.
   */
  fileAssociations: [
    { ext: 'db', name: 'Database', role: 'Editor' },
    { ext: 'sqlite', name: 'SQLite database', role: 'Editor' },
    { ext: 'sqlite3', name: 'SQLite database', role: 'Editor' },
    { ext: 'duckdb', name: 'DuckDB database', role: 'Editor' },
  ],

  protocols: [
    { name: 'PostgreSQL', schemes: ['postgres', 'postgresql'] },
    { name: 'MySQL', schemes: ['mysql'] },
    { name: 'Redis', schemes: ['redis', 'rediss'] },
    { name: 'MongoDB', schemes: ['mongodb', 'mongodb+srv'] },
  ],

  mac: {
    category: 'public.app-category.developer-tools',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    darkModeSupport: true,
    // Signing and notarisation are opt-in: an unsigned local build should not
    // fail because a developer has no Apple certificate.
    hardenedRuntime: Boolean(process.env.APPLE_TEAM_ID),
    notarize: Boolean(process.env.APPLE_TEAM_ID),
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },

  win: {
    target: [
      { target: 'nsis', arch: ['x64', 'arm64'] },
      { target: 'portable', arch: ['x64'] },
    ],
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },

  linux: {
    category: 'Development',
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
    desktop: {
      entry: { Keywords: 'sql;database;postgres;mysql;sqlite;' },
    },
  },

  publish: null,
};
