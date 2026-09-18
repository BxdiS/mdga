// Renderer preload. Runs before Discord's own JS.
// Responsibilities:
//   - wait for Discord's webpack runtime to publish
//   - build the module registry via the finders in ../webpack
//   - load each enabled module in dependency order
//   - register mdga's section in Discord's settings UI

export function bootstrapPreload(): void {
  throw new Error("bootstrapPreload: not implemented");
}
