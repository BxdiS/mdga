import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Flavor = "stable" | "ptb" | "canary";

export interface DiscordInstall {
  flavor: Flavor;
  root: string;
  appVersion: string;
  resources: string;
  asarPath: string;
}

const ROOT_NAMES: Record<Flavor, string> = {
  stable: "Discord",
  ptb: "DiscordPTB",
  canary: "DiscordCanary",
};

export function locateInstalls(): DiscordInstall[] {
  if (process.platform !== "win32") {
    throw new Error(
      `locateInstalls: platform "${process.platform}" not supported yet — Windows only for now`,
    );
  }

  const base = process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local");
  const found: DiscordInstall[] = [];

  for (const flavor of Object.keys(ROOT_NAMES) as Flavor[]) {
    const root = path.join(base, ROOT_NAMES[flavor]);
    if (!fs.existsSync(root)) continue;

    const versions = fs
      .readdirSync(root)
      .filter((n) => n.startsWith("app-"))
      .map((n) => n.slice("app-".length))
      .sort(compareVersion);

    const latest = versions.at(-1);
    if (latest === undefined) continue;

    const resources = path.join(root, `app-${latest}`, "resources");
    const asarPath = path.join(resources, "app.asar");
    if (!fs.existsSync(asarPath)) continue;

    found.push({ flavor, root, appVersion: latest, resources, asarPath });
  }

  return found;
}

function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
