import { defineModule } from "@mdga/plugin-api";

// Third-party plugins look exactly like official modules. The only difference
// is where the file ends up: user plugins drop into the mdga plugins folder
// under the per-user data directory, not into packages/.

export default defineModule({
  id: "example",
  label: "Example plugin",
  description: "Does nothing. Rename this and add your own patches.",
  defaultEnabled: false,
});
