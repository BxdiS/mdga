import { defineModule } from "@mdga/plugin-api";

// Discord renders custom name styles in two independent systems:
//
// 1. DM sidebar / profile popover — "display name styles" (Nitro cosmetic):
//    Container: container_<hash> + dnsFont_<hash> + <fontName>_<hash>
//    Effects:   prism_<hash>, neon_<hash> on <span data-username-with-effects>
//    Variables: --custom-display-name-styles-*
//
// 2. Member list / chat messages — "username gradient" (Nitro cosmetic):
//    Gradient:  usernameGradient_<hash>, twoColorGradient_<hash>
//    Glow:      nameGlow_<hash>, usernameGlow_<hash>, convenienceGlowGradient_<hash>
//    Font:      dnsFont_<hash> + <fontName>_<hash> (same system)
//    Attribute: data-username-has-gradient="true"
//    Variables: --custom-gradient-color-1/2/3 (inline style)
//
// Both systems are pure CSS cosmetics — no stores, no network, no T&S
// surface. We reset every property they rely on so names render as plain
// text in the default font and role colour.
const CSS = `
/* ─── Custom font (shared by both systems) ─── */
[class*="dnsFont_"] {
  font-family: inherit !important;
}

/* ─── System 1: display name styles (DM sidebar, profile popover) ─── */
/* DM sidebar and profile: strip everything, fall back to default colour.
   These are personal Nitro cosmetics outside any server context — no role
   colour applies, so inherit gives the standard text colour. */
[data-username-with-effects] {
  background-image: none !important;
  background-clip: unset !important;
  -webkit-background-clip: unset !important;
  -webkit-text-fill-color: inherit !important;
  -webkit-text-stroke: unset !important;
  paint-order: unset !important;
  text-shadow: none !important;
  filter: none !important;
  animation: none !important;
}
[class*="showEffect_"] {
  animation: none !important;
}
/* Scope to container_<hash> that is a direct parent of the effects span,
   not any random container_ in the page. The dnsFont_ or showEffect_
   class is always present on the same div, so the compound selector is
   safe. */
[class*="container_"][class*="showEffect_"],
[class*="container_"][class*="dnsFont_"] {
  --custom-display-name-styles-font-opacity: 1 !important;
  --custom-display-name-styles-neon-stroke-color: transparent !important;
  --custom-display-name-styles-toon-stroke-color: transparent !important;
  animation: none !important;
}
/* Neon / toon effect classes add stroke and glow via pseudo-elements and
   text-stroke. Neutralise them directly. */
[class*="neon_"][data-username-with-effects],
[class*="toon_"][data-username-with-effects],
[class*="rock_"][data-username-with-effects],
[class*="anime_"][data-username-with-effects] {
  -webkit-text-stroke: 0 !important;
  paint-order: normal !important;
}
/* Some effects render an ::before / ::after pseudo for the stroke layer;
   the container_<hash> sets content via CSS. Hiding them removes leftovers. */
[class*="container_"][class*="showEffect_"]::before,
[class*="container_"][class*="showEffect_"]::after,
[class*="container_"][class*="dnsFont_"]::before,
[class*="container_"][class*="dnsFont_"]::after {
  display: none !important;
}

/* ─── System 2: username gradient (member list, chat, system messages) ─── */
/* The gradient is rendered on spans with usernameGradient_<hash> and/or
   twoColorGradient_<hash>. These appear inside member list rows, chat
   message headers, and system messages (e.g. boost announcements). Flatten
   to the first gradient stop so the role colour survives as a flat value.
   Exclude roleCircle_ (the tiny dot next to role names in the popover). */
[class*="usernameGradient_"]:not([class*="roleCircle_"]),
[class*="twoColorGradient_"]:not([class*="roleCircle_"]):not([class*="gradientDotAnimation_"]) {
  background-image: none !important;
  background-clip: unset !important;
  -webkit-background-clip: unset !important;
  -webkit-text-fill-color: var(--custom-gradient-color-1, inherit) !important;
  animation: none !important;
}
[data-username-has-gradient] {
  background-image: none !important;
  background-clip: unset !important;
  -webkit-background-clip: unset !important;
  -webkit-text-fill-color: var(--custom-gradient-color-1, inherit) !important;
  animation: none !important;
}

/* ─── Glow effects (all contexts) ─── */
[class*="nameGlow_"] {
  display: none !important;
}
[class*="usernameGlow_"],
[class*="convenienceGlowGradient_"] {
  text-shadow: none !important;
  filter: none !important;
}
`;

export default defineModule({
  id: "no-custom-name-styles",
  label: "No Custom Name Styles",
  description: "Strips Nitro custom fonts and gradient/neon effects from display names, rendering them as plain text.",
  defaultEnabled: true,
  css: CSS,
});
