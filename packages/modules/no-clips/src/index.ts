import { defineModule } from "@mdga/plugin-api";

export default defineModule({
  id: "no-clips",
  label: "No Clips",
  description: "Hides the Clips recording UI and its notifications.",
  defaultEnabled: true,
});
