import { defineModule } from "@mdga/plugin-api";

export default defineModule({
  id: "no-super-reactions",
  label: "No Super Reactions",
  description: "Removes Super Reactions from the picker and hides the animated overlay on messages.",
  defaultEnabled: true,
});
