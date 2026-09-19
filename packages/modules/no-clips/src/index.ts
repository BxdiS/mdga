import { defineModule } from "@mdga/plugin-api";

// Sidebar entries in the User Settings modal use data-list-item-id whose
// suffix is stable across builds and locales even when the uid prefix
// changes. The Clips row lives under user-settings-cog with suffix ___clips.
// Hiding the whole <li>/<div> via :has() keeps hover/focus/tab order gone.
// Popover menu row rendered by webpack factory 588158 (case eI.CLIPS).
// Discord's MenuItem does not pipe its `id` prop to the DOM, and the class
// suffix (menuItem_<hash>) shifts every build, so we anchor to the SVG
// path of the film-strip icon. The `d=` attribute is stable across builds
// as long as the icon is unchanged, and is locale-agnostic; if Discord
// redesigns the icon this rule silently no-ops (the store + XHR guards
// below still kill the feature).
const CLIP_ICON_PATH_PREFIX = "M15.74 5.74";
const CSS = `
li[class^="menuItem_"]:has(svg path[d^="${CLIP_ICON_PATH_PREFIX}"]) { display: none !important; }
[class^="menuItem_"][role="menuitem"]:has(svg path[d^="${CLIP_ICON_PATH_PREFIX}"]) { display: none !important; }
[class^="item_"]:has(svg path[d^="${CLIP_ICON_PATH_PREFIX}"]) { display: none !important; }
/* User Settings sidebar tab, if this build exposes one with a stable
   data-list-item-id suffix. Harmless if absent. */
li[role="listitem"]:has(a[data-list-item-id$="___clips"]) { display: none !important; }
[role="tab"][data-list-item-id$="___clips"] { display: none !important; }
/* Streamer/voice overlay clip button — anchored to the same icon path
   rather than the localized aria-label. */
button:has(svg path[d^="${CLIP_ICON_PATH_PREFIX}"]) { display: none !important; }
/* Drop the <divider_*> or role=separator that immediately follows a menu
   item / entry we hid. In the profile popover this collapses the leftover
   hairline where "Видеонарезки" used to be; on the Keybinds page it
   collapses the horizontal rule after Save Clip. Anchored to real class
   substrings so we never touch an unrelated sibling. */
li[class^="menuItem_"]:has(svg path[d^="${CLIP_ICON_PATH_PREFIX}"]) + [role="separator"],
li[class^="menuItem_"]:has(svg path[d^="${CLIP_ICON_PATH_PREFIX}"]) + [class*="menuSeparator_"],
li[class^="menuItem_"]:has(svg path[d^="${CLIP_ICON_PATH_PREFIX}"]) + [class*="separator_" i] { display: none !important; }
[data-mdga-no-clips-hidden] + [class*="divider_"],
[data-mdga-no-clips-hidden] + [role="separator"],
[data-mdga-no-clips-hidden] + [class*="separator_" i] { display: none !important; }
`;

