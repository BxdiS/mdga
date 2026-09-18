// Monkey-patcher. Wraps a target function/method with before / instead / after
// handlers. Keeps the original so unpatch is a real inverse.
//
// Semantics modeled on JsPosed, code written from scratch.

import type { PatchHandler, PatchPhase } from "@mdga/plugin-api";

export interface PatchHandle {
  unpatch(): void;
}

export function patch(
  target: object,
  method: string,
  phase: PatchPhase,
  handler: PatchHandler,
): PatchHandle {
  void target;
  void method;
  void phase;
  void handler;
  throw new Error("patch: not implemented");
}

export function unpatchAll(): void {
  throw new Error("unpatchAll: not implemented");
}
