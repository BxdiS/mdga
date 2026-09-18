# Example plugin

Template for a third-party mdga plugin. Copy this folder outside the mdga repo, rename it, and build a single JS bundle.

## Build

```
npm install
npm run build
```

The output is `dist/index.js`. Drop that file into the mdga plugins folder:

- Windows: `%APPDATA%\mdga\plugins\`
- Linux: `~/.config/mdga/plugins/`
- macOS: `~/Library/Application Support/mdga/plugins/`

Restart Discord. mdga's loader picks it up.

## Contract

The plugin exports `defineModule(...)` as its default export. See `docs/PLUGIN-API.md` in the mdga repo for the full API — finders, patcher, module lifecycle.
