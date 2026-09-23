"use strict";

// mdga main-process payload.
// Job: swap Discord's preload for ours on every real BrowserWindow, so our
// renderer preload runs first. We do NOT change contextIsolation or sandbox —
// changing them broke Discord's identify (gateway 4004). Whatever they set is
// what we live with.

const path = require("path");
const Module = require("module");

function log(msg, extra) {
  if (extra !== undefined) console.log("[mdga] main:", msg, extra);
  else console.log("[mdga] main:", msg);
}
function errlog(msg, err) {
  console.error("[mdga] main error:", msg, err);
}

log("payload starting");

try {
  const electron = require("electron");
  const OriginalBrowserWindow = electron.BrowserWindow;
  const MDGA_PRELOAD = path.join(__dirname, "preload.js");
  log("preload target =", MDGA_PRELOAD);

  class PatchedBrowserWindow extends OriginalBrowserWindow {
    constructor(options) {
      try {
        const wp = options && options.webPreferences;
        const title = options && options.title;
        const preload = wp && wp.preload;
        log("BrowserWindow construct — title:", title || "(none)");
        if (preload) log("  original preload:", preload);

        // Only real app windows have a title. Splash and helper windows come
        // through without one — leave them alone.
        if (
          wp &&
          typeof preload === "string" &&
          preload.length > 0 &&
          preload !== MDGA_PRELOAD &&
          title
        ) {
          const original = preload;
          wp.preload = MDGA_PRELOAD;
          process.env.MDGA_ORIGINAL_PRELOAD = original;
          log("  ✓ swapped preload for", title);
        } else {
          log("  → left as-is");
        }
      } catch (err) {
        errlog("constructor patch failed:", err);
      }
      super(options);
    }
  }
  Object.defineProperty(PatchedBrowserWindow, "name", {
    value: "BrowserWindow",
    configurable: true,
  });

  // electron.BrowserWindow is a non-configurable getter — defineProperty and
  // direct assignment both throw. Intercept require("electron") and return a
  // Proxy whose BrowserWindow slot is our patched class.
  const electronProxy = new Proxy(electron, {
    get(target, prop) {
      if (prop === "BrowserWindow") return PatchedBrowserWindow;
      return target[prop];
    },
  });

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...rest) {
    if (request === "electron") return electronProxy;
    return originalLoad.apply(this, [request, ...rest]);
  };
  log("Module._load hooked; require('electron') now returns proxy");
} catch (outer) {
  errlog("outer setup failed:", outer);
}

// Graceful quit for the installer. taskkill /F killed Discord before it
// flushed Local Storage, which logged the user out. The installer drops this
// file next to app.asar instead; we notice it and quit the normal way, same
// as "Quit Discord" in the tray. Local file only, nothing leaves the machine.
try {
  const fs = require("fs");
  const QUIT_REQUEST = path.join(__dirname, "..", "..", "mdga-quit-request");
  fs.watchFile(QUIT_REQUEST, { interval: 1000 }, (cur) => {
    if (cur.mtimeMs === 0) return; // file absent
    try { fs.unlinkSync(QUIT_REQUEST); } catch {}
    log("quit requested by installer");
    require("electron").app.quit();
  });
} catch (err) {
  errlog("quit watcher setup failed:", err);
}

log("payload finished setup");
