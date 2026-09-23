import { defineModule } from "@mdga/plugin-api";

const CSS = `
/* ─── Avatar decorations ───
   The <svg class="avatarDecorationContainer_<hash>"> sits next to every
   avatar (member list, chat header, profile popover, user panel) and paints
   a Nitro collectible frame around it. Hide the container so the avatar
   stays plain. */
[class*="avatarDecorationContainer_"] {
  display: none !important;
}
[class*="avatarDecoration_"] {
  display: none !important;
}

/* ─── Nameplates ───
   The animated background collectible behind a member's name in the
   member list. Wrapper class is container_<hash>, holding a video with
   class img_<hash>. Discord tags the parent childContainer with the
   modifier nameplated_<hash>; its padding is the row's normal spacing, so
   it stays. Hide the whole wrapper and the video itself. */
[class*="container_"][aria-hidden="true"]:has(> [class*="videoContainer_"] > video[src*="collectibles-shop"]) {
  display: none !important;
}
[class*="videoContainer_"] > video[src*="collectibles-shop"] {
  display: none !important;
}

/* ─── Profile effects ───
   The animated confetti/sparkle overlay Discord paints on top of profile
   popouts is rendered as an absolutely-positioned element whose class
   contains "profileEffect". Hiding the container takes its video/img/canvas
   children with it. */
[class*="profileEffects"],
[class*="profileEffect_"] {
  display: none !important;
}
`;

type Mdga = {
  onStores(names: string[], cb: (name: string, store: object) => void): void;
  onWebpackReady(cb: () => void): void;
  patch(target: object, method: string, phase: "after", handler: (args: unknown[]) => unknown): unknown;
};

// Data-level strip. The CSS above only hides the cosmetics; Discord still
// fetched and decoded every decoration APNG, nameplate video and profile
// effect behind it. Here the UI reads "no cosmetic" from the stores, so the
// elements are never rendered or downloaded. Read-side only: nothing is
// sent anywhere, the server still has the user's cosmetics as they are.
// The CSS stays as a fallback for render paths that read raw fields.
function runtime(): void {
  const mdga = (window as unknown as { mdga?: Mdga }).mdga;
  if (!mdga) return;

  // User.prototype getters: avatarDecoration (from avatarDecorationData)
  // and nameplate (from collectibles.nameplate). Seen on Stable 1.0.9259.
  const USER_STAMP = Symbol.for("mdga.classic-profile.user-patched");
  const nullGetters = (proto: Record<PropertyKey, unknown>, names: string[]): string[] => {
    const done: string[] = [];
    for (const name of names) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (!desc || !desc.configurable) continue;
      if (desc.get) {
        Object.defineProperty(proto, name, { ...desc, get: () => null });
      } else if (typeof desc.value === "function") {
        Object.defineProperty(proto, name, { ...desc, value: () => null });
      } else {
        continue;
      }
      done.push(name);
    }
    return done;
  };
  type UserStoreLike = {
    getCurrentUser?: () => object | undefined;
    addChangeListener?: (cb: () => void) => void;
    removeChangeListener?: (cb: () => void) => void;
  };
  const patchUserClass = (userStore: object): void => {
    const us = userStore as UserStoreLike;
    const me = typeof us.getCurrentUser === "function" ? us.getCurrentUser() : undefined;
    if (!me) {
      // UserStore can exist before login finishes; the User class is only
      // reachable through an instance, so retry on the store's next change.
      if (typeof us.addChangeListener !== "function") return;
      const retry = (): void => {
        if (!us.getCurrentUser?.()) return;
        us.removeChangeListener?.(retry);
        patchUserClass(userStore);
      };
      us.addChangeListener(retry);
      return;
    }
    const proto = Object.getPrototypeOf(me) as Record<PropertyKey, unknown>;
    if (proto[USER_STAMP]) return;
    const done = nullGetters(proto, ["avatarDecoration", "nameplate"]);
    try { Object.defineProperty(proto, USER_STAMP, { value: true }); } catch { /* frozen */ }
    console.log("[mdga] classic-profile: User." + (done.join(", User.") || "(nothing)") + " → null");
  };

  // Profiles: strip profileEffect, profileFrame and collectibles. A fresh
  // copy per call would change identity on every store read and make React
  // re-render forever, so each original maps to one cached copy.
  const stripped = new WeakMap<object, object>();
  const strip = (profile: unknown): unknown => {
    if (!profile || typeof profile !== "object") return profile;
    const p = profile as Record<string, unknown>;
    if (p.profileEffect == null && p.profileFrame == null && p.collectibles == null) return profile;
    let copy = stripped.get(p);
    if (!copy) {
      copy = Object.assign(Object.create(Object.getPrototypeOf(p)), p, {
        profileEffect: null,
        profileFrame: null,
        collectibles: null,
      }) as object;
      stripped.set(p, copy);
    }
    return copy;
  };
  const PROFILE_STAMP = Symbol.for("mdga.classic-profile.profiles-patched");
  const patchProfileStore = (store: object): void => {
    const proto = Object.getPrototypeOf(store) as Record<PropertyKey, unknown>;
    if (proto[PROFILE_STAMP]) return;
    const done: string[] = [];
    for (const name of ["getUserProfile", "getGuildMemberProfile"]) {
      if (typeof proto[name] !== "function") continue;
      // after-handlers get [result, ...args]; returning a value replaces it.
      mdga.patch(proto, name, "after", (args) => strip(args[0]));
      done.push(name);
    }
    try { Object.defineProperty(proto, PROFILE_STAMP, { value: true }); } catch { /* frozen */ }
    console.log("[mdga] classic-profile: stripped cosmetics from UserProfileStore." + done.join(", ."));
  };

  mdga.onWebpackReady(() => {
    mdga.onStores(["UserStore", "UserProfileStore"], (name, store) => {
      try {
        if (name === "UserStore") patchUserClass(store);
        else patchProfileStore(store);
      } catch (err) {
        console.error("[mdga] classic-profile: patching " + name + " failed:", err);
      }
    });
  });
}

export default defineModule({
  id: "classic-profile",
  label: "Classic profile",
  description:
    "Removes avatar decorations, profile effects, nameplates, and profile themes " +
    "so profiles look like they did before the cosmetics push.",
  defaultEnabled: true,
  subtoggles: {
    decorations: { label: "Avatar decorations", default: true },
    effects:     { label: "Profile effects",    default: true },
    nameplates:  { label: "Nameplates",         default: true },
    themes:      { label: "Profile themes",     default: true },
  },
  css: CSS,
  runtime,
});
