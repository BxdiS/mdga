"use strict";

// mdga renderer preload.
// Runs before Discord's page scripts. We keep whatever contextIsolation
// Discord picked — forcing it off broke identify (gateway 4004). Three jobs:
//   1. Inject the main-world bootstrap (webpack instrumentation + window.mdga).
//   2. Apply CSS from every enabled module (bundled at install time).
//   3. Chain to Discord's original preload so DiscordNative still gets set up.

const electron = require("electron");
const fs = require("fs");
const path = require("path");
const isolated = process.contextIsolated === true;

console.log(
  "[mdga] preload: file loaded, isolated =",
  isolated,
  ", original preload =",
  process.env.MDGA_ORIGINAL_PRELOAD,
);

// Read the modules manifest the installer bundled next to us. Fail-soft: an
// unreadable manifest just means no auto-injection, everything else stays.
let bundledModules = [];
try {
  const manifestPath = path.join(__dirname, "modules.json");
  bundledModules = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  console.log("[mdga] preload: loaded " + bundledModules.length + " module manifests");
} catch (err) {
  console.warn("[mdga] preload: no modules.json found:", err && err.message);
}

// The main-world bootstrap (webpack hook, finders, patcher, CSS, diag) is
// built from packages/core/src/bootstrap by the installer and shipped next to
// us. Without it there is no window.mdga, so modules are skipped too.
let MAIN_WORLD_BOOTSTRAP = "";
try {
  MAIN_WORLD_BOOTSTRAP = fs.readFileSync(path.join(__dirname, "bootstrap.js"), "utf-8");
} catch (err) {
  console.error("[mdga] preload: no bootstrap.js found:", err && err.message);
}

// Splice each enabled module's esbuild IIFE into the main-world script as
// code: the bundle assigns its defineModule() result to __mdga_module, and
// the wrapper returns it. Runtime enable-state will live in settings later
// and gate this; disabled modules are not even evaluated. Each wrapper has
// its own try/catch so one module throwing at load does not take the rest
// down.
const MODULES_STUB =
  "window.__mdga_modules__ = [" +
  bundledModules
    // `enabled` is what the user picked in install.ps1; the dev CLI leaves it
    // unset, so the module's own default applies.
    .filter((m) => m && (typeof m.enabled === "boolean" ? m.enabled : m.defaultEnabled))
    .filter((m) => typeof m.code === "string" && m.code.length > 0)
    .map(
      (m) =>
        "(function(){try{" +
        m.code +
        "\nreturn __mdga_module && __mdga_module.default;}catch(err){console.error(" +
        JSON.stringify("[mdga] module " + m.id + " failed to load:") +
        ",err);return null;}})()",
    )
    .join(",\n") +
  "];";

try {
  if (!MAIN_WORLD_BOOTSTRAP) throw new Error("bootstrap missing, nothing injected");
  const p = electron.webFrame.executeJavaScript(MODULES_STUB + "\n" + MAIN_WORLD_BOOTSTRAP);
  console.log("[mdga] preload: main-world bootstrap injected via webFrame");
  if (p && typeof p.catch === "function") {
    p.catch((err) => {
      console.error("[mdga] preload: main-world script rejected:", err && (err.message || err));
    });
  }
} catch (err) {
  console.error("[mdga] preload: webFrame.executeJavaScript failed:", err);
}

try {
  const originalPreload = process.env.MDGA_ORIGINAL_PRELOAD;
  if (originalPreload) {
    require(originalPreload);
    console.log("[mdga] preload: chained Discord preload");
  } else {
    console.warn("[mdga] preload: MDGA_ORIGINAL_PRELOAD not set");
  }
} catch (err) {
  console.error("[mdga] preload: chaining Discord preload failed:", err);
}
