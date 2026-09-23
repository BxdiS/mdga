// Monkey-patcher. Wraps a target method so we can run code before it, replace
// it entirely, or observe its result. All layered on top of a single wrapper
// per (target, method) — subsequent patches append to that wrapper's chain.
//
// Semantics modeled on JsPosed, code written from scratch.

import type { PatchHandler, PatchPhase } from "@mdga/plugin-api";

export interface PatchHandle {
  unpatch(): void;
}

interface WrapperState {
  original: (...args: unknown[]) => unknown;
  before: PatchHandler[];
  instead: PatchHandler[];
  after: PatchHandler[];
  disposed: boolean;
}

// Marker we plant on the wrapped function so a second patch on the same
// target/method reuses the wrapper instead of stacking wrappers.
const STATE = Symbol.for("mdga.patcher.state");

interface Wrapped {
  (this: unknown, ...args: unknown[]): unknown;
  [STATE]?: WrapperState;
}

const registered: Array<{ target: Record<string, unknown>; method: string }> = [];

function getOrInstall(target: object, method: string): WrapperState {
  const holder = target as Record<string, unknown>;
  const current = holder[method];
  if (typeof current !== "function") {
    throw new Error(`mdga patcher: ${method} is not a function on target`);
  }

  const existing = (current as Wrapped)[STATE];
  if (existing) return existing;

  // Do not .bind(target): for prototype methods (XMLHttpRequest.prototype.open)
  // the native impl needs the instance as receiver, and a copy bound to the
  // prototype throws "Illegal invocation". The wrapper forwards `this` as-is.
  const state: WrapperState = {
    original: current as (...args: unknown[]) => unknown,
    before: [],
    instead: [],
    after: [],
    disposed: false,
  };

  const wrapper = function (this: unknown, ...args: unknown[]): unknown {
    if (state.disposed) return state.original.apply(this, args);

    let currentArgs = args;
    for (const h of state.before) {
      try {
        const ret = h(currentArgs, state.original, this);
        if (Array.isArray(ret)) currentArgs = ret;
      } catch (err) {
        console.error("[mdga] before handler threw:", err);
      }
    }

    let result: unknown;
    if (state.instead.length === 0) {
      result = state.original.apply(this, currentArgs);
    } else {
      // Last-registered instead wins. Earlier `instead` handlers become the
      // "original" the next one sees, so a chain is possible if authors do
      // it deliberately.
      let next: (...a: unknown[]) => unknown = state.original;
      for (const h of state.instead) {
        const inner = next;
        next = ((...a: unknown[]): unknown => h(a, inner, this)) as (
          ...a: unknown[]
        ) => unknown;
      }
      try {
        result = next.apply(this, currentArgs);
      } catch (err) {
        console.error("[mdga] instead handler threw:", err);
        result = state.original.apply(this, currentArgs);
      }
    }

    for (const h of state.after) {
      try {
        const ret = h([result, ...currentArgs], state.original, this);
        if (ret !== undefined) result = ret;
      } catch (err) {
        console.error("[mdga] after handler threw:", err);
      }
    }

    return result;
  } as Wrapped;

  wrapper[STATE] = state;
  try {
    Object.defineProperty(wrapper, "name", { value: (current as { name?: string }).name ?? method });
  } catch {
    // Non-writable name — ignore.
  }
  holder[method] = wrapper;
  registered.push({ target: holder, method });
  return state;
}

export function patch(
  target: object,
  method: string,
  phase: PatchPhase,
  handler: PatchHandler,
): PatchHandle {
  if (target === null || (typeof target !== "object" && typeof target !== "function")) {
    throw new Error("mdga patcher: target must be an object or function");
  }
  // Modules call this from untyped runtime code, so check the phase too.
  if (phase !== "before" && phase !== "instead" && phase !== "after") {
    throw new Error("mdga patcher: phase must be before | instead | after");
  }
  const state = getOrInstall(target, method);
  const list = state[phase];
  list.push(handler);
  return {
    unpatch(): void {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    },
  };
}

export function unpatchAll(): void {
  while (registered.length > 0) {
    const entry = registered.pop();
    if (!entry) continue;
    const wrapper = entry.target[entry.method] as Wrapped | undefined;
    const state = wrapper?.[STATE];
    if (!state) continue;
    state.disposed = true;
    entry.target[entry.method] = state.original;
  }
}
