/**
 * Packaging.
 *
 * Native modules are the only real complexity here. `better-sqlite3` is compiled
 * against Electron's ABI by the postinstall hook and must stay unpacked from the
 * asar archive — a `.node` file inside an archive cannot be dlopen'd.
 */

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.lbynet.shelf',
  productName: 'Shelf',
  copyright: `Copyright © ${new Date().getFullYear()} LBYPatrick`,

  directories: {
    output: 'release/${version}',
    buildResources: 'build',
  },

  /*
   * What ships, and what a native module leaves lying around that does not.
   *
   * `better-sqlite3` arrives with prebuilt binaries for every platform and ABI
   * it supports, and with the SQLite amalgamation it was compiled *from* — 26MB
   * of which about one is the `.node` this app loads. The install hook builds
   * that one against Electron's ABI; the rest is the toolchain's leftovers, and
   * it was being shipped to every user.
   */
  files: [
    'out/**/*',
    'package.json',
    '!**/*.map',
    /*
     * `prebuilds` is not in this list, and that is the whole point.
     *
     * It used to be, and it took the binary with it. better-sqlite3 moved to
     * prebuildify: the install hook's Electron-ABI build lands in
     * `prebuilds/<platform>-<arch>.node`, which is the first place
     * `lib/binding.js` looks and the only place it finds anything — the
     * `build/Release` fallback it tries next is a layout this version never
     * produces. Excluding the directory shipped an app whose SQLite driver
     * threw on require, and nothing caught it, because the tests run against
     * `out/` where `node_modules` is right there on disk.
     *
     * The other seven platforms' prebuilds are still dropped, in `afterPack`,
     * where the architecture being built is actually known.
     */
    '!**/node_modules/better-sqlite3/{deps,src,benchmark,docs}/**',
    '!**/node_modules/better-sqlite3/build/{deps,Release/obj.target}/**',
    '!**/node_modules/**/*.{md,markdown,txt}',
    '!**/node_modules/**/{test,tests,example,examples,.github}/**',
  ],

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
    // Drawn from `resources/icon.svg` by `make icon`; the packagers cut every
    // other size they need out of this one.
    icon: 'build/icon.png',
    category: 'public.app-category.developer-tools',
    /*
     * No architecture list: electron-builder then builds for the machine it is
     * running on, and `ARCH=arm64,x64` asks for more. Naming both here meant
     * every local build produced two of everything — a Mac developer packaging
     * to check a change waited twice as long for twice the disk.
     */
    target: ['dmg', 'zip'],
    darkModeSupport: true,

    /*
     * Signing is opt-in, and off means off.
     *
     * Saying "do not harden and do not notarise" is not the same as saying "do
     * not sign". Left to itself electron-builder searches the login keychain
     * for any code-signing identity and uses whatever it finds — so a build on
     * a machine that holds a certificate for some *other* project reaches for
     * that project's key, unasked. `identity: null` is the switch that stops it
     * looking at all.
     *
     * So signing is asked for by name: `APPLE_IDENTITY` is the certificate to
     * use, and `APPLE_TEAM_ID` — which also turns on hardening and notarisation
     * — says whose account it belongs to. Neither set, nothing is signed.
     */
    identity: process.env.APPLE_IDENTITY ?? (process.env.APPLE_TEAM_ID ? undefined : null),
    hardenedRuntime: Boolean(process.env.APPLE_TEAM_ID),
    /*
     * Notarisation needs credentials, not just a team: `notarytool` keeps them
     * in the keychain under a profile name, and the packager reads that from
     * `APPLE_KEYCHAIN_PROFILE`. Asking for it without them fails at the very end
     * of a long build, so it is on only when both are present.
     */
    notarize: Boolean(process.env.APPLE_TEAM_ID && process.env.APPLE_KEYCHAIN_PROFILE),
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },

  win: {
    icon: 'build/icon.png',
    target: ['nsis', 'portable'],
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },

  /*
   * The desktop entry is the point of the .deb and the .rpm.
   *
   * GNOME's app drawer is a view of `/usr/share/applications`, so an installed
   * app is one that has put a `.desktop` file there — which a package does and
   * an AppImage does not. The AppImage stays for the case it is good at:
   * downloading one file and running it without installing anything.
   *
   * `MimeType` is what makes the app offerable for a database file and for a
   * `postgres://` link; `StartupWMClass` is what lets the shell match a running
   * window back to the icon that launched it, without which a launched app
   * appears twice in the dash.
   */
  linux: {
    icon: 'build/icon.png',
    category: 'Development;Database;',
    synopsis: 'Database client',
    target: ['deb', 'rpm', 'AppImage'],
    desktop: {
      entry: {
        Keywords: 'sql;database;postgres;mysql;sqlite;mongodb;redis;',
        GenericName: 'Database Client',
        StartupWMClass: 'Shelf',
        MimeType: [
          'application/vnd.sqlite3',
          'application/x-sqlite3',
          'x-scheme-handler/postgres',
          'x-scheme-handler/postgresql',
          'x-scheme-handler/mysql',
          'x-scheme-handler/mongodb',
          'x-scheme-handler/redis',
        ].join(';'),
      },
    },
  },

  deb: {
    // What a package manager tells you it is before you install it.
    priority: 'optional',
    depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils'],
  },

  /*
   * Thin the fat binaries a native module ships.
   *
   * DuckDB's `libduckdb.dylib` is a universal binary: 112MB, of which half is
   * the slice for the architecture this build is *not* for. An Apple Silicon
   * app was shipping the Intel engine alongside its own, and an Intel app the
   * reverse — and every user downloaded both. Cut to the one that will run, and
   * with its debug symbols dropped, the same file is 46MB.
   *
   * Done to the copy inside the packaged app and never to `node_modules`: the
   * source tree is the developer's, and a packaging step that quietly rewrites
   * a dependency is one that breaks the *next* build of the other architecture.
   * Signing happens after this hook, so what gets signed is what ships.
   */
  afterPack: async (context) => {
    const { execFileSync } = require('node:child_process');
    const { existsSync, readdirSync, rmSync, statSync } = require('node:fs');
    const { join } = require('node:path');

    // electron-builder's `Arch`: ia32 0, x64 1, armv7l 2, arm64 3.
    const cpu = context.arch === 1 ? 'x64' : 'arm64';
    const slice = context.arch === 1 ? 'x86_64' : 'arm64';

    /*
     * Drop the prebuilds this build cannot use.
     *
     * Here rather than in `files`, because this is the first point at which the
     * architecture being packaged is known — a glob in `files` can only guess,
     * and the guess that was there took every prebuild including the one the
     * app loads. better-sqlite3 ships eight at about 2MB each; seven of them
     * are for machines this build will never run on.
     */
    const prebuilds = [];
    const findPrebuilds = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'prebuilds') prebuilds.push(path);
          else findPrebuilds(path);
        }
      }
    };
    findPrebuilds(context.appOutDir);

    const wanted = `${context.electronPlatformName}-${cpu}.node`;
    for (const directory of prebuilds) {
      if (!existsSync(join(directory, wanted))) {
        // Nothing here matches this build, and deleting the rest would leave a
        // module with no binary at all — which is the bug this replaced.
        console.log(`  • kept every prebuild: no ${wanted} in ${directory}`);
        continue;
      }
      for (const entry of readdirSync(directory)) {
        if (entry !== wanted) rmSync(join(directory, entry), { recursive: true, force: true });
      }
      console.log(`  • prebuilds pruned to ${wanted}  dir=${directory}`);
    }

    if (context.electronPlatformName !== 'darwin') return;

    const binaries = [];
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile() && /\.(dylib|node|so)$/.test(entry.name)) binaries.push(path);
      }
    };
    walk(context.appOutDir);

    for (const binary of binaries) {
      const before = statSync(binary).size;
      try {
        const kinds = execFileSync('lipo', ['-info', binary], { encoding: 'utf8' });
        if (!kinds.includes('are:')) continue; // Already one architecture.

        execFileSync('lipo', ['-thin', slice, binary, '-output', `${binary}.thin`]);
        execFileSync('mv', [`${binary}.thin`, binary]);
        execFileSync('strip', ['-S', '-x', binary]);

        /*
         * And signed again, because both of those invalidate the signature the
         * binary arrived with — and macOS does not merely refuse to load a
         * library whose signature no longer matches its bytes: it *hangs*
         * loading it, which reads as the app freezing on first use of a
         * database rather than as anything to do with packaging. An ad-hoc
         * signature is enough to make it loadable, and a real one replaces it
         * later when the app is signed for distribution.
         */
        execFileSync('codesign', ['--force', '--sign', '-', binary]);

        const saved = Math.round((before - statSync(binary).size) / 1024 / 1024);
        if (saved > 0) console.log(`  • thinned to ${slice}  saved=${saved}MB  file=${binary}`);
      } catch {
        // A binary lipo cannot read is a binary to leave exactly as it is.
      }
    }

    /*
     * And an ad-hoc signature over the bundle, when there is no real one.
     *
     * "Do not sign with a certificate" is not the same as "ship something macOS
     * will run". Left unsigned, the .app carries only the ad-hoc *linker*
     * signature that came with the Electron executable: identified as
     * `Electron`, sealing no resources, and describing a bundle that is no
     * longer the bundle it is attached to. `codesign --verify` fails on it, and
     * a copy that has been downloaded — so, every copy anybody actually gets —
     * is refused by Gatekeeper as "damaged and can't be opened", which sends
     * the reader to the Trash rather than to a workaround.
     *
     * An ad-hoc signature fixes the seal and the identifier. It is not
     * notarisation and does not pretend to be: the first open still needs
     * right-click → Open. It is the difference between an app that asks
     * permission and an app that appears to be corrupt.
     *
     * Skipped when a certificate was asked for by name, because electron-builder
     * signs properly in that case and this would replace it with something
     * worse.
     */
    if (!process.env.APPLE_IDENTITY && !process.env.APPLE_TEAM_ID) {
      const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', app]);
      execFileSync('codesign', ['--verify', '--strict', app]);
      console.log(`  • ad-hoc signed  file=${app}`);
    }
  },

  publish: null,
};
