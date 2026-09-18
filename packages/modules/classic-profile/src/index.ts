import { defineModule } from "@mdga/plugin-api";

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
  // patches will be added once we can develop against a live Discord build.
});
