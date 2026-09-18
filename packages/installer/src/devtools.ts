import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Flavor } from "./locate.js";

// Discord's own flag. Reading their settings.json for this key is a first-
// party feature — the value name is Discord's, not ours.
const FLAG_KEY = "DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING";

const SETTINGS_DIR: Record<Flavor, string> = {
  stable: "discord",
  ptb: "discordptb",
  canary: "discordcanary",
};

function settingsPath(flavor: Flavor): string {
  const appData = process.env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, SETTINGS_DIR[flavor], "settings.json");
}

export interface DevtoolsResult {
  file: string;
  changed: boolean;
  previous: boolean;
}

export function setDevtools(flavor: Flavor, enabled: boolean): DevtoolsResult {
  const file = settingsPath(flavor);
  let obj: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt or non-JSON — start fresh but keep the file.
    }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const previous = obj[FLAG_KEY] === true;
  if (previous === enabled) {
    return { file, changed: false, previous };
  }
  obj[FLAG_KEY] = enabled;
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  return { file, changed: true, previous };
}
