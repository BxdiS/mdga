import { defineModule } from "@mdga/plugin-api";

// The Shop row in the DM sidebar, keyed by the stable data-list-item-id
// suffix (seen on Stable: "private-channels-uid_2783___shop"). Hiding the
// <li> removes its hover target and keyboard focus too. The Nitro row next
// to it (___nitro) is a different feature and stays.
const CSS = `
li[role="listitem"]:has(a[data-list-item-id$="___shop"]) { display: none !important; }
div[class^="wrapper__"]:has(> li[role="listitem"] a[data-list-item-id$="___shop"]) { display: none !important; }

/* The Shop button in your profile's button row, between Message and More.
   Matched by its label and, for other locales, by the storefront icon. */
[class*="profileButtons_"] > span:has(> button[aria-label="Shop"]),
[class*="profileButtons_"] > span:has(> button path[d^="M2.63 4.19A3 3 0 0 1 5.53 2H7"]) { display: none !important; }

/* The Wishlist tab on profiles, a list of Shop items. Other people's
   profiles lose it through UserProfileStore (runtime below). Your own
   profile always shows it, and the tab has no id or other stable attribute,
   so this matches the English label only. */
[role="tab"][class*="tabBarItem_"][aria-label="Wishlist"] { display: none !important; }
`;

type Patch = (
  target: object,
  method: string,
  phase: "before" | "instead",
  handler: (args: unknown[], original: (...a: unknown[]) => unknown, self: unknown) => unknown,
) => unknown;

// Shop endpoints. Opening the Shop fetched /users/@me/collectibles-purchases
// (seen on Stable 1.0.9259); the catalog and home feed come from
// /collectibles-shop* and /collectibles-categories* (named after the
// COLLECTIBLES_SHOP_HOME_FETCH_SUCCESS / COLLECTIBLES_CATEGORIES_FETCH actions).
const SHOP_URL = /\/api\/v\d+\/(collectibles-shop|collectibles-categories|users\/@me\/collectibles-purchases)(\/|\?|$)/;

