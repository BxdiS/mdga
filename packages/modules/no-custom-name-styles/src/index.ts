import { defineModule } from "@mdga/plugin-api";

// Discord renders custom name styles in two independent systems:
//
// 1. DM list, profiles, chat usernames — "display name styles" (Nitro cosmetic):
//    Container: container_<hash> + dnsFont_<hash> + <fontName>_<hash>
//    Effects:   solid_, gradient_, prism_, neon_, toon_, pop_, gummy_ (<hash>)
//               on <span data-username-with-effects>, active only while the
//               container has showEffect_<hash>
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
/* The font classes also set letter-spacing (0.01em to 0.04em) and
   dnsFont_ turns font synthesis off; both follow the surrounding text
   again. */
[class*="dnsFont_"] {
  font-family: inherit !important;
  letter-spacing: inherit !important;
  font-synthesis: inherit !important;
}

/* ─── System 1: display name styles (DM list, profiles, chat usernames) ─── */
/* Strip everything and fall back to the surrounding colour: the standard
   text colour in the DM list and profiles, the role colour inside a chat
   username_ (the span inherits it from there). Besides the paint, the
   effect classes set the span's own colour (solid, neon, toon, pop), a
   266ms colour transition (toon, so a hovered DM row recoloured the name
   late), negative margins with padding to make room for strokes and
   glows (neon, toon, pop, gummy), inline-block (pop) and no kerning
   (gummy); all of it goes back to what the span has without an effect. */
[data-username-with-effects] {
  color: inherit !important;
  transition: none !important;
  background-image: none !important;
  background-clip: unset !important;
  -webkit-background-clip: unset !important;
  -webkit-text-fill-color: inherit !important;
  -webkit-text-stroke: unset !important;
  paint-order: unset !important;
  text-shadow: none !important;
  filter: none !important;
  animation: none !important;
  display: inline !important;
  vertical-align: baseline !important;
  margin: 0 !important;
  padding: 0 !important;
  font-kerning: inherit !important;
  font-variant-ligatures: inherit !important;
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
/* Toon and pop draw the name a second time in the span's ::before (the
   gradient fill for toon, the coloured drop copy for pop), and gummy draws
   its hover underline there. The span's own text is the plain copy. */
[data-username-with-effects]::before,
[data-username-with-effects]::after {
  display: none !important;
}
/* The hover underline takes the style's main colour; pop and gummy turn
   it off on the span and draw it in the ::before instead. */
[data-username-with-effects][class*="underlineOnHover_"]:hover {
  text-decoration-line: underline !important;
  text-decoration-color: currentcolor !important;
}
/* Gummy puts every letter in its own inline-block and squishes it in
   turn. As plain inline text the letters kern, wrap and take the hover
   underline like any other name. */
[data-username-with-effects] [class*="gummyWord_"],
[data-username-with-effects] [class*="gummyLetter_"] {
  display: inline !important;
  vertical-align: baseline !important;
  white-space: inherit !important;
  animation: none !important;
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

/* ─── Style editor ───
   The paintbrush button at the end of the display name field in your
   profile opens the Nitro display name style picker. The field is an
   <input> laid over a preview of the name, and the preview sets the width.
   Hiding only the button broke that: with a trailing button the input is
   sized 100% - 42px, so it ended up narrower than the preview and the caret
   drifted off the letters. The preview also renders the name with a
   trailing space, which left a gap on the right. The preview exists to show
   display name styles, which this module strips anyway, so drop it along
   with the button and let the input size itself to its text
   (field-sizing: content). Matched by the button's label and, for other
   locales, by the paintbrush icon. */
[class*="hasTrailing_"] > [class*="trailing_"]:has(button[aria-label="Edit display name style"]),
[class*="hasTrailing_"] > [class*="trailing_"]:has(path[d^="m9.17 12.67 2.16 2.16"]),
[class*="hasPreview_"]:has(> [class*="trailing_"] button[aria-label="Edit display name style"]) > [class*="sizer_"],
[class*="hasPreview_"]:has(> [class*="trailing_"] path[d^="m9.17 12.67 2.16 2.16"]) > [class*="sizer_"] {
  display: none !important;
}
[class*="hasPreview_"]:has(> [class*="trailing_"] button[aria-label="Edit display name style"]) > [class*="field_"],
[class*="hasPreview_"]:has(> [class*="trailing_"] path[d^="m9.17 12.67 2.16 2.16"]) > [class*="field_"] {
  position: static !important;
  width: auto !important;
  max-width: 100% !important;
  field-sizing: content !important;
  opacity: 1 !important;
}
/* With a preview, the focused input paints its text transparent so only
   the preview shows. Paint it normally now that it is the only copy. */
[class*="hasPreview_"]:has(> [class*="trailing_"] button[aria-label="Edit display name style"]) > [class*="field_"]:focus,
[class*="hasPreview_"]:has(> [class*="trailing_"] path[d^="m9.17 12.67 2.16 2.16"]) > [class*="field_"]:focus {
  color: var(--text-default) !important;
  -webkit-text-fill-color: var(--text-default) !important;
}
`;

export default defineModule({
  id: "no-custom-name-styles",
  label: "No Custom Name Styles",
  description:
    "Strips Nitro custom fonts and effects (gradient, neon, toon, pop, gummy) from display names, rendering them as plain text, " +
    "and hides the display name style button in your profile.",
  defaultEnabled: true,
  css: CSS,
});
