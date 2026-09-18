// Persistent settings. settings.json lives next to the injected files.
// Reads happen in the main process at startup; writes go through IPC from the
// renderer settings panel. All writes validate against the JSON schema in
// resources/settings.schema.json.

export interface Settings {
  version: number;
  modules: Record<string, {
    enabled: boolean;
    subtoggles?: Record<string, boolean>;
  }>;
}

export function readSettings(): Settings {
  throw new Error("readSettings: not implemented");
}

export function writeSettings(next: Settings): void {
  void next;
  throw new Error("writeSettings: not implemented");
}
