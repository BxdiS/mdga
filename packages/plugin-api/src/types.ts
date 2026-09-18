export type PatchPhase = "before" | "instead" | "after";

export type PatchHandler = (
  args: unknown[],
  original: (...args: unknown[]) => unknown,
  self: unknown,
) => unknown;

export interface Patch {
  method: string;
  phase?: PatchPhase;
  handler: PatchHandler;
}

export type WebpackFinder = () => unknown;

export interface Subtoggle {
  label: string;
  default: boolean;
}

export interface ModuleContext {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly logger: {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };
}

export interface ModuleManifest {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  subtoggles?: Record<string, Subtoggle>;
  dependsOn?: string[];
}

export interface Module extends ModuleManifest {
  find?: WebpackFinder;
  patches?: Patch[];
  onStart?(ctx: ModuleContext): void | Promise<void>;
  onStop?(ctx: ModuleContext): void | Promise<void>;
}
