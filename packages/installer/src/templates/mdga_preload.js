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

// Runs in the page context. Vencord-style webpack instrumentation:
// hook Function.prototype.m setter to catch every webpack instance the moment
// it's set up — before any factories run. Wrap the factory registry in a
// Proxy; wrap each factory in a Proxy whose apply trap captures the resulting
// module.exports. That gives us a private map moduleId -> exports that stays
// visible even when Discord hides/lazies its own cache.
const MAIN_WORLD_BOOTSTRAP = `
(() => {
  if (window.mdga) return;

  // -- state --------------------------------------------------------------

  let wpRequire = null;                    // main webpack require
  const observedExports = Object.create(null); // { [id]: exports } populated by factory apply-trap
  const readyCbs = [];

  function fireReady(require) {
    wpRequire = require;
    console.log("[mdga] webpack require captured (bundlePath = " + require.p + ")");
    const pending = readyCbs.splice(0, readyCbs.length);
    for (const cb of pending) {
      try { cb(require); } catch (err) { console.error("[mdga] ready cb failed:", err); }
    }
  }

  // -- Function.prototype.m setter hook -----------------------------------
  // Discord's webpack is a function; when it's constructed, it sets .m on
  // itself. We install a setter on Function.prototype.m; the first time any
  // Function instance gets .m assigned, we wrap it. This is exactly the
  // approach Vencord uses.

  const nativeDefineProperty = Object.defineProperty;

  function define(target, key, attrs) {
    return nativeDefineProperty(target, key, { configurable: true, enumerable: true, ...attrs });
  }

  const factoryProxyHandler = {
    apply(originalFactory, thisArg, args) {
      const [module, moduleExports, requireFn] = args;
      let result;
      try {
        result = Reflect.apply(originalFactory, thisArg, args);
      } finally {
        try {
          if (module && "exports" in module) {
            observedExports[String(module.id)] = module.exports;
          } else if (moduleExports != null) {
            observedExports[String(originalFactory.name)] = moduleExports;
          }
          if (wpRequire == null && typeof requireFn === "function" && requireFn.m != null && requireFn.c != null) {
            fireReady(requireFn);
          }
        } catch { /* observation must never break Discord */ }
      }
      return result;
    },
  };

  function wrapFactory(factory) {
    if (typeof factory !== "function") return factory;
    if (factory.__mdga_wrapped) return factory;
    const proxy = new Proxy(factory, factoryProxyHandler);
    try { factory.__mdga_wrapped = true; } catch { /* frozen */ }
    return proxy;
  }

  const factoryRegistryHandler = {
    set(target, prop, value, receiver) {
      const wrapped = wrapFactory(value);
      return Reflect.set(target, prop, wrapped, receiver);
    },
  };

  // Install once. If Discord's webpack has already run (post-refresh reopen
  // race), our hook is late but we still catch subsequent chunk loads via the
  // chunk-array setter below.
  try {
    nativeDefineProperty(Function.prototype, "m", {
      configurable: true,
      set(originalModules) {
        // Deliver value into 'this' as a normal own property from now on.
        define(this, "m", { value: originalModules });

        // Overwrite webpack's defineExports so properties stay configurable —
        // lets us later mark bad exports non-enumerable if we want to.
        try {
          this.d = function (exports, definition) {
            for (const key in definition) {
              if (Object.hasOwn(definition, key) && !Object.hasOwn(exports, key)) {
                Object.defineProperty(exports, key, {
                  configurable: true,
                  enumerable: true,
                  get: definition[key],
                });
              }
            }
          };
        } catch { /* wreq is frozen — ignore */ }

        // Wrap pre-populated factories (Discord ships some inline)
        try {
          for (const moduleId in originalModules) {
            const orig = originalModules[moduleId];
            if (typeof orig === "function" && !orig.__mdga_wrapped) {
              originalModules[moduleId] = wrapFactory(orig);
            }
          }
        } catch (err) { console.error("[mdga] failed to wrap pre-populated factories:", err); }

        // Redefine .m as a Proxy so future factory registrations get wrapped.
        try {
          const proxied = new Proxy(originalModules, factoryRegistryHandler);
          define(this, "m", { value: proxied });
        } catch (err) { console.error("[mdga] failed to proxy factory registry:", err); }

        // If this looks like the main webpack instance (has .c and .p),
        // capture it. Otherwise wait — sentry/libdiscore instances also fire
        // this setter but aren't what we want.
        if (wpRequire == null && this.c != null) {
          fireReady(this);
        }
      },
    });
    console.log("[mdga] installed Function.prototype.m setter hook");
  } catch (err) {
    console.error("[mdga] failed to install .m setter — will fall back to chunk probe:", err);
  }

  // Fallback: chunk-array probe. Works even if the .m hook installed too late.
  // Every chunk file runs "self.webpackChunkdiscord_app ||= []", so the
  // setter fires once per chunk. Probe each array once, and stop once the
  // require is captured.
  const CHUNK_KEY = "webpackChunkdiscord_app";
  const probed = new WeakSet();
  function probe(chunkArray) {
    if (wpRequire != null || probed.has(chunkArray)) return;
    probed.add(chunkArray);
    chunkArray.push([
      [Symbol("mdga_probe")],
      {},
      (require) => { if (wpRequire == null) fireReady(require); },
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

  // -- helpers ------------------------------------------------------------

  function safeGet(obj, key) {
    try { return obj[key]; } catch { return undefined; }
  }

  const PROXY_CHECK_KEY = "is this a proxy that returns values for any key?";
  function isBadProxy(v) {
    if (v === null || typeof v !== "object") return false;
    try {
      const tag = v[Symbol.toStringTag];
      if (tag === "IntlMessagesProxy" || tag === "DOMTokenList") return true;
      if (v[PROXY_CHECK_KEY] !== undefined) {
        try { delete v[PROXY_CHECK_KEY]; } catch {}
        return true;
      }
    } catch { return true; }
    return false;
  }

  // Iterate every module we've observed by wrapping factories, plus wpRequire.c
  // (whichever is bigger). Yields the module's raw exports object.
  function* iterateExports() {
    // observedExports keys are unique already; for wpRequire.c only skip ids
    // the first loop has covered. A plain "in" check avoids building a Set
    // of every module id on each scan.
    for (const id in observedExports) {
      let e; try { e = observedExports[id]; } catch { continue; }
      if (e != null) yield { id, exports: e };
    }
    if (wpRequire && wpRequire.c) {
      for (const id in wpRequire.c) {
        if (id in observedExports) continue;
        let e; try { e = wpRequire.c[id] && wpRequire.c[id].exports; } catch { continue; }
        if (e != null) yield { id, exports: e };
      }
    }
  }

  // Every candidate we consider inside a module's exports: the exports object
  // itself, its .default, and each named export's value. Bad proxies (intl
  // Messages, DOMTokenList, promiscuous responders) are skipped everywhere.
  function candidatesOf(exports) {
    const out = [];
    if (exports == null) return out;
    if (!isBadProxy(exports)) out.push(exports);
    if (typeof exports !== "object" && typeof exports !== "function") return out;
    const def = safeGet(exports, "default");
    if (def != null && !isBadProxy(def)) out.push(def);
    // for...in walks enumerable own + inherited keys. Discord's exports use
    // enumerable getters via wreq.d, so this covers named namespace exports.
    for (const k in exports) {
      if (k === "default") continue;
      const v = safeGet(exports, k);
      if (v == null) continue;
      if (typeof v !== "object" && typeof v !== "function") continue;
      if (isBadProxy(v)) continue;
      out.push(v);
    }
    return out;
  }

  function hasAllProps(v, props) {
    if (v == null || (typeof v !== "object" && typeof v !== "function")) return false;
    if (isBadProxy(v)) return false;
    for (const p of props) if (safeGet(v, p) === undefined) return false;
    return true;
  }

  function stringifies(v, fragments) {
    if (typeof v !== "function") return false;
    let src;
    try { src = Function.prototype.toString.call(v); } catch { return false; }
    for (const f of fragments) if (!src.includes(f)) return false;
    return true;
  }

  // -- finders ------------------------------------------------------------

  function findByProps(...props) {
    if (props.length === 0) return null;
    for (const { exports } of iterateExports()) {
      try {
        for (const cand of candidatesOf(exports)) {
          if (hasAllProps(cand, props)) return cand;
        }
      } catch {}
    }
    return null;
  }

  function findByCode(...fragments) {
    if (fragments.length === 0) return null;
    for (const { exports } of iterateExports()) {
      try {
        for (const cand of candidatesOf(exports)) {
          if (typeof cand === "function" && stringifies(cand, fragments)) return cand;
          if (cand && typeof cand === "object") {
            for (const k in cand) {
              const v = safeGet(cand, k);
              if (stringifies(v, fragments)) return cand;
            }
          }
        }
      } catch {}
    }
    return null;
  }

  function findByDisplayName(name) {
    for (const { exports } of iterateExports()) {
      try {
        for (const cand of candidatesOf(exports)) {
          if (cand != null && safeGet(cand, "displayName") === name) return cand;
        }
      } catch {}
    }
    return null;
  }

  function findStore(name) {
    for (const { exports } of iterateExports()) {
      try {
        for (const cand of candidatesOf(exports)) {
          if (cand == null || typeof cand !== "object") continue;
          const ctor = safeGet(cand, "constructor");
          if (ctor && safeGet(ctor, "displayName") === name) return cand;
        }
      } catch {}
    }
    return null;
  }

  // Look up several stores in a single pass over the module graph. Returns
  // { [name]: store | null }. Stops early once every name is found.
  function findStores(names) {
    const out = Object.create(null);
    let left = 0;
    for (const n of names || []) { if (!(n in out)) { out[n] = null; left++; } }
    if (left === 0) return out;
    for (const { exports } of iterateExports()) {
      try {
        for (const cand of candidatesOf(exports)) {
          if (cand == null || typeof cand !== "object") continue;
          const ctor = safeGet(cand, "constructor");
          const name = ctor && safeGet(ctor, "displayName");
          if (typeof name === "string" && name in out && out[name] === null) {
            out[name] = cand;
            if (--left === 0) return out;
          }
        }
      } catch {}
    }
    return out;
  }

  function findFactoryByCode(...fragments) {
    if (!wpRequire || !wpRequire.m || fragments.length === 0) return null;
    for (const id in wpRequire.m) {
      let src;
      try {
        const f = wpRequire.m[id];
        if (typeof f !== "function") continue;
        src = Function.prototype.toString.call(f);
      } catch { continue; }
      let ok = true;
      for (const f of fragments) if (!src.includes(f)) { ok = false; break; }
      if (!ok) continue;
      return { id, factory: wpRequire.m[id], exports: observedExports[id] };
    }
    return null;
  }

  function findAllFactoriesByCode(...fragments) {
    const out = [];
    if (!wpRequire || !wpRequire.m || fragments.length === 0) return out;
    for (const id in wpRequire.m) {
      let src;
      try {
        const f = wpRequire.m[id];
        if (typeof f !== "function") continue;
        src = Function.prototype.toString.call(f);
      } catch { continue; }
      let ok = true;
      for (const f of fragments) if (!src.includes(f)) { ok = false; break; }
      if (!ok) continue;
      out.push({ id, factory: wpRequire.m[id], exports: observedExports[id] });
    }
    return out;
  }

  function grep(predicate, limit) {
    const max = typeof limit === "number" ? limit : 50;
    const hits = [];
    for (const { id, exports } of iterateExports()) {
      try {
        for (const cand of candidatesOf(exports)) {
          let ok = false;
          try { ok = predicate(cand) === true; } catch { ok = false; }
          if (ok) {
            hits.push({ id, exp: cand });
            if (hits.length >= max) return hits;
          }
        }
      } catch {}
    }
    return hits;
  }

  function loadAll() {
    if (!wpRequire || !wpRequire.m) return 0;
    let n = 0;
    for (const id in wpRequire.m) {
      try { wpRequire(id); n++; } catch {}
    }
    console.log("[mdga] loadAll — required " + n + " factories, observed " + Object.keys(observedExports).length + " exports");
    return n;
  }

  function dump(id) {
    if (!wpRequire) return null;
    const cached = wpRequire.c && wpRequire.c[id];
    const factory = wpRequire.m && wpRequire.m[id];
    let src = null;
    if (typeof factory === "function") {
      try { src = Function.prototype.toString.call(factory).slice(0, 800); } catch {}
    }
    return {
      id,
      loaded: !!cached && cached.loaded,
      exports: cached ? cached.exports : undefined,
      observed: observedExports[id],
      factorySource: src,
    };
  }

  // -- CSS injection -----------------------------------------------------
  // Each id maps to a <style> element in <head>. Re-injecting the same id
  // replaces the sheet; removeCSS unmounts it. Used by modules that hide
  // things by selector when webpack patching would be overkill.
  const cssNodes = new Map();

  function injectCSS(id, css) {
    if (typeof id !== "string" || typeof css !== "string") return;
    let node = cssNodes.get(id);
    if (!node) {
      node = document.createElement("style");
      node.setAttribute("data-mdga-css", id);
      // document.head may not exist yet when we run this early in page load.
      // Fall back to documentElement (<html>) so the sheet is live either way.
      const parent = document.head || document.documentElement;
      if (parent) {
        parent.appendChild(node);
      } else {
        // No DOM at all yet — queue until it's ready.
        // Skip if removeCSS (or a re-inject) replaced this node meanwhile.
        document.addEventListener("DOMContentLoaded", () => {
          if (cssNodes.get(id) !== node) return;
          (document.head || document.documentElement).appendChild(node);
        }, { once: true });
      }
      cssNodes.set(id, node);
    }
    node.textContent = css;
  }

  function removeCSS(id) {
    const node = cssNodes.get(id);
    if (!node) return;
    node.remove();
    cssNodes.delete(id);
  }

  function listCSS() {
    return Array.from(cssNodes.keys());
  }

  // mdga.diag(query) — universal probe: given a keyword/URL fragment,
  // dumps factory matches, REST reachability, Flux action names and stores
  // with matching displayName. First step for finding a new module's hooks.
  function diag(query) {
    if (typeof query !== "string" || query.length === 0) {
      console.log("[mdga] diag: pass a keyword, e.g. mdga.diag('quests')");
      return;
    }
    var q = query;
    var qLower = q.toLowerCase();
    try {
      var hits = findAllFactoriesByCode(q) || [];
      console.log("[mdga] diag: factories mentioning " + q + ":", hits.length);
      var i, entry, id, factory, src, idx, snippet, showed;
      showed = 0;
      for (i = 0; i < hits.length; i++) {
        if (showed >= 5) break;
        entry = hits[i];
        if (!entry) continue;
        id = entry.id;
        factory = entry.factory;
        src = "";
        try { src = String(factory); } catch (e1) { src = ""; }
        idx = src.indexOf(q);
        if (idx >= 0) {
          snippet = src.slice(Math.max(0, idx - 160), idx + 160);
        } else {
          snippet = src.slice(0, 320);
        }
        console.log("[mdga] diag:   factory " + id + " snippet:", snippet);
        showed = showed + 1;
      }
      var rest = findByProps("get", "post", "put", "delete", "patch");
      if (rest) {
        console.log("[mdga] diag: REST client reachable, keys:", Object.keys(rest));
      } else {
        console.log("[mdga] diag: REST client not reachable");
      }
      var disp = findByProps("dispatch", "register");
      if (disp && disp._actionHandlers && disp._actionHandlers._orderedActionHandlers) {
        var actionKeys = Object.keys(disp._actionHandlers._orderedActionHandlers);
        var matches = [];
        var k;
        for (k = 0; k < actionKeys.length; k++) {
          if (actionKeys[k].toLowerCase().indexOf(qLower) !== -1) {
            matches.push(actionKeys[k]);
          }
        }
        console.log("[mdga] diag: dispatcher actions matching " + q + ":", matches);
      }
      var stores = [];
      var mid, v, storeName;
      for (mid in observedExports) {
        v = observedExports[mid];
        if (!v) continue;
        if (typeof v !== "object") continue;
        storeName = "";
        try {
          if (v.constructor && typeof v.constructor.displayName === "string") {
            storeName = v.constructor.displayName;
          }
        } catch (e2) { storeName = ""; }
        if (storeName && storeName.toLowerCase().indexOf(qLower) !== -1) {
          stores.push([mid, storeName]);
        }
      }
      console.log("[mdga] diag: stores with displayName matching " + q + ":", stores);
    } catch (err) {
      console.error("[mdga] diag failed:", err && (err.stack || err.message || err));
    }
  }

  function waitFor(produce, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 10000;
    const intervalMs = (opts && opts.intervalMs) || 100;
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        try {
          const v = produce();
          if (v !== null && v !== undefined) { resolve(v); return; }
        } catch (err) { reject(err); return; }
        if (Date.now() - started > timeoutMs) { reject(new Error("mdga waitFor: timeout")); return; }
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  // -- monkey-patcher -----------------------------------------------------

  const STATE = Symbol.for("mdga.patcher.state");
  const registered = [];

  function getOrInstall(target, method) {
    const current = target[method];
    if (typeof current !== "function") throw new Error("mdga patcher: " + method + " is not a function");
    if (current[STATE]) return current[STATE];
    // NB: DO NOT .bind(target). For prototype methods
    // (XMLHttpRequest.prototype.open etc.) the native impl requires the
    // instance as receiver, not the prototype -- a bound copy throws
    // "Illegal invocation" for every non-target call and takes out
    // unrelated features (chats, servers, friends). Leaving the receiver
    // unbound lets the wrapper forward whatever the caller passed in.
    const state = { original: current, before: [], instead: [], after: [], disposed: false };
    const wrapper = function (...args) {
      if (state.disposed) return state.original.apply(this, args);
      let currentArgs = args;
      for (const h of state.before) {
        try { const ret = h(currentArgs, state.original, this); if (Array.isArray(ret)) currentArgs = ret; }
        catch (err) { console.error("[mdga] before threw:", err); }
      }
      let result;
      if (state.instead.length === 0) {
        result = state.original.apply(this, currentArgs);
      } else {
        let next = state.original;
        for (const h of state.instead) { const inner = next; next = (...a) => h(a, inner, this); }
        try { result = next.apply(this, currentArgs); }
        catch (err) { console.error("[mdga] instead threw:", err); result = state.original.apply(this, currentArgs); }
      }
      for (const h of state.after) {
        try { const ret = h([result, ...currentArgs], state.original, this); if (ret !== undefined) result = ret; }
        catch (err) { console.error("[mdga] after threw:", err); }
      }
      return result;
    };
    wrapper[STATE] = state;
    try { Object.defineProperty(wrapper, "name", { value: current.name || method }); } catch {}
    target[method] = wrapper;
    registered.push({ target, method });
    return state;
  }

  function patch(target, method, phase, handler) {
    if (target === null || (typeof target !== "object" && typeof target !== "function")) {
      throw new Error("mdga patcher: target must be object or function");
    }
    if (phase !== "before" && phase !== "instead" && phase !== "after") {
      throw new Error("mdga patcher: phase must be before | instead | after");
    }
    const state = getOrInstall(target, method);
    state[phase].push(handler);
    return { unpatch() { const list = state[phase]; const i = list.indexOf(handler); if (i >= 0) list.splice(i, 1); } };
  }

  function unpatchAll() {
    while (registered.length > 0) {
      const entry = registered.pop();
      const wrapper = entry.target[entry.method];
      const state = wrapper && wrapper[STATE];
      if (!state) continue;
      state.disposed = true;
      entry.target[entry.method] = state.original;
    }
  }

  // -- expose -------------------------------------------------------------

  const mdga = {
    onWebpackReady(cb) {
      if (typeof cb !== "function") return;
      if (wpRequire) cb(wpRequire);
      else readyCbs.push(cb);
    },
    getWebpackRequire() { return wpRequire; },
    getObservedExports() { return observedExports; },
    getObservedCount() { return Object.keys(observedExports).length; },
    getModuleCount() {
      if (!wpRequire || !wpRequire.c) return 0;
      return Object.keys(wpRequire.c).length;
    },
    findByProps,
    findByCode,
    findByDisplayName,
    findStore,
    findStores,
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

  // Apply CSS + runtime from every bundled + enabled module.
  try {
    const bundled = window.__mdga_modules__ || [];
    let cssApplied = 0;
    let runtimeRan = 0;
    for (const m of bundled) {
      if (!m) continue;
      if (typeof m.css === "string" && m.css.length > 0) {
        injectCSS(m.id, m.css);
        cssApplied++;
      }
      if (typeof m.runtime === "string" && m.runtime.length > 0) {
        try {
          // Convert the stringified arrow/function back into a callable and
          // invoke it. Runtime hooks depend on window.mdga being present;
          // most also need webpack modules loaded, so hand them onWebpackReady
          // and let each hook decide when it's safe to run.
          // esbuild (via tsx) wraps named functions in __name(fn, "…") to
          // preserve Function.prototype.name. That helper doesn't exist in
          // the main world, so we shim it before evaluating the body.
          const src =
            "(function(){var __name=function(f){return f;};return " + m.runtime + ";})()";
          const fn = (0, eval)(src);
          if (typeof fn === "function") {
            fn();
            runtimeRan++;
          }
        } catch (err) {
          console.error("[mdga] runtime failed for module " + m.id + ":", err);
        }
      }
    }
    if (cssApplied > 0) console.log("[mdga] applied CSS from " + cssApplied + " modules");
    if (runtimeRan > 0) console.log("[mdga] ran runtime for " + runtimeRan + " modules");
    try { delete window.__mdga_modules__; } catch {}
  } catch (err) { console.error("[mdga] failed to apply modules:", err); }

  console.log("[mdga] window.mdga installed at " + location.href);
})();
`;

// Serialize the modules manifest for the main-world bootstrap. Runtime
// enable-state will live in settings later and gate this. `runtime` is a
// stringified function; the bootstrap will wrap it in a Function() call.
const BUNDLED_MODULES_JSON = JSON.stringify(
  bundledModules
    .filter((m) => m && m.defaultEnabled && (typeof m.css === "string" || typeof m.runtime === "string"))
    .map((m) => ({
      id: m.id,
      css: typeof m.css === "string" ? m.css : "",
      runtime: typeof m.runtime === "string" ? m.runtime : "",
    })),
);

// Prepend a small stub that hands the manifest to the bootstrap via a
// well-known global. Kept separate so the bootstrap stays a static string and
// its escaping stays predictable.
const MODULES_STUB = "window.__mdga_modules__ = " + BUNDLED_MODULES_JSON + ";";

try {
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
