import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract, pack } from "./asar.js";
import type { DiscordInstall } from "./locate.js";
import { logger } from "./logger.js";
import { collectModules } from "./modules.js";

/**
 * Injection layout inside a repacked app.asar:
 *
 *   package.json           main -> "mdga_entry.js"
 *   mdga_entry.js          generated shim; loads mdga/main.js first, then
 *                          chains to Discord's original entry
 *   mdga/main.js           main-process payload (patches BrowserWindow)
 *   mdga/preload.js        renderer preload (webpack hook + debug surface)
 *   ...                    Discord's original tree, untouched
 *
 * A byte-for-byte copy of the original asar is kept next to the patched one
 * as app.asar.orig, both for rollback and to survive further re-injects.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(HERE, "templates");

function makeEntryStub(originalMain: string): string {
  const normalized = originalMain.replace(/\\/g, "/");
  return `"use strict";

try {
  require("./mdga/main.js");
} catch (err) {
  // Never let a failure in mdga break Discord itself.
  console.error("[mdga] payload failed to load:", err);
}

module.exports = require("./${normalized}");
`;
}

export async function inject(install: DiscordInstall): Promise<void> {
  const { resources, asarPath } = install;
  const origPath = path.join(resources, "app.asar.orig");
  const tempDir = path.join(resources, "_mdga_tmp");

  if (!fs.existsSync(origPath)) {
    fs.copyFileSync(asarPath, origPath);
    logger.info(`backed up app.asar → app.asar.orig`);
  } else {
    // Reinject: use the pristine backup as the source of truth so we never
    // chain our shim onto a previously-injected asar.
    fs.copyFileSync(origPath, asarPath);
    logger.info(`reinjecting from existing app.asar.orig`);
  }

  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  extract(asarPath, tempDir);
  logger.info(`extracted app.asar → ${path.basename(tempDir)}`);

  const pkgPath = path.join(tempDir, "package.json");
  const pkgRaw = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(pkgRaw) as { main?: unknown };
  const originalMain = pkg.main;
  if (typeof originalMain !== "string" || originalMain.length === 0) {
    throw new Error(`app.asar package.json has no main entry`);
  }
  logger.info(`original main: ${originalMain}`);

  const mdgaDir = path.join(tempDir, "mdga");
  fs.mkdirSync(mdgaDir, { recursive: true });
  fs.copyFileSync(path.join(TEMPLATE_DIR, "mdga_main.js"), path.join(mdgaDir, "main.js"));
  fs.copyFileSync(path.join(TEMPLATE_DIR, "mdga_preload.js"), path.join(mdgaDir, "preload.js"));
  fs.writeFileSync(path.join(tempDir, "mdga_entry.js"), makeEntryStub(originalMain));

  const modules = await collectModules();
  fs.writeFileSync(path.join(mdgaDir, "modules.json"), JSON.stringify(modules, null, 2));
  logger.info(`bundled ${modules.length} modules: ${modules.map((m) => m.id).join(", ")}`);

  pkg.main = "mdga_entry.js";
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  await pack(tempDir, asarPath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  logger.info(`repacked → app.asar`);
}
