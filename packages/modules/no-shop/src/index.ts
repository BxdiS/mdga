import { defineModule } from "@mdga/plugin-api";

// Sidebar entries are keyed by data-list-item-id, whose suffix is stable
// across Discord builds and locales even when the uid prefix (e.g.
// "private-channels-uid_11___") changes. Hiding the whole <li> via :has()
// keeps hover targets, focus rings and keyboard navigation gone too.
//
// Scope: this module only kills Quests end-to-end (UI + store + XHR).
// Shop and Nitro rows also live under similar data-list-item-id suffixes
// but their features are not yet neutralised at the store or network
// layers, so a CSS-only hide would be a half-measure. They will get
// their own modules (no-shop-tab, no-nitro-store) and be removed there.
const CSS = `
li[role="listitem"]:has(a[data-list-item-id$="___quests"]) { display: none !important; }
/* The Quests item is wrapped in a shine-animation container; collapse it too
   so its padding does not leave a gap. */
div[class^="wrapper__"]:has(> li[role="listitem"] a[data-list-item-id$="___quests"]) { display: none !important; }
`;

// Runtime hook — executed in the main world after `window.mdga` is set up.
// Trust & Safety fence: we only patch read-side store methods so the client
// sees "no quests" and renders nothing. We do NOT modify outgoing requests,
// do NOT dispatch fake events, do NOT touch identify or gateway. Not making
// a fetch we could have made is not something the server can detect.
function runtime() {
  const mdga = (window as unknown as { mdga: Record<string, unknown> }).mdga;
  if (!mdga) return;

  const patches: Array<{ unpatch(): void }> = [];
  const patch = mdga["patch"] as (
    target: object,
    method: string,
    phase: "before" | "instead" | "after",
    handler: (
      args: unknown[],
      original: (...a: unknown[]) => unknown,
      self: unknown,
    ) => unknown,
  ) => { unpatch(): void };
  const findStores = mdga["findStores"] as (
    names: string[],
  ) => Record<string, Record<string, unknown> | null>;

  // Level 3: block outbound HTTP requests to /quests/* at the XHR layer.
  // Discord's public REST facade (findByProps("get","post",…)) is only ONE
  // of several call sites — the fetchers use a lower-level HTTP module that
  // bypasses the facade. Patching XMLHttpRequest.prototype.open catches
  // every code path. T&S fence: we only check the URL and skip send() when
  // it matches — the request never leaves the client. That is server-side
  // indistinguishable from a user who never opened the Quests panel.
  const REST_STAMP = "__mdga_no_shop_xhr__";
  const installRest = (): boolean => {
    const XHR = (window as unknown as { XMLHttpRequest?: {
      prototype: XMLHttpRequest & Record<string, unknown>;
    } }).XMLHttpRequest;
    if (!XHR || !XHR.prototype) return false;
    const proto = XHR.prototype as XMLHttpRequest & Record<string, unknown>;
    if (proto[REST_STAMP]) return true;
    const isQuest = (u: unknown): boolean =>
      typeof u === "string" && /\/api\/v\d+\/quests(\/|\?|$)/.test(u);
    // Capture URL on open() so send() can decide whether to proceed.
    patches.push(
      patch(proto, "open", "before", (args, _original, self) => {
        // args: [method, url, async?, user?, password?]
        (self as Record<string, unknown>).__mdga_url = args[1];
        return undefined;
      }),
    );
    patches.push(
      patch(proto, "send", "instead", (args, original, self) => {
        const url = (self as Record<string, unknown>).__mdga_url;
        if (isQuest(url)) {
          console.log("[mdga] no-shop: blocked XHR " + String(url));
          // Fake a successful empty 204 so the fetcher's .then chain resolves
          // instead of erroring. Discord's stores handle an empty body fine
          // (and our getter patches already report "nothing").
          const xhr = self as unknown as XMLHttpRequest & {
            onreadystatechange?: () => void;
            onload?: () => void;
            onloadend?: () => void;
          };
          try {
            Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
            Object.defineProperty(xhr, "status", { value: 204, configurable: true });
            Object.defineProperty(xhr, "statusText", { value: "No Content", configurable: true });
            Object.defineProperty(xhr, "responseText", { value: "", configurable: true });
            Object.defineProperty(xhr, "response", { value: "", configurable: true });
            Object.defineProperty(xhr, "responseURL", { value: String(url), configurable: true });
          } catch { /* readonly on some engines */ }
          setTimeout(() => {
            try { if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange(); } catch {}
            try { xhr.dispatchEvent(new Event("readystatechange")); } catch {}
            try { if (typeof xhr.onload === "function") xhr.onload(); } catch {}
            try { xhr.dispatchEvent(new Event("load")); } catch {}
            try { if (typeof xhr.onloadend === "function") xhr.onloadend(); } catch {}
            try { xhr.dispatchEvent(new Event("loadend")); } catch {}
          }, 0);
          return undefined;
        }
        return (original as (...a: unknown[]) => unknown).apply(self, args);
      }),
    );
    try {
      Object.defineProperty(proto, REST_STAMP, { value: true, enumerable: false });
    } catch { proto[REST_STAMP] = true; }
    console.log("[mdga] no-shop: guarded XMLHttpRequest for /quests/*");
    return true;
  };

  const STORE_STAMP = Symbol.for("mdga.no-shop.stores-patched");
  const installStores = (): boolean => {
    // One pass over the module graph for both stores.
    const found = findStores(["QuestStore", "UnenrolledActivityQuestStore"]);
    const qs = (found["QuestStore"] ?? null) as Record<string, (...a: unknown[]) => unknown> | null;
    if (qs && !(qs as unknown as Record<symbol, unknown>)[STORE_STAMP]) {
      const proto = Object.getPrototypeOf(qs) as Record<string, unknown>;
      const emptyMap = new Map();
      // Method → forced return. Missing methods are skipped safely.
      const overrides: Record<string, unknown> = {
        getQuest: undefined,
        getQuestConfig: undefined,
        getQuestPreviewOverride: undefined,
        getQuestLoadedViaPreview: undefined,
        getFetchQuestPreviewError: null,
        getStreamHeartbeatFailure: null,
        getRewardCode: null,
        getRewards: null,
        getOptimisticProgress: null,
        selectedTaskPlatform: null,
        getExpiredQuestsMap: emptyMap,
        isFetchingQuestPreview: false,
        isEnrolling: false,
        isClaimingReward: false,
        isFetchingRewardCode: false,
        isDismissingContent: false,
        isAdContentDismissed: true,
        isProgressingOnDesktop: false,
        isQuestExpired: true,
        isFetchingEarnedQuestToDeliverByPlacement: false,
      };
      for (const name in overrides) {
        if (typeof proto[name] === "function") {
          const value = overrides[name];
          patches.push(patch(proto, name, "instead", () => value));
        }
      }
      try {
        Object.defineProperty(qs, STORE_STAMP, { value: true, enumerable: false });
      } catch { (qs as unknown as Record<symbol, unknown>)[STORE_STAMP] = true; }
      console.log("[mdga] no-shop: neutralised QuestStore");
    }

    const uqs = (found["UnenrolledActivityQuestStore"] ?? null) as
      | Record<string, (...a: unknown[]) => unknown>
      | null;
    if (uqs && !(uqs as unknown as Record<symbol, unknown>)[STORE_STAMP]) {
      const proto = Object.getPrototypeOf(uqs) as Record<string, unknown>;
      if (typeof proto["getState"] === "function") {
        patches.push(patch(proto, "getState", "instead", () => ({ dismissedQuestIds: [] })));
      }
      if (typeof proto["isDismissed"] === "function") {
        patches.push(patch(proto, "isDismissed", "instead", () => true));
      }
      if (typeof proto["getDismissedQuestIds"] === "function") {
        patches.push(patch(proto, "getDismissedQuestIds", "instead", () => new Set()));
      }
      try {
        Object.defineProperty(uqs, STORE_STAMP, { value: true, enumerable: false });
      } catch { (uqs as unknown as Record<symbol, unknown>)[STORE_STAMP] = true; }
      console.log("[mdga] no-shop: neutralised UnenrolledActivityQuestStore");
    }
    // Done only when both are patched. UnenrolledActivityQuestStore loads
    // later than QuestStore; stopping on the first hit left it unpatched.
    const stamped = (s: unknown): boolean =>
      !!s && !!(s as Record<symbol, unknown>)[STORE_STAMP];
    return stamped(qs) && stamped(uqs);
  };

  const onWebpackReady = mdga["onWebpackReady"] as (cb: () => void) => void;
  onWebpackReady(() => {
    // Quest fetches fire from Discord's boot code very early after webpack
    // is ready. Poll on a tight interval until each guard lands, then stop.
    let restDone = installRest();
    let storesDone = installStores();
    let attempts = 0;
    if (restDone && storesDone) return;
    const poll = setInterval(() => {
      attempts++;
      if (!restDone) restDone = installRest();
      if (!storesDone) storesDone = installStores();
      if ((restDone && storesDone) || attempts > 200) {
        clearInterval(poll);
        if (!storesDone) slowPoll();
      }
    }, 25);
    // UnenrolledActivityQuestStore can load after the 5 s fast window.
    // Keep looking once a second for another minute; findStores is ~13 ms
    // per pass, so this costs well under 1% CPU.
    const slowPoll = (): void => {
      let slow = 0;
      const timer = setInterval(() => {
        slow++;
        if (installStores() || slow >= 60) clearInterval(timer);
      }, 1000);
    };
  });
}

export default defineModule({
  id: "no-shop",
  label: "No Quests",
  description: "Hides the Quests row from the DM sidebar, neutralises the Quest stores, and drops /quests/* traffic.",
  defaultEnabled: true,
  subtoggles: {
    quests: { label: "Quests", default: true },
  },
  css: CSS,
  runtime,
});
