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
   modifier nameplated_<hash>. Hide the whole wrapper (and stop the video
   so the tab doesn't keep decoding it) and clear the modifier's spacing
   in case Discord ever adds padding to it. */
[class*="container_"][aria-hidden="true"]:has(> [class*="videoContainer_"] > video[src*="collectibles-shop"]) {
  display: none !important;
}
[class*="videoContainer_"] > video[src*="collectibles-shop"] {
  display: none !important;
}
[class*="nameplated_"] {
  padding: unset !important;
}

/* ─── Profile effects ───
   The animated confetti/sparkle overlay Discord paints on top of profile
   popouts is rendered as an absolutely-positioned element whose class
   contains "profileEffect". Kill both the container and any child media
   (video/img/canvas) so nothing is left running behind the modal. */
[class*="profileEffects"],
[class*="profileEffect_"] {
  display: none !important;
}
[class*="profileEffects"] video,
[class*="profileEffects"] img,
[class*="profileEffects"] canvas,
[class*="profileEffect_"] video,
[class*="profileEffect_"] img,
[class*="profileEffect_"] canvas {
  display: none !important;
}
`;

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
});
