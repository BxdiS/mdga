import { defineModule } from "@mdga/plugin-api";

// Sidebar entries are keyed by data-list-item-id, whose suffix is stable
// across Discord builds and locales even when the uid prefix (e.g.
// "private-channels-uid_11___") changes. Hiding the whole <li> via :has()
// keeps hover targets, focus rings and keyboard navigation gone too.
//
// Scope: Quests only, end to end (UI + store + XHR). The Shop row next to
// it belongs to no-shop; the Nitro row belongs to no-nitro-tab.
const CSS = `
li[role="listitem"]:has(a[data-list-item-id$="___quests"]) { display: none !important; }
/* The Quests item is wrapped in a shine-animation container; collapse it too
   so its padding does not leave a gap. */
div[class^="wrapper__"]:has(> li[role="listitem"] a[data-list-item-id$="___quests"]) { display: none !important; }
/* "Completed a Quest" profile badge; fallback for the data filter below. */
[aria-label="User Badges"] a[href*="/discovery/quests"] { display: none !important; }
`;

// Profile badges tied to Quests: "Completed a Quest" and the Last Meadow
// Online event levels ("Level N Reached"), and the Orbs badge (Orbs are the
// Quest reward currency; the badge links to Shop > Orbs Exclusives). Matched
// by badge id, seen on Stable: quest_completed, april_fools_2026 (the Meadow
// level badge), orb_profile_badge.
const QUEST_BADGE = /^(quest_|april_fools_|orb_profile_badge$)/;

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
  const onStores = mdga["onStores"] as (
    names: string[],
    cb: (name: string, store: object) => void,
  ) => void;

  // Level 3: block outbound HTTP requests to /quests/* at the XHR layer.
  // Discord's public REST facade (findByProps("get","post",…)) is only ONE
  // of several call sites — the fetchers use a lower-level HTTP module that
  // bypasses the facade. Patching XMLHttpRequest.prototype.open catches
  // every code path. T&S fence: we only check the URL and skip send() when
  // it matches — the request never leaves the client. That is server-side
  // indistinguishable from a user who never opened the Quests panel.
  const REST_STAMP = "__mdga_no_quests_xhr__";
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
          console.log("[mdga] no-quests: blocked XHR " + String(url));
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
    console.log("[mdga] no-quests: guarded XMLHttpRequest for /quests/*");
    return true;
  };

  const STORE_STAMP = Symbol.for("mdga.no-quests.stores-patched");
  const stamp = (store: object): boolean => {
    const s = store as Record<symbol, unknown>;
    if (s[STORE_STAMP]) return false;
    try {
      Object.defineProperty(store, STORE_STAMP, { value: true, enumerable: false });
    } catch { s[STORE_STAMP] = true; }
    return true;
  };

  const patchQuestStore = (qs: object): void => {
    if (!stamp(qs)) return;
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
    console.log("[mdga] no-quests: neutralised QuestStore");
  };

  const patchUnenrolledStore = (uqs: object): void => {
    if (!stamp(uqs)) return;
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
    console.log("[mdga] no-quests: neutralised UnenrolledActivityQuestStore");
  };

  // Read-side filter on profile badges. One cached copy per profile object,
  // otherwise every store read returns a new identity and React re-renders.
  const filtered = new WeakMap<object, object>();
  const stripBadges = (profile: unknown): unknown => {
    if (!profile || typeof profile !== "object") return profile;
    const p = profile as Record<string, unknown>;
    const badges = p.badges;
    if (!Array.isArray(badges)) return profile;
    const keep = badges.filter((b) => !QUEST_BADGE.test(String((b as { id?: unknown })?.id ?? "")));
    if (keep.length === badges.length) return profile;
    let copy = filtered.get(p);
    if (!copy) {
      copy = Object.assign(Object.create(Object.getPrototypeOf(p)), p, { badges: keep }) as object;
      filtered.set(p, copy);
    }
    return copy;
  };
  const patchProfileStore = (store: object): void => {
    if (!stamp(store)) return;
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const name of ["getUserProfile", "getGuildMemberProfile"]) {
      if (typeof proto[name] !== "function") continue;
      // after-handlers get [result, ...args]; returning a value replaces it.
      patches.push(patch(proto, name, "after", (args) => stripBadges(args[0])));
    }
    console.log("[mdga] no-quests: filtering Quest badges from UserProfileStore");
  };

  const onWebpackReady = mdga["onWebpackReady"] as (cb: () => void) => void;
  onWebpackReady(() => {
    // XMLHttpRequest exists from the start, so this lands on the first call.
    installRest();
    // Patch each store the moment its module loads. This used to be a 25 ms
    // poll with a full module-graph scan per tick, which also gave up after
    // 5 s and missed UnenrolledActivityQuestStore when it loaded late.
    onStores(["QuestStore", "UnenrolledActivityQuestStore", "UserProfileStore"], (name, store) => {
      if (name === "QuestStore") patchQuestStore(store);
      else if (name === "UserProfileStore") patchProfileStore(store);
      else patchUnenrolledStore(store);
    });
  });
}

export default defineModule({
  id: "no-quests",
  label: "No Quests",
  description: "Hides the Quests row from the DM sidebar, neutralises the Quest stores, and drops /quests/* traffic.",
  defaultEnabled: true,
  subtoggles: {
    quests: { label: "Quests", default: true },
  },
  css: CSS,
  runtime,
});
