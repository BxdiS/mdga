import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Module } from "@mdga/plugin-api";
import { bundleModule } from "./bundle.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Discover every P0 module package. The manifest (id, label, enabled) comes
// from importing the entry directly (tsx handles the .ts loading); the code
// that ships to Discord comes from an esbuild bundle of the same entry.
// Third-party plugins live elsewhere and are loaded at runtime, not here.

export interface ModuleRecord {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  // IIFE bundle of the module entry (see bundleModule). The preload splices
  // it into the main-world script as code, so no eval is needed in Discord.
  code: string;
}

function findModulesDir(): string {
  // Walk up from this file to the repo root (…/packages/installer/src → …/).
  let dir = HERE;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "packages", "modules");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("modules dir not found");
}

export async function collectModules(): Promise<ModuleRecord[]> {
  const modulesDir = findModulesDir();
  const entries = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(modulesDir, e.name, "src", "index.ts"))
    .filter((p) => fs.existsSync(p));

  const out: ModuleRecord[] = [];
  for (const entry of entries) {
    try {
      const url = pathToFileURL(entry).href;
      const imported = (await import(url)) as { default?: Module };
      const mod = imported.default;
      if (!mod || typeof mod.id !== "string") continue;
      // Nothing to ship for a module with neither CSS nor runtime.
      if (typeof mod.css !== "string" && typeof mod.runtime !== "function") continue;
      out.push({
        id: mod.id,
        label: mod.label,
        description: mod.description,
        defaultEnabled: mod.defaultEnabled,
        code: await bundleModule(entry),
      });
    } catch (err) {
      console.warn(`[mdga] failed to load module ${entry}:`, (err as Error).message);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
