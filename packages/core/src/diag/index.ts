// mdga.diag(query) — universal probe: given a keyword/URL fragment, dumps
// factory matches, REST reachability, Flux action names and stores with a
// matching displayName. First step for finding a new module's hooks.

import { findAllFactoriesByCode, findByProps, getObservedExports } from "../webpack/index.js";

export function diag(query: string): void {
  if (typeof query !== "string" || query.length === 0) {
    console.log("[mdga] diag: pass a keyword, e.g. mdga.diag('quests')");
    return;
  }
  const q = query;
  const qLower = q.toLowerCase();
  try {
    const hits = findAllFactoriesByCode(q);
    console.log("[mdga] diag: factories mentioning " + q + ":", hits.length);
    for (const entry of hits.slice(0, 5)) {
      let src = "";
      try { src = String(entry.factory); } catch { src = ""; }
      const idx = src.indexOf(q);
      const snippet = idx >= 0 ? src.slice(Math.max(0, idx - 160), idx + 160) : src.slice(0, 320);
      console.log("[mdga] diag:   factory " + entry.id + " snippet:", snippet);
    }

    const rest = findByProps("get", "post", "put", "delete", "patch");
    if (rest) {
      console.log("[mdga] diag: REST client reachable, keys:", Object.keys(rest));
    } else {
      console.log("[mdga] diag: REST client not reachable");
    }

    const disp = findByProps("dispatch", "register") as
      | { _actionHandlers?: { _orderedActionHandlers?: Record<string, unknown> } }
      | null;
    const ordered = disp?._actionHandlers?._orderedActionHandlers;
    if (ordered) {
      const matches = Object.keys(ordered).filter((k) => k.toLowerCase().includes(qLower));
      console.log("[mdga] diag: dispatcher actions matching " + q + ":", matches);
    }

    const stores: Array<[string, string]> = [];
    const observed = getObservedExports();
    for (const mid in observed) {
      const v = observed[mid];
      if (!v || typeof v !== "object") continue;
      let name = "";
      try {
        const ctor = (v as { constructor?: { displayName?: unknown } }).constructor;
        if (ctor && typeof ctor.displayName === "string") name = ctor.displayName;
      } catch { name = ""; }
      if (name && name.toLowerCase().includes(qLower)) stores.push([mid, name]);
    }
    console.log("[mdga] diag: stores with displayName matching " + q + ":", stores);
  } catch (err) {
    const e = err as { stack?: string; message?: string } | undefined;
    console.error("[mdga] diag failed:", e && (e.stack || e.message || err));
  }
}