// Trust & Safety fence: we only patch client read-side state and drop our
// own outgoing HTTP before it goes on the wire. We do not modify request
// payloads, do not touch identify/gateway, do not fake dispatcher actions
// the server would look for. A user who never opens the Clips UI never
// sends these requests either — that's what the server sees.
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
  const findStore = mdga["findStore"] as (name: string) => Record<string, unknown> | null;

  // Level 3: block outbound HTTP for the Clips REST surface at the XHR
  // layer (same reason as no-shop: Discord's REST facade is only one of
  // the call sites; the fetchers use a lower-level HTTP module).
  const REST_STAMP = "__mdga_no_clips_xhr__";
  const installRest = (): boolean => {
    const XHR = (window as unknown as { XMLHttpRequest?: {
      prototype: XMLHttpRequest & Record<string, unknown>;
    } }).XMLHttpRequest;
    if (!XHR || !XHR.prototype) return false;
    const proto = XHR.prototype as XMLHttpRequest & Record<string, unknown>;
    if (proto[REST_STAMP]) return true;
    // Cover both /clips and /users/@me/clips shapes, plus any /clip- prefixed
    // upload/heartbeat endpoints Discord may add. Anchored to /api/vN/ so we
    // never touch static CDN paths that happen to contain "clip".
    const isClip = (u: unknown): boolean =>
      typeof u === "string" &&
      /\/api\/v\d+\/(clips|users\/[^/]+\/clips|clip-)/i.test(u);
    patches.push(
      patch(proto, "open", "before", (args, _original, self) => {
        (self as Record<string, unknown>).__mdga_clips_url = args[1];
        return undefined;
      }),
    );
    patches.push(
      patch(proto, "send", "instead", (args, original, self) => {
        const url = (self as Record<string, unknown>).__mdga_clips_url;
        if (isClip(url)) {
          console.log("[mdga] no-clips: blocked XHR " + String(url));
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
    console.log("[mdga] no-clips: guarded XMLHttpRequest for /clips/*");
    return true;
  };

  const STORE_STAMP = Symbol.for("mdga.no-clips.stores-patched");
  const installStores = (): boolean => {
    let touched = false;

    // Discord ships several clip-adjacent stores across builds. Names we've
    // seen or expect: ClipsStore, ClipsRecordingStore, ClipsSettingsStore.
    // Patch whatever is present; skip the rest.
    const storeNames = ["ClipsStore", "ClipsRecordingStore", "ClipsSettingsStore"];
    // Broad neutralisation table — each entry is patched only if the method
    // exists, so an unknown build won't blow up.
    const boolFalse = ["isRecording", "isEnabled", "isClipping", "isSaving", "isUploading"];
    const nullish = [
      "getCurrentClip", "getClip", "getClipById", "getActiveClip",
      "getRecordingState", "getUploadState", "getLastClip",
    ];
    const emptyArray = ["getClips", "getRecentClips", "getPendingUploads"];

    for (const name of storeNames) {
      const store = findStore(name) as Record<string, unknown> | null;
      if (!store) continue;
      if ((store as unknown as Record<symbol, unknown>)[STORE_STAMP]) continue;
      const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
      for (const m of boolFalse) {
        if (typeof proto[m] === "function") patches.push(patch(proto, m, "instead", () => false));
      }
      for (const m of nullish) {
        if (typeof proto[m] === "function") patches.push(patch(proto, m, "instead", () => null));
      }
      for (const m of emptyArray) {
        if (typeof proto[m] === "function") patches.push(patch(proto, m, "instead", () => []));
      }
      try {
        Object.defineProperty(store, STORE_STAMP, { value: true, enumerable: false });
      } catch { (store as unknown as Record<symbol, unknown>)[STORE_STAMP] = true; }
      console.log("[mdga] no-clips: neutralised " + name);
      touched = true;
    }
    return touched;
  };

  // Level 4: hide Clips keybind rows on the Keybinds settings page. The
  // outer wrapper class is entry_<hash> — generic across every keybind —
  // and Discord exposes no clip-specific attribute on the row. The stable
  // anchor is the description sibling (class description_<hash>), whose
  // text starts with "Clips …" in English and contains "клип" in Russian.
  // We match on either. This is pure DOM: no network, no dispatcher, no
  // reads of user state — just display:none on our hidden entries.
  const HIDE_ATTR = "data-mdga-no-clips-hidden";
  const CLIP_DESC_RE = /clip|клип/i;
  const hideClipKeybindRows = (): void => {
    // class^="entry_" is safe (entry_<hash> is the only class on the
    // wrapper) but description_<hash> ships as the SECOND class on its
    // element (after a typography helper like text-xs/normal_<hash>), so
    // ^= misses it — use *= to match anywhere in the class attribute.
    const entries = document.querySelectorAll<HTMLElement>(
      "div[class*=\"entry_\"]:not([" + HIDE_ATTR + "])",
    );
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const desc = entry.querySelector<HTMLElement>("div[class*=\"description_\"]");
      if (!desc) continue;
      const text = desc.textContent || "";
      if (CLIP_DESC_RE.test(text)) {
        entry.style.display = "none";
        entry.setAttribute(HIDE_ATTR, "1");
        // Adjacent <divider_*> is dropped via a CSS rule keyed on this
        // attribute (see CSS above). Doing that in JS was fragile because
        // classless React insertion points confused the sibling probe.
      }
    }
    // Dropdown options in the Keybind Action combobox — these render as
    // <div role="option"> with the action label as their text and no
    // description sibling, so the entry loop above misses them. Match
    // on the option's own textContent instead.
    const options = document.querySelectorAll<HTMLElement>(
      "div[role=\"option\"]:not([" + HIDE_ATTR + "])",
    );
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const text = opt.textContent || "";
      if (CLIP_DESC_RE.test(text)) {
        opt.style.display = "none";
        opt.setAttribute(HIDE_ATTR, "1");
      }
    }
  };
  let rafPending = false;
  const scheduleHide = (): void => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      try { hideClipKeybindRows(); } catch {}
    });
  };
  // document.body doesn't exist yet when the preload runtime runs (we hook
  // in before Discord's own DOM boots). Wait for it before attaching, or
  // MutationObserver.observe throws and the whole runtime dies mid-file —
  // taking the XHR guard and store patches down with it.
  const attachObserver = (): void => {
    if (!document.body) {
      setTimeout(attachObserver, 25);
      return;
    }
    const observer = new MutationObserver(scheduleHide);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleHide();
  };
  attachObserver();

  const onWebpackReady = mdga["onWebpackReady"] as (cb: () => void) => void;
  onWebpackReady(() => {
    let restDone = installRest();
    let storesDone = installStores();
    let attempts = 0;
    if (restDone && storesDone) return;
    const poll = setInterval(() => {
      attempts++;
      if (!restDone) restDone = installRest();
      if (!storesDone) storesDone = installStores();
      if ((restDone && storesDone) || attempts > 200) clearInterval(poll);
    }, 25);
  });
}

export default defineModule({
  id: "no-clips",
  label: "No Clips",
  description: "Hides the Clips settings tab, neutralises the Clips stores, and blocks /clips/* traffic.",
  defaultEnabled: true,
  subtoggles: {
    settingsTab: { label: "Clips settings tab", default: true },
    overlayButton: { label: "Overlay/voice clip button", default: true },
    network: { label: "Block clips network traffic", default: true },
  },
  css: CSS,
  runtime,
});
