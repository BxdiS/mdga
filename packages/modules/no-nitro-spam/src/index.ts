import { defineModule } from "@mdga/plugin-api";

export default defineModule({
  id: "no-nitro-spam",
  label: "No Nitro spam",
  description:
    "Removes Try Nitro banners and modals, HD stream upsells in Share Screen, " +
    "and the Nitro tags/CTAs that appear on user profiles.",
  defaultEnabled: true,
  subtoggles: {
    banners:       { label: "Try Nitro banners and modals", default: true },
    streamUpsells: { label: "HD stream upsells",            default: true },
    profileTags:   { label: "Nitro tags on profiles",       default: true },
  },
});
