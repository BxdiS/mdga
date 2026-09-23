// CSS injection. Each id maps to a <style> element in <head>. Re-injecting the
// same id replaces the sheet; removeCSS unmounts it. Used by modules that hide
// things by selector when webpack patching would be overkill.

const cssNodes = new Map<string, HTMLStyleElement>();

export function injectCSS(id: string, css: string): void {
  if (typeof id !== "string" || typeof css !== "string") return;
  let node = cssNodes.get(id);
  if (!node) {
    const created = document.createElement("style");
    node = created;
    created.setAttribute("data-mdga-css", id);
    // document.head may not exist yet when we run this early in page load.
    // Fall back to documentElement (<html>) so the sheet is live either way.
    const parent = document.head || document.documentElement;
    if (parent) {
      parent.appendChild(created);
    } else {
      // No DOM at all yet — queue until it's ready. Skip if removeCSS (or a
      // re-inject) replaced this node meanwhile.
      document.addEventListener("DOMContentLoaded", () => {
        if (cssNodes.get(id) !== created) return;
        (document.head || document.documentElement).appendChild(created);
      }, { once: true });
    }
    cssNodes.set(id, created);
  }
  node.textContent = css;
}

export function removeCSS(id: string): void {
  const node = cssNodes.get(id);
  if (!node) return;
  node.remove();
  cssNodes.delete(id);
}

export function listCSS(): string[] {
  return Array.from(cssNodes.keys());
}
