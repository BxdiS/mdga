import { defineModule } from "@mdga/plugin-api";

// The Nitro row in the DM sidebar, keyed by the stable data-list-item-id
// suffix (seen on Stable: "private-channels-uid_<n>___nitro"). It opens the
// /store route: the Nitro marketing page without a subscription ("Unlock a
// World of Perks with Nitro", plans, compare table) and Nitro home with one.
// Hiding the <li> removes its hover target and keyboard focus too.
const CSS = `
li[role="listitem"]:has(a[data-list-item-id$="___nitro"]) { display: none !important; }
div[class^="wrapper__"]:has(> li[role="listitem"] a[data-list-item-id$="___nitro"]) { display: none !important; }
`;

type Patch = (
  target: object,
  method: string,
  phase: "instead",
  handler: (args: unknown[], original: (...a: unknown[]) => unknown, self: unknown) => unknown,
) => unknown;

// Trust & Safety fence: the route guard only changes where this client
// navigates. Nothing is sent, and Nitro's own requests (prices, plans, used
// by the purchase flows elsewhere) are left alone.
function runtime(): void {
  const mdga = (window as unknown as { mdga?: {
    patch: Patch;
    findByProps(...props: string[]): unknown;
  } }).mdga;
  if (!mdga) return;

  // Route guard, as in no-shop: Discord's route tracker hands out the
  // router's history (history v4) through getHistory(). Dropping push and
  // replace to /store keeps the Nitro page from opening from the links and
  // "Learn more" buttons elsewhere in the app. Subscription and gift
  // settings live under User Settings and are not matched.
  const NITRO_PATH = /^\/store(?:[/?#]|$)/;
  const pathOf = (to: unknown): string => {
    if (typeof to === "string") return to;
    const pathname = to && typeof to === "object" ? (to as { pathname?: unknown }).pathname : undefined;
    return typeof pathname === "string" ? pathname : "";
  };
  const HISTORY_STAMP = Symbol.for("mdga.no-nitro-tab.history-patched");
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
        if (NITRO_PATH.test(path)) {
          console.log("[mdga] no-nitro-tab: blocked navigation to " + path);
          return undefined;
        }
        return original.apply(self, args);
      });
    }
    try { Object.defineProperty(history, HISTORY_STAMP, { value: true }); } catch { /* frozen */ }
    console.log("[mdga] no-nitro-tab: guarded navigation to /store");
    return true;
  };
  // The router is not loaded yet when webpack comes up; look it up on the
  // first pointer or key press, before Discord's own handlers see it.
  let historyTries = 0;
  const onFirstInput = (): void => {
    const done = guardHistory();
    if (done || ++historyTries >= 5) {
      window.removeEventListener("pointerdown", onFirstInput, true);
      window.removeEventListener("keydown", onFirstInput, true);
      if (!done) console.log("[mdga] no-nitro-tab: router history not found, links to /store stay open");
    }
  };
  window.addEventListener("pointerdown", onFirstInput, true);
  window.addEventListener("keydown", onFirstInput, true);
}

export default defineModule({
  id: "no-nitro-tab",
  label: "No Nitro tab",
  description:
    "Hides the Nitro row from the DM list and keeps links inside the app from opening the Nitro page " +
    "(the Nitro marketing page, or Nitro home with a subscription).",
  defaultEnabled: true,
  css: CSS,
  runtime,
});
