import type { Module } from "./types.js";

/**
 * Declare an mdga module. The returned object is what the loader consumes.
 * Both official modules under packages/modules/* and third-party plugins
 * dropped into the user plugins directory use this same shape.
 */
export function defineModule(module: Module): Module {
  return module;
}
