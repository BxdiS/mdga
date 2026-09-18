import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import type { DiscordInstall, Flavor } from "./locate.js";
import { logger } from "./logger.js";

const IMAGE_NAME: Record<Flavor, string> = {
  stable: "Discord.exe",
  ptb: "DiscordPTB.exe",
  canary: "DiscordCanary.exe",
};

export function stopDiscord(install: DiscordInstall): void {
  const image = IMAGE_NAME[install.flavor];
  const res = spawnSync("taskkill", ["/F", "/T", "/IM", image], {
    stdio: "pipe",
    windowsHide: true,
  });
  // 0   — killed
  // 128 — no such process (fine)
  if (res.status === 0) {
    logger.info(`stopped ${image}`);
  } else if (res.status === 128) {
    logger.info(`${image} was not running`);
  } else {
    logger.warn(`taskkill returned ${res.status} for ${image}: ${res.stderr.toString().trim()}`);
  }
}

export function startDiscord(install: DiscordInstall): void {
  const image = IMAGE_NAME[install.flavor];
  const updateExe = path.join(install.root, "Update.exe");
  const child = spawn(updateExe, ["--processStart", image], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  logger.info(`started ${image}`);
}
