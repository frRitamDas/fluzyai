// Bundles the compiled server into one ESM file for the serverless function.
//
// Vercel runs `npm run vercel-build` on every deploy, then packages `api/`.
// Doing the bundling here (rather than letting the platform walk the compiled
// tree) keeps the function self-contained and predictable: one file plus the
// node: builtins, with only the native modules external.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runNpm(args) {
  execFileSync('npm', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}

console.log('[vercel] building server (tsc)');
runNpm(['run', 'build', '-w', 'server']);

console.log('[vercel] building dashboard (vite)');
runNpm(['run', 'build', '-w', 'client']);

console.log('[vercel] bundling serverless function');
await build({
  entryPoints: [path.join(root, 'server/dist/serverless.js')],
  outfile: path.join(root, 'server/dist/serverless-bundle.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Native addons cannot be inlined. better-sqlite3 is optional on serverless
  // (FLUZY_DB_DRIVER=node uses the built-in driver); sharp stays external so its
  // platform prebuild is used as-is, and image normalization already degrades
  // gracefully when it cannot load.
  external: ['better-sqlite3', 'sharp'],
  // Some inlined CJS dependencies (express internals) call require() at runtime.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'info',
});

console.log('[vercel] functions ready: api/index.mjs → server/dist/serverless-bundle.mjs');
