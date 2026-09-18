import { defineModule } from "@mdga/plugin-api";

export default defineModule({
  id: "no-shop",
  label: "No Shop",
  description: "Hides the Shop tab, Nitro store, Quests, and Collectibles.",
  defaultEnabled: true,
  subtoggles: {
    shopTab:      { label: "Shop tab",     default: true },
    nitroStore:   { label: "Nitro store",  default: true },
    quests:       { label: "Quests",       default: true },
    collectibles: { label: "Collectibles", default: true },
  },
});
