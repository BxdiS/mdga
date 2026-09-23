# Make Discord Great Again

Windows Discord client mod that takes the app back toward its 2018–2020 look by removing the shop, quests, avatar decorations, nameplates, profile effects, Nitro name styles and similar post-IPO additions. Every removal is its own module, and you choose which ones to install.

mdga only changes what your client shows. It sends nothing to Discord and does not change your requests, so the server sees an ordinary client.

It is still early and in development.

## Install

**PowerShell** (recommended)

```powershell
irm https://github.com/BxdiS/mdga/releases/latest/download/install.ps1 | iex
```

**cmd**

```
powershell -ExecutionPolicy Bypass -c "irm https://github.com/BxdiS/mdga/releases/latest/download/install.ps1 | iex"
```

**exe**: download [`mdga-installer.exe`](https://github.com/BxdiS/mdga/releases/latest/download/mdga-installer.exe) and run it. It is not code-signed, so Windows SmartScreen will warn: More info, then Run anyway.

All three open the same installer. It finds Discord Stable, PTB and Canary and lists the modules, all on by default: Space toggles one, Enter installs. Discord is closed and restarted for you.

Run it again to change modules, update, or uninstall, and after every Discord update, which replaces the patched files.

## Development

Needs Node 20.10+ and npm.

```bash
npm install
npm run mdga -- install --flavor stable
```

`npm run mdga -- help` lists the other commands (uninstall, status, devtools). `npx tsx scripts/build-release.mts` builds the same `install.ps1` and `mdga-payload.json` a release ships, into `dist/release`. To try the installer against that local build instead of the latest release:

```powershell
$env:MDGA_PAYLOAD = "$PWD\dist\release\mdga-payload.json"; Get-Content -Raw scripts\install.ps1 | iex
```
