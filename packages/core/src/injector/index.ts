// Main-process side. Runs before Discord's original entry.
// Responsibilities:
//   - patch BrowserWindow so every renderer gets our preload
//   - wire IPC for settings read/write
//   - read settings once at startup so we know which modules to enable
//
// Nothing here yet. Bootstrap only lands once the installer can inject a shim
// and we can run against a real Discord build to see what breaks.

export function bootstrapMain(): void {
  throw new Error("bootstrapMain: not implemented");
}
