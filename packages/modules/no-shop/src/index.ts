import { defineModule } from "@mdga/plugin-api";

// Sidebar entries are keyed by data-list-item-id, whose suffix is stable
// across Discord builds and locales even when the uid prefix (e.g.
// "private-channels-uid_11___") changes. Hiding the whole <li> via :has()
// keeps hover targets, focus rings and keyboard navigation gone too.
const CSS = `
li[role="listitem"]:has(a[data-list-item-id$="___shop"]) { display: none !important; }
li[role="listitem"]:has(a[data-list-item-id$="___nitro"]) { display: none !important; }
li[role="listitem"]:has(a[data-list-item-id$="___quests"]) { display: none !important; }
/* The Quests item is wrapped in a shine-animation container; collapse it too
   so its padding does not leave a gap. */
div[class^="wrapper__"]:has(> li[role="listitem"] a[data-list-item-id$="___quests"]) { display: none !important; }
`;

export default defineModule({
  id: "no-shop",
  label: "No Shop",
  description: "Hides the Shop tab, Nitro store, and Quests entries in the DM sidebar.",
  defaultEnabled: true,
  subtoggles: {
    shopTab: { label: "Shop tab", default: true },
    nitroStore: { label: "Nitro store link", default: true },
    quests: { label: "Quests", default: true },
    collectibles: { label: "Collectibles", default: true },
  },
  css: CSS,
});
