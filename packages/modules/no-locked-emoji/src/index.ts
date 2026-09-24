import { defineModule } from "@mdga/plugin-api";

type Obj = Record<PropertyKey, unknown>;
type Fn = (...args: unknown[]) => unknown;
type Handler = (args: unknown[], original: Fn, self: unknown) => unknown;
type Mdga = {
  onWebpackReady(cb: () => void): void;
  onStores(names: string[], cb: (name: string, store: object) => void): void;
  findByProps(...props: string[]): unknown;
  getObservedExports(): Record<string, unknown>;
  patch(target: object, method: string, phase: "instead" | "after", handler: Handler): unknown;
};

const read = (obj: unknown, key: PropertyKey): unknown => {
  try { return (obj as Obj)[key]; } catch { return undefined; }
};
const call = (obj: unknown, key: string, ...args: unknown[]): unknown => {
  const fn = read(obj, key);
  return typeof fn === "function" ? (fn as Fn).apply(obj, args) : undefined;
};
// Marks a patched object; false when it was marked already.
const stampOnce = (target: Obj, stamp: symbol): boolean => {
  if (target[stamp]) return false;
  try { Object.defineProperty(target, stamp, { value: true }); } catch { /* frozen */ }
  return true;
};

// When the sticker picker has nothing to list, Discord fills it with a Nitro
// ad: "Choose from 300 stickers with Nitro", a row of sample stickers and a
// Subscribe button. Without Nitro a DM gets there once the unsendable server
// stickers are gone and Discord's own packs are not loaded (seen on Stable
// after switching accounts: getPremiumPacks() stayed empty until a restart).
// The ad goes and the panel stays empty under the search box. Matched by the
// panel id and the sample row, which only this empty state has.
const CSS = `
#sticker-picker-tab-panel [class*="emptyState_"]:has([class*="stickersRow_"]) {
  display: none !important;
}
`;

