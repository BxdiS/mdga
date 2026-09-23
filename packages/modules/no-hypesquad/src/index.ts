import { defineModule } from "@mdga/plugin-api";

type Mdga = {
  onStores(names: string[], cb: (name: string, store: object) => void): void;
  onWebpackReady(cb: () => void): void;
  patch(target: object, method: string, phase: "after", handler: (args: unknown[]) => unknown): unknown;
};

// HypeSquad profile badges: the three houses (hypesquad_house_1/2/3 for
// Bravery, Brilliance, Balance, seen on Stable) and the HypeSquad Events
// badge. Read-side filter on the profile store; nothing is sent anywhere,
// the server still has the user's badges as they are.
const HYPESQUAD_BADGE = /^hypesquad/;

function runtime(): void {
  const mdga = (window as unknown as { mdga?: Mdga }).mdga;
  if (!mdga) return;

  // One cached copy per profile object, otherwise every store read returns
  // a new identity and React re-renders forever.
  const filtered = new WeakMap<object, object>();
  const stripBadges = (profile: unknown): unknown => {
    if (!profile || typeof profile !== "object") return profile;
    const p = profile as Record<string, unknown>;
    const badges = p.badges;
    if (!Array.isArray(badges)) return profile;
    const keep = badges.filter((b) => !HYPESQUAD_BADGE.test(String((b as { id?: unknown })?.id ?? "")));
    if (keep.length === badges.length) return profile;
    let copy = filtered.get(p);
    if (!copy) {
      copy = Object.assign(Object.create(Object.getPrototypeOf(p)), p, { badges: keep }) as object;
      filtered.set(p, copy);
    }
    return copy;
  };

  const STAMP = Symbol.for("mdga.no-hypesquad.profiles-patched");
  mdga.onWebpackReady(() => {
    mdga.onStores(["UserProfileStore"], (_name, store) => {
      const proto = Object.getPrototypeOf(store) as Record<PropertyKey, unknown>;
      if (proto[STAMP]) return;
      for (const name of ["getUserProfile", "getGuildMemberProfile"]) {
        if (typeof proto[name] !== "function") continue;
        // after-handlers get [result, ...args]; returning a value replaces it.
        mdga.patch(proto, name, "after", (args) => stripBadges(args[0]));
      }
      try { Object.defineProperty(proto, STAMP, { value: true }); } catch { /* frozen */ }
      console.log("[mdga] no-hypesquad: filtering HypeSquad badges from UserProfileStore");
    });
  });
}

export default defineModule({
  id: "no-hypesquad",
  label: "No HypeSquad badges",
  description: "Hides HypeSquad house and HypeSquad Events badges on profiles.",
  defaultEnabled: true,
  runtime,
});
