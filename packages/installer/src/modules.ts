import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Module } from "@mdga/plugin-api";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Discover and load every P0 module package's manifest. We import their
// entry files directly (tsx handles the .ts loading) and pull out the default
// export produced by defineModule(). Third-party plugins live elsewhere and
// are loaded at runtime, not here.

export interface ModuleRecord {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  css?: string;
  // Serialized runtime function body — evaluated in the main world after
  // window.mdga is installed. Empty if the module has no runtime hook.
  runtime?: string;
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
      out.push({
        id: mod.id,
        label: mod.label,
        description: mod.description,
        defaultEnabled: mod.defaultEnabled,
        ...(typeof mod.css === "string" ? { css: mod.css } : {}),
        ...(typeof mod.runtime === "function"
          ? { runtime: Function.prototype.toString.call(mod.runtime) }
          : {}),
      });
    } catch (err) {
      console.warn(`[mdga] failed to load module ${entry}:`, (err as Error).message);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
