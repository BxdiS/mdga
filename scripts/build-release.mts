// Builds the release assets into dist/release:
//   mdga-payload.json  everything install.ps1 writes into app.asar
//   install.ps1        the one-line installer (irm … | iex)
// The payload is one JSON file so the installer needs a single download and
// no zip handling.
import fs from "node:fs";
import path from "node:path";
import { bundleBootstrap } from "../packages/installer/src/bundle.js";
import { collectModules } from "../packages/installer/src/modules.js";

const root = path.resolve(import.meta.dirname, "..");
const templates = path.join(root, "packages", "installer", "src", "templates");
const out = path.join(root, "dist", "release");
fs.mkdirSync(out, { recursive: true });

const version = process.env["MDGA_VERSION"] ?? "dev";
const payload = {
  version,
  files: {
    "mdga/main.js": fs.readFileSync(path.join(templates, "mdga_main.js"), "utf-8"),
    "mdga/preload.js": fs.readFileSync(path.join(templates, "mdga_preload.js"), "utf-8"),
    "mdga/bootstrap.js": await bundleBootstrap(),
  },
  modules: await collectModules(),
};

fs.writeFileSync(path.join(out, "mdga-payload.json"), JSON.stringify(payload));
fs.copyFileSync(path.join(root, "scripts", "install.ps1"), path.join(out, "install.ps1"));
console.log(
  `mdga ${version}: payload ${(fs.statSync(path.join(out, "mdga-payload.json")).size / 1024).toFixed(1)} KB, ` +
    `modules: ${payload.modules.map((m) => m.id).join(", ")}`,
);
