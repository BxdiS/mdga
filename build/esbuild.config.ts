// esbuild config for the injected bundle.
// Two entry points, one bundle each:
//   - packages/core/src/injector/index.ts   -> dist/mdga/main.js       (cjs, node target)
//   - packages/core/src/preload/index.ts    -> dist/mdga/preload.js    (cjs, node target)
//
// Modules selected at install time are inlined into the preload bundle by
// generating a virtual entry that imports each chosen @mdga/module-* package.
//
// Not wired up yet.

export const placeholder = true;
