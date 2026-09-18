"use strict";

// mdga renderer preload.
// Runs before Discord's page scripts. We keep whatever contextIsolation
// Discord picked — forcing it off broke identify (gateway 4004). Whether we
// end up isolated or not, the two jobs stay the same:
//   1. Expose window.mdga to the page context.
//   2. Install a webpack hook that captures Discord's require.
//   3. Chain to Discord's original preload so DiscordNative still gets set up.
// The mechanism differs slightly by isolation mode; both branches below.

const electron = require("electron");
const isolated = process.contextIsolated === true;

console.log(
  "[mdga] preload: file loaded, isolated =",
  isolated,
  ", original preload =",
  process.env.MDGA_ORIGINAL_PRELOAD,
);

// This inline script runs in the PAGE (main world) context. It installs the
// webpack hook and exposes window.mdga. When isolation is off we could do
// this from preload directly, but we go through executeJavaScript uniformly
// so both branches behave the same.
const MAIN_WORLD_BOOTSTRAP = `
(() => {
  if (window.mdga) return; // already installed
  const CHUNK_KEY = "webpackChunkdiscord_app";
  let webpackRequire = null;
  const readyCallbacks = [];

  function fireReady(require) {
    webpackRequire = require;
    console.log("[mdga] main-world: webpack require captured");
    const pending = readyCallbacks.splice(0, readyCallbacks.length);
    for (const cb of pending) {
      try { cb(require); } catch (err) { console.error("[mdga] callback failed:", err); }
    }
  }

  function probe(chunkArray) {
    chunkArray.push([
      [Symbol("mdga_probe")],
      {},
      (require) => fireReady(require),
    ]);
  }

  const existing = window[CHUNK_KEY];
  if (Array.isArray(existing)) {
    probe(existing);
  } else {
    let holder = existing;
    Object.defineProperty(window, CHUNK_KEY, {
      configurable: true,
      get() { return holder; },
      set(v) { holder = v; if (Array.isArray(v)) probe(v); },
    });
  }

  const mdga = {
    onWebpackReady(cb) {
      if (typeof cb !== "function") return;
      if (webpackRequire) cb(webpackRequire);
      else readyCallbacks.push(cb);
    },
    getWebpackRequire() { return webpackRequire; },
    getModuleCount() {
      if (!webpackRequire || !webpackRequire.c) return 0;
      return Object.keys(webpackRequire.c).length;
    },
  };

  Object.defineProperty(window, "mdga", {
    value: mdga,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  console.log("[mdga] main-world: window.mdga installed at", location.href);
})();
`;

// Inject the main-world bootstrap. webFrame.executeJavaScript runs code in
// the page context regardless of contextIsolation.
try {
  electron.webFrame.executeJavaScript(MAIN_WORLD_BOOTSTRAP);
  console.log("[mdga] preload: main-world bootstrap injected via webFrame");
} catch (err) {
  console.error("[mdga] preload: webFrame.executeJavaScript failed:", err);
}

// Chain Discord's original preload — DiscordNative and everything else
// they publish must survive intact.
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
