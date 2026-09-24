import { defineModule } from "@mdga/plugin-api";

// Nitro promo popovers: a non-modal dialog in a popout layer whose action
// bar is a Get Nitro button. Seen on Stable next to the Nitro row in the DM
// list ("Snag a sweet deal with Nitro", a partner discount with "Terms
// apply"). Text, image and offer change from promo to promo, so the match is
// the Nitro wheel icon on the action button, the same icon every Get Nitro
// button carries. Popovers with other actions stay, and so do Nitro buttons
// outside a popover's action bar (the emoji picker's upsell bar is
// no-locked-emoji's business).
const CSS = `
[id^="popout_"]:has(> [data-mana-component="popover"] > [role="dialog"] [class*="actionBar_"] path[d^="M16.23 12c0 1.29"]) {
  display: none !important;
}
`;

export default defineModule({
  id: "no-nitro-spam",
  label: "No Nitro spam",
  description: "Hides the Nitro promo popovers, such as the partner deals that pop up next to the Nitro row in the DM list.",
  defaultEnabled: true,
  subtoggles: {
    banners:       { label: "Try Nitro banners and modals", default: true },
    streamUpsells: { label: "HD stream upsells",            default: true },
    profileTags:   { label: "Nitro tags on profiles",       default: true },
  },
  css: CSS,
});
