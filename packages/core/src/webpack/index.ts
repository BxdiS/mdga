// Webpack module finders. Everything is lazy: a finder is a thunk, and the
// loader only calls it if the owning module is enabled.
//
// The real implementations hook webpackChunkdiscord_app.push to observe every
// chunk load, cache the module registry, and expose typed queries. Not written
// yet — needs a live Discord to develop against.

export function findByProps(...props: string[]): unknown {
  void props;
  throw new Error("findByProps: not implemented");
}

export function findByCode(...fragments: string[]): unknown {
  void fragments;
  throw new Error("findByCode: not implemented");
}

export function findStore(name: string): unknown {
  void name;
  throw new Error("findStore: not implemented");
}

export function findByDisplayName(name: string): unknown {
  void name;
  throw new Error("findByDisplayName: not implemented");
}
