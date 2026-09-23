# mdga

Make Discord Great Again: a Windows Discord client mod that takes the app back toward its 2018–2020 look by removing the shop, quests, avatar decorations, nameplates, profile effects, Nitro name styles and similar post-IPO additions. Every removal is its own module, and you choose which ones to install.

mdga only changes what your client shows. It sends nothing to Discord and does not change your requests, so the server sees an ordinary client.

It is still early and in development.

## Install

Open PowerShell (Win+X, then Terminal or Windows PowerShell) and run:

```powershell
irm https://github.com/BxdiS/mdga/releases/latest/download/install.ps1 | iex
```

From cmd instead of PowerShell:

```
powershell -ExecutionPolicy Bypass -c "irm https://github.com/BxdiS/mdga/releases/latest/download/install.ps1 | iex"
```

The installer finds Discord Stable, PTB and Canary and lets you pick modules: all of them are on by default, Space toggles one, Enter installs. If Discord is running, mdga closes it cleanly and starts it again afterwards.

Run the same command to change modules, update mdga, or uninstall. A Discord update replaces the patched files, so run it again after Discord updates itself.

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

## Releases

A release is a git tag. Pushing a tag that starts with `v` runs `.github/workflows/release.yml`, which typechecks, builds `install.ps1` and `mdga-payload.json`, and publishes them as a GitHub release with notes generated from the merged PRs. The install command always fetches the latest release, so users get the new version the next time they run it.

```bash
git checkout main
git pull
git tag v0.1.0
git push origin v0.1.0
```

Versions follow semver: bump the patch (`v0.1.1`) for fixes, the minor (`v0.2.0`) for new modules or features. If the workflow fails, delete the tag (`git push origin --delete v0.1.0` and `git tag -d v0.1.0`), fix, and tag again.
