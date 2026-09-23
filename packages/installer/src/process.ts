import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DiscordInstall, Flavor } from "./locate.js";
import { logger } from "./logger.js";

const IMAGE_NAME: Record<Flavor, string> = {
  stable: "Discord.exe",
  ptb: "DiscordPTB.exe",
  canary: "DiscordCanary.exe",
};

function isRunning(image: string): boolean {
  const res = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], {
    stdio: "pipe",
    windowsHide: true,
  });
  return res.stdout.toString().toLowerCase().includes(image.toLowerCase());
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Ask an mdga-patched Discord to quit on its own (mdga_main.js watches for
// this file) so it flushes Local Storage. A hard kill used to lose the login.
function requestGracefulQuit(install: DiscordInstall, image: string): boolean {
  if (!fs.existsSync(path.join(install.resources, "app.asar.orig"))) return false;
  const request = path.join(install.resources, "mdga-quit-request");
  try {
    fs.writeFileSync(request, String(Date.now()));
  } catch (err) {
    logger.warn(`could not write quit request: ${(err as Error).message}`);
    return false;
  }
  try {
    // The watcher polls once a second; give Discord time to shut down.
    for (let waited = 0; waited < 15_000; waited += 250) {
      if (!isRunning(image)) return true;
      sleep(250);
    }
    return false;
  } finally {
    try { fs.rmSync(request, { force: true }); } catch { /* ignore */ }
  }
}

export function stopDiscord(install: DiscordInstall): void {
  const image = IMAGE_NAME[install.flavor];
  if (!isRunning(image)) {
    logger.info(`${image} was not running`);
    return;
  }
  if (requestGracefulQuit(install, image)) {
    logger.info(`${image} quit gracefully`);
    return;
  }
  logger.warn(
    `${image} did not quit on request (older mdga build or no mdga yet); force-killing. ` +
      `If you get logged out, quit Discord from the tray before installing.`,
  );
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
