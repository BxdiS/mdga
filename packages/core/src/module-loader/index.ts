// Module registry. Both official modules and third-party plugins register
// through the same entry point. A disabled module is not registered, does not
// run its find(), does not install any patches.

import type { Module } from "@mdga/plugin-api";

const registry = new Map<string, Module>();

export function registerModule(module: Module): void {
  if (registry.has(module.id)) {
    throw new Error(`duplicate module id: ${module.id}`);
  }
  registry.set(module.id, module);
}

export function loadModules(): void {
  throw new Error("loadModules: not implemented");
}
