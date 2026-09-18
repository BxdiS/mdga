import fs from "node:fs";
import path from "node:path";
import type { DiscordInstall } from "./locate.js";
import { logger } from "./logger.js";

export function uninstall(install: DiscordInstall): void {
  const origPath = path.join(install.resources, "app.asar.orig");
  if (!fs.existsSync(origPath)) {
    logger.warn(`no app.asar.orig found for ${install.flavor} — nothing to restore`);
    return;
  }
  fs.copyFileSync(origPath, install.asarPath);
  fs.unlinkSync(origPath);
  logger.info(`restored app.asar for ${install.flavor}`);
}

export function isPatched(install: DiscordInstall): boolean {
  return fs.existsSync(path.join(install.resources, "app.asar.orig"));
}
