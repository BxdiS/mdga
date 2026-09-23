// Main-world bootstrap. The installer bundles this file with esbuild into
// mdga/bootstrap.js; the renderer preload injects it via webFrame right after
// the module stub that sets window.__mdga_modules__. Order matters: the
// webpack hook has to be in place before Discord's first chunk runs.

import type { Module } from "@mdga/plugin-api";
import { injectCSS, listCSS, removeCSS } from "../css/index.js";
import { diag } from "../diag/index.js";
import { patch, unpatchAll } from "../patcher/index.js";
import {
  dump,
  findAllFactoriesByCode,
  findByCode,
  findByDisplayName,
  findByProps,
  findFactoryByCode,
  findStore,
  findStores,
  getObservedExports,
  getWebpackRequire,
  grep,
  installWebpackHook,
  loadAll,
  onStores,
  onWebpackReady,
  waitFor,
} from "../webpack/index.js";

type Win = Window & { mdga?: unknown; __mdga_modules__?: Array<Module | null> };

function applyModules(win: Win): void {
  try {
    const bundled = win.__mdga_modules__ || [];
    let cssApplied = 0;
    let runtimeRan = 0;
    for (const m of bundled) {
      if (!m) continue;
      if (typeof m.css === "string" && m.css.length > 0) {
        injectCSS(m.id, m.css);
        cssApplied++;
      }
      if (typeof m.runtime === "function") {
        // Runtime hooks depend on window.mdga being present; most also need
        // webpack, so they hand themselves to onWebpackReady.
        try {
          m.runtime();
          runtimeRan++;
        } catch (err) {
          console.error("[mdga] runtime failed for module " + m.id + ":", err);
        }
      }
    }
    if (cssApplied > 0) console.log("[mdga] applied CSS from " + cssApplied + " modules");
    if (runtimeRan > 0) console.log("[mdga] ran runtime for " + runtimeRan + " modules");
    try { delete win.__mdga_modules__; } catch { /* ignore */ }
  } catch (err) {
    console.error("[mdga] failed to apply modules:", err);
  }
}

function main(): void {
  const win = window as Win;
  if (win.mdga) return;

  installWebpackHook();

  const mdga = {
    onWebpackReady,
    getWebpackRequire,
    getObservedExports,
    getObservedCount: () => Object.keys(getObservedExports()).length,
    getModuleCount: () => {
      const req = getWebpackRequire();
      return req?.c ? Object.keys(req.c).length : 0;
    },
    findByProps,
    findByCode,
    findByDisplayName,
    findStore,
    findStores,
    onStores,
    findFactoryByCode,
    findAllFactoriesByCode,
    dump,
    waitFor,
    loadAll,
    grep,
    injectCSS,
    removeCSS,
    listCSS,
    diag,
    patch,
    unpatchAll,
  };

  Object.defineProperty(window, "mdga", {
    value: Object.freeze(mdga),
    writable: false,
    configurable: false,
    enumerable: true,
  });

  applyModules(win);
  console.log("[mdga] window.mdga installed at " + location.href);
}

main();