// Trust & Safety fence: everything here stays in this client. The XHR guard
// only skips send() for matching URLs, so the request never leaves; nothing
// is modified or faked on the wire and the XHR resolves locally as an empty
// 204. The store patch changes what the UI reads, the route guard where it
// navigates.
function runtime(): void {
  const mdga = (window as unknown as { mdga?: {
    patch: Patch;
    onWebpackReady(cb: () => void): void;
    onStores(names: string[], cb: (name: string, store: object) => void): void;
    findByProps(...props: string[]): unknown;
  } }).mdga;
  if (!mdga) return;

  // Wishlists live in UserProfileStore (getWishlistIds, getFirstWishlistId,
  // getWishlistSettings; seen on Stable). The profile's wishlist hook reads
  // getFirstWishlistId and returns null when a user has none, and other
  // people's profiles only get the Wishlist tab when it is not null, so
  // report no wishlists for everyone. Your own profile always gets the tab,
  // which is what the CSS label match is for. Constant return values keep
  // store reads stable for React.
  const NO_WISHLISTS: readonly string[] = Object.freeze([]);
  const WISHLIST_STAMP = Symbol.for("mdga.no-shop.wishlist-patched");
  mdga.onWebpackReady(() => {
    mdga.onStores(["UserProfileStore"], (_name, store) => {
      const proto = Object.getPrototypeOf(store) as Record<PropertyKey, unknown>;
      if (proto[WISHLIST_STAMP]) return;
      const done: string[] = [];
      if (typeof proto.getFirstWishlistId === "function") {
        mdga.patch(proto, "getFirstWishlistId", "instead", () => null);
        done.push("getFirstWishlistId");
      }
      if (typeof proto.getWishlistIds === "function") {
        mdga.patch(proto, "getWishlistIds", "instead", () => NO_WISHLISTS);
        done.push("getWishlistIds");
      }
      try { Object.defineProperty(proto, WISHLIST_STAMP, { value: true }); } catch { /* frozen */ }
      console.log("[mdga] no-shop: no wishlists from UserProfileStore." + (done.join(", .") || "(nothing)"));
    });
  });

  // Route guard. The Shop is the /shop route, and it opens from buttons and
  // links all over the app: profiles, collectible previews, discord.com/shop
  // links in chat. Discord's route tracker hands out the router's history
  // (history v4: push, replace, listen, ...; seen on Stable) through
  // getHistory(). Dropping push and replace to /shop keeps the page from
  // mounting. Server shops live under /channels/<guild>/ and are not matched.
  const SHOP_PATH = /^\/shop(?:[/?#]|$)/;
  const pathOf = (to: unknown): string => {
    if (typeof to === "string") return to;
    const pathname = to && typeof to === "object" ? (to as { pathname?: unknown }).pathname : undefined;
    return typeof pathname === "string" ? pathname : "";
  };
  const HISTORY_STAMP = Symbol.for("mdga.no-shop.history-patched");
  const guardHistory = (): boolean => {
    let history: Record<PropertyKey, unknown> | null = null;
    try {
      const holder = mdga.findByProps("getHistory") as { getHistory?: () => unknown } | null;
      const found = holder?.getHistory?.();
      if (found && typeof found === "object") history = found as Record<PropertyKey, unknown>;
    } catch { history = null; }
    if (!history || typeof history.push !== "function" || typeof history.listen !== "function") return false;
    if (history[HISTORY_STAMP]) return true;
    for (const method of ["push", "replace"]) {
      if (typeof history[method] !== "function") continue;
      mdga.patch(history, method, "instead", (args, original, self) => {
        const path = pathOf(args[0]);
        if (SHOP_PATH.test(path)) {
          console.log("[mdga] no-shop: blocked navigation to " + path);
          return undefined;
        }
        return original.apply(self, args);
      });
    }
    try { Object.defineProperty(history, HISTORY_STAMP, { value: true }); } catch { /* frozen */ }
    console.log("[mdga] no-shop: guarded navigation to /shop");
    return true;
  };
  // The router is not loaded yet when webpack comes up, and polling for it
  // costs a full module scan per tick. Look it up on the first pointer or
  // key press instead: capture listeners run before Discord's own handlers,
  // so that first click is already guarded. Give up after 5 tries.
  let historyTries = 0;
  const onFirstInput = (): void => {
    const done = guardHistory();
    if (done || ++historyTries >= 5) {
      window.removeEventListener("pointerdown", onFirstInput, true);
      window.removeEventListener("keydown", onFirstInput, true);
      if (!done) console.log("[mdga] no-shop: router history not found, /shop links stay open");
    }
  };
  window.addEventListener("pointerdown", onFirstInput, true);
  window.addEventListener("keydown", onFirstInput, true);

  const STAMP = "__mdga_no_shop_xhr__";
  mdga.onWebpackReady(() => {
    const proto = XMLHttpRequest.prototype as XMLHttpRequest & Record<string, unknown>;
    if (proto[STAMP]) return;
    mdga.patch(proto, "open", "before", (args, _original, self) => {
      (self as Record<string, unknown>).__mdga_shop_url = args[1];
      return undefined;
    });
    mdga.patch(proto, "send", "instead", (args, original, self) => {
      const url = (self as Record<string, unknown>).__mdga_shop_url;
      if (typeof url !== "string" || !SHOP_URL.test(url)) return original.apply(self, args);
      console.log("[mdga] no-shop: blocked XHR " + url);
      const xhr = self as XMLHttpRequest & { onreadystatechange?: () => void; onload?: () => void; onloadend?: () => void };
      try {
        Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
        Object.defineProperty(xhr, "status", { value: 204, configurable: true });
        Object.defineProperty(xhr, "statusText", { value: "No Content", configurable: true });
        Object.defineProperty(xhr, "responseText", { value: "", configurable: true });
        Object.defineProperty(xhr, "response", { value: "", configurable: true });
        Object.defineProperty(xhr, "responseURL", { value: url, configurable: true });
      } catch { /* readonly on some engines */ }
      setTimeout(() => {
        for (const ev of ["readystatechange", "load", "loadend"] as const) {
          try {
            const handler = (xhr as unknown as Record<string, unknown>)["on" + ev];
            if (typeof handler === "function") handler.call(xhr);
          } catch {}
          try { xhr.dispatchEvent(new Event(ev)); } catch {}
        }
      }, 0);
      return undefined;
    });
    try { Object.defineProperty(proto, STAMP, { value: true }); } catch { proto[STAMP] = true; }
    console.log("[mdga] no-shop: guarded XMLHttpRequest for the Shop endpoints");
  });
}

export default defineModule({
  id: "no-shop",
  label: "No Shop",
  description:
    "Hides the Shop row from the DM sidebar, the Shop button and Wishlist tab on profiles, " +
    "keeps /shop links from opening the Shop, and drops the Shop's catalog and purchases requests.",
  defaultEnabled: true,
  css: CSS,
  runtime,
});
