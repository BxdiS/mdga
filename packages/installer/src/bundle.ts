import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Global the module IIFE assigns its exports to; the preload wrapper reads
// `.default` off it. Keep in sync with mdga_preload.js.
export const MODULE_GLOBAL = "__mdga_module";

async function bundle(entry: string, globalName?: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    ...(globalName ? { globalName } : {}),
    platform: "browser",
    // Discord Stable ships Electron with Chromium 130+.
    target: "chrome120",
    charset: "utf8",
    legalComments: "none",
    logLevel: "silent",
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error(`esbuild produced no output for ${entry}`);
  return file.text;
}

// IIFE bundle of a module entry. Evaluating it assigns the module's
// defineModule() result to MODULE_GLOBAL.default.
export function bundleModule(entry: string): Promise<string> {
  return bundle(entry, MODULE_GLOBAL);
}

function findRepoFile(rel: string): string {
  // Walk up from this file to the repo root (…/packages/installer/src → …/).
  let dir = HERE;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, rel);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`${rel} not found`);
}

// The main-world bootstrap (webpack hook, finders, patcher, CSS, diag) from
// packages/core. This is the only copy of that code; the preload injects it.
export function bundleBootstrap(): Promise<string> {
  return bundle(findRepoFile(path.join("packages", "core", "src", "bootstrap", "index.ts")));
}