// Trust & Safety fence: read-side only. Discord is still asked, and still
// answers, whether an emoji or sticker can be sent here; the patches only
// take the ones it answers "no" for out of the lists the pickers, their
// search and the chat suggestions show: the ones that need Nitro and the
// ones a server lost with its boosts. Clicking, sending and reacting keep
// Discord's own checks, and nothing is sent anywhere. Everything Discord
// lets you send stays, with or without Nitro.
function runtime(): void {
  const mdga = (window as unknown as { mdga?: Mdga }).mdga;
  if (!mdga) return;

  const stores: Partial<Record<string, object>> = {};

  // ─── Emoji ───
  // EmojiUtils (seen on Stable 1.0.9259) is a plain object. Its
  // getEmojiUnavailableReason says why an emoji can't be used in a channel
  // (EmojiDisabledReasons: DISALLOW_EXTERNAL, GUILD_SUBSCRIPTION_UNAVAILABLE,
  // PREMIUM_LOCKED, ...), and isEmojiFiltered, isEmojiPremiumLocked,
  // isEmojiDisabled and isEmojiCategoryNitroLocked sort those reasons into
  // sets. The methods call the reason function directly rather than through
  // the object, so each one this module needs is patched on its own.
  //
  // An emoji stays only when Discord has no reason against it. Without Nitro
  // that drops PREMIUM_LOCKED (another server's emoji, animated ones) and,
  // with or without Nitro, GUILD_SUBSCRIPTION_UNAVAILABLE: emoji a server
  // lost with its boosts, which the picker shows locked to everyone.
  //
  // The reason itself is never changed. The picker's server sections drop an
  // emoji only for DISALLOW_EXTERNAL and DISALLOW_CUSTOM, and a click on an
  // emoji with one of those reasons inserts it into the message, because
  // Discord never expects one to be on screen. Reporting a locked emoji as
  // DISALLOW_EXTERNAL would hide it, but a click on any locked emoji left
  // visible (the server's top emoji row, say) would then put it into the
  // message instead of asking for Nitro.
  const EMOJI_STAMP = Symbol.for("mdga.no-locked-emoji.emoji-patched");
  const CONTEXT_STAMP = Symbol.for("mdga.no-locked-emoji.context-patched");
  const NOTHING = Symbol("nothing");
  let seenEmoji: unknown = NOTHING;
  let seenReason: unknown;

  // The emoji picker builds a section per server from
  // getDisambiguatedEmojiContext(guildId).getGroupedCustomEmoji(), a Map of
  // guild id to emoji list, and keeps an emoji when
  //   !DROPPED.includes(EmojiUtils.getEmojiUnavailableReason({ emoji, channel, intention }))
  // Each list gets its own filter(): it runs Discord's callback as usual and
  // also drops the element when the callback's reason check for it came back
  // with any reason. A callback that never asks for a reason filters exactly
  // as before.
  function filterWithoutUnusable(this: unknown[], cb: Fn, thisArg?: unknown): unknown[] {
    return Array.prototype.filter.call(this, (value: unknown, index: number, array: unknown[]) => {
      seenEmoji = NOTHING;
      const keep = cb.call(thisArg, value, index, array);
      return Boolean(keep) && !(seenEmoji === value && seenReason != null);
    });
  }
  const decorate = (list: unknown): void => {
    if (!Array.isArray(list) || Object.prototype.hasOwnProperty.call(list, "filter")) return;
    try {
      Object.defineProperty(list, "filter", { value: filterWithoutUnusable, configurable: true, writable: true });
    } catch { /* frozen: this server keeps Discord's own filter */ }
  };
  const decorateGrouped = (grouped: unknown): void => {
    if (grouped instanceof Map) {
      for (const list of grouped.values()) decorate(list);
    } else if (grouped && typeof grouped === "object") {
      for (const key in grouped) decorate(read(grouped, key));
    }
  };
  // Contexts are created per guild on demand, so the method is patched the
  // first time Discord hands one out.
  const patchContext = (context: unknown): void => {
    if (!context || typeof context !== "object") return;
    const owner = (Object.prototype.hasOwnProperty.call(context, "getGroupedCustomEmoji")
      ? context
      : Object.getPrototypeOf(context)) as Obj | null;
    if (!owner || typeof owner.getGroupedCustomEmoji !== "function" || !stampOnce(owner, CONTEXT_STAMP)) return;
    mdga.patch(owner, "getGroupedCustomEmoji", "after", (args) => {
      decorateGrouped(args[0]);
      return undefined;
    });
  };

  const patchEmoji = (store: object): void => {
    const proto = Object.getPrototypeOf(store) as Obj;
    if (!stampOnce(proto, EMOJI_STAMP)) return;
    const done: string[] = [];

    // Picker search and the ":" suggestions: searchWithoutFetchingLatest
    // returns { unlocked, locked }, and locked is exactly the PREMIUM_LOCKED
    // matches, listed with a lock under a Get Nitro row.
    if (typeof proto.searchWithoutFetchingLatest === "function") {
      mdga.patch(proto, "searchWithoutFetchingLatest", "after", (args) => {
        const result = args[0] as { locked?: unknown } | null | undefined;
        if (!result || !Array.isArray(result.locked) || result.locked.length === 0) return undefined;
        return { ...result, locked: [] };
      });
      done.push("search");
    }

    // EmojiUtils loads before EmojiStore: the store's module imports it.
    const utils = mdga.findByProps("getEmojiUnavailableReason", "isEmojiFiltered", "isEmojiPremiumLocked") as Obj | null;
    const reasonOf = utils ? read(utils, "getEmojiUnavailableReason") : undefined;
    if (!utils || typeof reasonOf !== "function") {
      console.log("[mdga] no-locked-emoji: EmojiUtils not found, filtering emoji search only");
      return;
    }
    const reason = (options: unknown): unknown => (reasonOf as Fn).call(utils, options);

    // Server sections: record every reason Discord computes, for the
    // filter() above to read.
    mdga.patch(utils, "getEmojiUnavailableReason", "after", (args) => {
      seenEmoji = read(args[1], "emoji");
      seenReason = args[0];
      return undefined;
    });
    if (typeof proto.getDisambiguatedEmojiContext === "function") {
      mdga.patch(proto, "getDisambiguatedEmojiContext", "after", (args) => {
        patchContext(args[0]);
        return undefined;
      });
      done.push("server sections");
    }

    // The server list on the left of the picker (useEmojiCategories) is built
    // separately, from getEmojiUnavailableReasons({ categoryEmojis, ... }):
    // a server gets an entry when emojisUnfiltered is not empty, and a lock
    // when emojiNitroLocked is set. Keeping only the emoji Discord has no
    // reason against there matches it to the sections above.
    if (typeof utils.getEmojiUnavailableReasons === "function") {
      mdga.patch(utils, "getEmojiUnavailableReasons", "after", (args) => {
        const result = args[0] as Obj | null | undefined;
        const options = args[1] as Obj | null | undefined;
        const listed = result ? result.emojisUnfiltered : undefined;
        if (!result || !options || !Array.isArray(listed)) return undefined;
        const usable = listed.filter((emoji) => reason({
          emoji,
          channel: options.channel,
          guildId: options.guildId,
          intention: options.intention,
          bypassPremiumEmojiEntitlement: options.bypassPremiumEmojiEntitlement,
        }) == null);
        return { ...result, emojisUnfiltered: usable, emojisPremiumLockedCount: 0, emojiNitroLocked: false };
      });
      done.push("server list");
    }

    // Frequently used and Favorites keep !isEmojiFiltered(...). Filtered is
    // Discord's "not shown here" (external emoji where they are not allowed,
    // emoji a server lost with its boosts); every other emoji with a reason
    // against it joins them.
    if (typeof utils.isEmojiFiltered === "function") {
      mdga.patch(utils, "isEmojiFiltered", "instead", (args, original, self) =>
        Boolean(original.apply(self, args)) || reason(args[0]) != null);
      done.push("frequently used, favorites");
    }

    // The top emoji row of the current server (getTopEmoji and
    // getNewlyAddedEmoji, not used for reactions) is not filtered at all, so
    // its animated emoji show locked without Nitro. The store methods only
    // get a guild id, so the check is made as for chat. The row lists the
    // server's own emoji, which lock only for being animated or lost with
    // the boosts; the one picker that allows animated ones anyway, community
    // content (COMMUNITY_CONTENT), loses them from this row too.
    const intentions = mdga.findByProps("GUILD_ROLE_BENEFIT_EMOJI", "REACTION") as Obj | null;
    const CHAT = intentions ? intentions.CHAT : undefined;
    const topCache = new WeakMap<unknown[], unknown[]>();
    const withoutUnusableTop = (list: unknown, guildId: unknown): unknown => {
      if (!Array.isArray(list) || list.length === 0) return undefined;
      const kept = list.filter((emoji) => reason({ emoji, guildId, intention: CHAT }) == null);
      if (kept.length === list.length) return undefined;
      // Same content, same array: the picker memoizes on it.
      const cached = topCache.get(list);
      if (cached && cached.length === kept.length && cached.every((e, i) => e === kept[i])) return cached;
      topCache.set(list, kept);
      return kept;
    };
    if (CHAT !== undefined) {
      for (const name of ["getTopEmoji", "getNewlyAddedEmoji"]) {
        if (typeof proto[name] !== "function") continue;
        mdga.patch(proto, name, "after", (args) => withoutUnusableTop(args[0], args[1]));
      }
      done.push("top emoji");
    }

    console.log("[mdga] no-locked-emoji: hiding locked emoji in " + (done.join(", ") || "(nothing)"));
  };

  // ─── Stickers ───
  // getStickerSendability(sticker, user, channel) answers SENDABLE,
  // SENDABLE_WITH_PREMIUM, NONSENDABLE or SENDABLE_WITH_BOOSTED_GUILD. It is a
  // plain webpack export, which cannot be replaced, and the sticker picker
  // does not filter on it anyway: it shows every sticker it is given and
  // greys out the ones that can't be sent. So server stickers that are not
  // SENDABLE in the open channel are taken out of the data the picker is
  // built from. Stickers from Discord's own packs are left to Discord.
  type Sendability = { check: Fn; sendable: unknown };
  let sendability: Sendability | null = null;
  let lookedUpAt = 0;
  let reportedMissing = false;
  // Found by behaviour: the module that exports the StickerSendability enum
  // (seen on Stable) also exports the function, the only one there that
  // asks canUseCustomStickersEverywhere. Looked up when a sticker list is
  // first read with a channel open, at most every 5 s until found.
  const lookUpSendability = (): Sendability | null => {
    const levels = mdga.findByProps("SENDABLE_WITH_PREMIUM", "NONSENDABLE") as Obj | null;
    if (!levels) return null;
    const observed = mdga.getObservedExports();
    for (const id in observed) {
      const exports = observed[id];
      if (!exports || typeof exports !== "object") continue;
      let exportsLevels = false;
      for (const key in exports) if (read(exports, key) === levels) { exportsLevels = true; break; }
      if (!exportsLevels) continue;
      for (const key in exports) {
        const fn = read(exports, key);
        if (typeof fn !== "function" || fn.length !== 3) continue;
        let source = "";
        try { source = Function.prototype.toString.call(fn); } catch { continue; }
        if (source.includes("canUseCustomStickersEverywhere")) return { check: fn as Fn, sendable: levels.SENDABLE };
      }
    }
    return null;
  };
  const findSendability = (): Sendability | null => {
    if (sendability) return sendability;
    const now = Date.now();
    if (now - lookedUpAt < 5000) return null;
    lookedUpAt = now;
    sendability = lookUpSendability();
    if (sendability) {
      console.log("[mdga] no-locked-emoji: found getStickerSendability");
    } else if (!reportedMissing) {
      reportedMissing = true;
      console.log("[mdga] no-locked-emoji: getStickerSendability not found yet, stickers stay as they are");
    }
    return sendability;
  };

  // The channel the picker is for: the selected one, or the one Discord
  // passed along. Key changes with the channel and the user's Nitro tier.
  type Context = { user: unknown; channel: unknown; key: string; lock: Sendability };
  const context = (channel?: unknown): Context | null => {
    const user = call(stores.UserStore, "getCurrentUser");
    let where = channel;
    if (where == null) {
      const id = call(stores.SelectedChannelStore, "getChannelId");
      where = id != null ? call(stores.ChannelStore, "getChannel", id) : undefined;
    }
    if (user == null || where == null) return null;
    const lock = findSendability();
    if (!lock) return null;
    return { user, channel: where, key: String(read(where, "id")) + ":" + String(read(user, "premiumType")), lock };
  };
  // Server stickers only: they carry a guild id and no pack. Stickers from
  // Discord's packs never go through the check; for them Discord answers
  // NONSENDABLE until the pack has loaded, which would hide them for a while.
  const isServerSticker = (sticker: unknown): boolean => {
    const guildId = read(sticker, "guild_id");
    return typeof guildId === "string" && guildId !== "" && read(sticker, "pack_id") == null;
  };
  const isUnsendable = (sticker: unknown, ctx: Context): boolean =>
    sticker != null && isServerSticker(sticker) && ctx.lock.check(sticker, ctx.user, ctx.channel) !== ctx.lock.sendable;

  // Stable identity per (list, channel, tier): the picker memoizes on these.
  // The cache also keeps what the list held, so a list Discord changes in
  // place (frequently used after sending a sticker) is filtered again
  // instead of answered from an old copy.
  const sameItems = (a: readonly unknown[], b: readonly unknown[]): boolean =>
    a.length === b.length && a.every((item, i) => item === b[i]);
  const listCache = new WeakMap<object, { key: string; items: unknown[]; value: unknown[] }>();
  const withoutUnsendableList = (list: unknown[], ctx: Context): unknown[] => {
    const hit = listCache.get(list);
    if (hit && hit.key === ctx.key && sameItems(hit.items, list)) return hit.value;
    const kept = list.filter((sticker) => !isUnsendable(sticker, ctx));
    const value = kept.length === list.length ? list : kept;
    listCache.set(list, { key: ctx.key, items: list.slice(), value });
    return value;
  };

  // Server categories come from StickersStore.getAllGuildStickers(), a Map of
  // guild id to stickers. Every guild keeps its entry, emptied if need be:
  // the category list skips empty ones, and a missing entry could read as
  // "not loaded yet". The filtered Map is reused while its entries stay the
  // same, checked on every read for the same reason as above.
  const mapCache = new WeakMap<object, { key: string; entries: Array<[unknown, unknown]>; value: Map<unknown, unknown> }>();
  const withoutUnsendableStickers = (result: unknown): unknown => {
    ensureQueryPatched();
    if (!(result instanceof Map) || result.size === 0) return undefined;
    const ctx = context();
    if (!ctx) return undefined;
    let changed = false;
    const entries: Array<[unknown, unknown]> = [];
    for (const [guildId, list] of result) {
      const kept = Array.isArray(list) ? withoutUnsendableList(list, ctx) : list;
      if (kept !== list) changed = true;
      entries.push([guildId, kept]);
    }
    if (!changed) return undefined;
    const hit = mapCache.get(result);
    if (hit && hit.key === ctx.key && hit.entries.length === entries.length &&
        hit.entries.every(([id, kept], i) => entries[i]?.[0] === id && entries[i]?.[1] === kept)) return hit.value;
    const value = new Map(entries);
    mapCache.set(result, { key: ctx.key, entries, value });
    return value;
  };
  const STICKERS_STAMP = Symbol.for("mdga.no-locked-emoji.stickers-patched");
  const patchGuildStickers = (store: object): void => {
    const proto = Object.getPrototypeOf(store) as Obj;
    if (!stampOnce(proto, STICKERS_STAMP)) return;
    if (typeof proto.getAllGuildStickers !== "function") {
      console.log("[mdga] no-locked-emoji: StickersStore.getAllGuildStickers not found, server categories keep locked stickers");
      return;
    }
    mdga.patch(proto, "getAllGuildStickers", "after", (args) => withoutUnsendableStickers(args[0]));
    console.log("[mdga] no-locked-emoji: hiding locked stickers in server categories");
  };

  // Frequently used: StickersPersistedStore.stickerFrecencyWithoutFetchingLatest
  // is a getter for a frecency object; the picker reads its .frequently and
  // only drops stickers that can't be sent at all. The getter hands out a
  // proxy whose .frequently has the unsendable ones removed; everything else
  // (getScore, used by sticker search) goes to the real object.
  const frecencyProxies = new WeakMap<object, object>();
  const wrapFrecency = (frecency: unknown): unknown => {
    if (!frecency || typeof frecency !== "object") return frecency;
    let proxy = frecencyProxies.get(frecency);
    if (!proxy) {
      const bound = new Map<Fn, Fn>();
      proxy = new Proxy(frecency, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          const own = Object.getOwnPropertyDescriptor(target, prop);
          if (own && !own.configurable && own.writable === false) return value;
          if (prop === "frequently" && Array.isArray(value)) {
            const ctx = context();
            return ctx ? withoutUnsendableList(value, ctx) : value;
          }
          if (typeof value !== "function") return value;
          let fn = bound.get(value as Fn);
          if (!fn) {
            fn = (value as Fn).bind(target);
            bound.set(value as Fn, fn);
          }
          return fn;
        },
      });
      frecencyProxies.set(frecency, proxy);
    }
    return proxy;
  };
  const FRECENCY_STAMP = Symbol.for("mdga.no-locked-emoji.frecency-patched");
  const patchStickerFrecency = (store: object): void => {
    const proto = Object.getPrototypeOf(store) as Obj;
    const name = "stickerFrecencyWithoutFetchingLatest";
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    const get = desc?.get;
    if (!stampOnce(proto, FRECENCY_STAMP)) return;
    if (!desc || typeof get !== "function" || !desc.configurable) {
      console.log("[mdga] no-locked-emoji: " + name + " getter not found, frequently used keeps locked stickers");
      return;
    }
    Object.defineProperty(proto, name, {
      ...desc,
      get(this: unknown) { return wrapFrecency(get.call(this)); },
    });
    console.log("[mdga] no-locked-emoji: hiding locked stickers in frequently used");
  };

  // Sticker search: queryStickers(queries, fuzzy, [channel, keep]) on the
  // autocomplete utils object. The chat suggestions pass a keep() that only
  // lets sendable stickers through; the picker's search box passes none and
  // lists the SENDABLE_WITH_PREMIUM matches under a Nitro heading. The
  // results lose every server sticker that is not SENDABLE. Patched lazily:
  // the object loads after the sticker stores, and the picker reads
  // getAllGuildStickers() before anyone can search.
  let queryPatched = false;
  let queryLookedUpAt = 0;
  const ensureQueryPatched = (): void => {
    if (queryPatched) return;
    const now = Date.now();
    if (now - queryLookedUpAt < 5000) return;
    queryLookedUpAt = now;
    const utils = mdga.findByProps("queryStickers", "queryEmojiResults") as Obj | null;
    if (!utils) return;
    queryPatched = true;
    const desc = Object.getOwnPropertyDescriptor(utils, "queryStickers");
    if (!desc || typeof desc.value !== "function" || desc.writable === false) {
      console.log("[mdga] no-locked-emoji: queryStickers is read-only, sticker search keeps locked stickers");
      return;
    }
    mdga.patch(utils, "queryStickers", "after", (args) => {
      const results = args[0];
      if (!Array.isArray(results) || results.length === 0) return undefined;
      const pair = args[3];
      const ctx = context(Array.isArray(pair) ? pair[0] : undefined);
      if (!ctx) return undefined;
      const kept = results.filter((r) => !isUnsendable(read(r, "sticker"), ctx));
      return kept.length === results.length ? undefined : kept;
    });
    console.log("[mdga] no-locked-emoji: hiding locked stickers in sticker search");
  };

  mdga.onWebpackReady(() => {
    mdga.onStores(
      ["EmojiStore", "StickersStore", "StickersPersistedStore", "UserStore", "ChannelStore", "SelectedChannelStore"],
      (name, store) => {
        stores[name] = store;
        try {
          if (name === "EmojiStore") patchEmoji(store);
          else if (name === "StickersStore") patchGuildStickers(store);
          else if (name === "StickersPersistedStore") patchStickerFrecency(store);
        } catch (err) {
          console.error("[mdga] no-locked-emoji: patching " + name + " failed:", err);
        }
      },
    );
  });
}

export default defineModule({
  id: "no-locked-emoji",
  label: "No locked emoji and stickers",
  description:
    "Hides the emoji and stickers you can't send from the pickers, their search and the chat suggestions " +
    "(the ones that need Nitro and the ones a server lost with its boosts), and with them the Nitro ads " +
    "the pickers show in their place. Everything you can send stays.",
  defaultEnabled: true,
  css: CSS,
  runtime,
});
