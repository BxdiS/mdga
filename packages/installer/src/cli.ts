import { setDevtools } from "./devtools.js";
import { inject } from "./inject.js";
import { locateInstalls, type DiscordInstall, type Flavor } from "./locate.js";
import { logger } from "./logger.js";
import { startDiscord, stopDiscord } from "./process.js";
import { isPatched, uninstall } from "./uninstall.js";

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;
  const flavor = parseFlavorFlag(rest);
  const noRestart = rest.includes("--no-restart");

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return 0;
  }

  let installs: DiscordInstall[];
  try {
    installs = locateInstalls();
  } catch (err) {
    logger.error((err as Error).message);
    return 1;
  }

  if (flavor) installs = installs.filter((i) => i.flavor === flavor);

  if (installs.length === 0) {
    logger.error(
      flavor
        ? `no Discord install found for flavor "${flavor}"`
        : `no Discord installs found under %LOCALAPPDATA%`,
    );
    return 1;
  }

  switch (command) {
    case "install":
      for (const install of installs) {
        await runInstall(install, noRestart);
      }
      return 0;

    case "uninstall":
      for (const install of installs) {
        await runUninstall(install, noRestart);
      }
      return 0;

    case "status":
      for (const install of installs) {
        const state = isPatched(install) ? "PATCHED" : "clean";
        logger.info(`${install.flavor} v${install.appVersion} — ${state}`);
        logger.info(`  ${install.asarPath}`);
      }
      return 0;

    case "devtools": {
      const state = rest.find((a) => !a.startsWith("--"));
      if (state !== "on" && state !== "off") {
        logger.error(`usage: mdga devtools <on|off>`);
        return 2;
      }
      const enable = state === "on";
      for (const install of installs) {
        const res = setDevtools(install.flavor, enable);
        if (!res.changed) {
          logger.info(`${install.flavor}: devtools already ${enable ? "enabled" : "disabled"}`);
          continue;
        }
        logger.info(`${install.flavor}: devtools ${enable ? "enabled" : "disabled"} (${res.file})`);
        if (!noRestart) {
          stopDiscord(install);
          startDiscord(install);
        }
      }
      if (!noRestart) {
        logger.info(`Ctrl+Shift+I will open devtools after Discord finishes launching`);
      }
      return 0;
    }

    default:
      logger.error(`unknown command: ${command}`);
      printUsage();
      return 2;
  }
}

async function runInstall(install: DiscordInstall, noRestart: boolean): Promise<void> {
  logger.info(`patching ${install.flavor} v${install.appVersion}`);
  stopDiscord(install);
  await inject(install);
  if (!noRestart) startDiscord(install);
  logger.info(`done: ${install.flavor} patched${noRestart ? " (not restarted)" : " and restarted"}`);
}

async function runUninstall(install: DiscordInstall, noRestart: boolean): Promise<void> {
  logger.info(`unpatching ${install.flavor} v${install.appVersion}`);
  stopDiscord(install);
  uninstall(install);
  if (!noRestart) startDiscord(install);
  logger.info(`done: ${install.flavor} restored${noRestart ? " (not restarted)" : " and restarted"}`);
}

function parseFlavorFlag(args: string[]): Flavor | null {
  const i = args.indexOf("--flavor");
  if (i < 0) return null;
  const v = args[i + 1];
  if (v === "stable" || v === "ptb" || v === "canary") return v;
  logger.warn(`--flavor expects stable|ptb|canary, got "${v ?? ""}"; ignoring`);
  return null;
}

function printUsage(): void {
  console.log(`Make Discord Great Again

usage:
  npm run mdga -- install       [--flavor stable|ptb|canary] [--no-restart]
  npm run mdga -- uninstall     [--flavor stable|ptb|canary] [--no-restart]
  npm run mdga -- status        [--flavor stable|ptb|canary]
  npm run mdga -- devtools on   [--flavor stable|ptb|canary] [--no-restart]
  npm run mdga -- devtools off  [--flavor stable|ptb|canary] [--no-restart]

Without --flavor, every installed Discord flavor is targeted.
`);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    logger.error(String(err instanceof Error ? err.stack ?? err.message : err));
    process.exit(1);
  },
);
