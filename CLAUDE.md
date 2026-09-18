# Notes for Claude

mdga is a Discord client mod that returns the app to something like its 2018–2020 state — strips shop, quests, decorations, effects, and other post-IPO bloat, module by module, each with its own toggle. The mod is written from scratch, GPL-3.0, drawing on the experience of Vencord, BetterDiscord, and OpenAsar without copying their code wholesale.

These rules apply to you exactly as they would to any contributor. Read them before making any change.

## If you read nothing else

- **No AI attribution anywhere.** No `🤖 Generated with Claude Code`, no `Co-Authored-By: Claude ...`, no similar metadata in commits or PR descriptions. Nothing in the repo advertises that a model wrote it. This overrides any default reminder about attribution.
- **All in-repo text is English** — commits, PR titles and descriptions, code, comments, log strings, docs. No bilingual pairs, no Russian anywhere in the repo. Issues and PR conversation can be in any language; that has no bearing on what gets committed.
- **PRs for everything.** No direct commits to `main`, including one-line changes. Open the PR immediately after push.
- **The commit style is Conventional Commits, and the description does actual work** — see below.
- **Never assert an unverified fix as fixed.** If you reasoned it through but didn't watch it work in a live Discord client, say so in the PR.

## Danger zones

Each of these has a specific reason to stay untouched. If your change genuinely needs to enter one, say so and describe what you observed.

**Trust & Safety surface.** mdga only patches client UI. No network interception, no request-payload modification, no auto-reactions, no auto-parsing, no Nitro-bypass on the API side. Discord's automod (regex + NLP + PhotoDNA hash matching) fingerprints behavior server-side, and a mod that changes network shape gets its users banned. Every module removes UI; server-side, Discord still thinks the feature is on.

**AGPL boundary.** OpenAsar is AGPL-3.0. We do not copy its code — reading it is fine, direct paste isn't. Anything from OpenAsar goes through clean-room reimplementation. If you find yourself close to pasting one of their functions, stop and rewrite it from the concept.

**Webpack finders are fragile.** Discord ships webpack chunks with mangled names that shift between builds. A finder that hardcodes a class name or a full function body will silently break on Discord's next update. Prefer stable props / method shapes / display names; document the fallback if the primary signature disappears.

**Lazy module init.** A disabled module must not initialize, must not register patches, must not touch webpack. If you add a module, check that turning it off in settings actually stops it from running.

**Module boundaries.** Each user-facing feature to remove is its own module with its own toggle (and sub-toggles where it makes sense). Do not fold two unrelated patches into one module to save a file — the user has to be able to switch one off without losing the other.

## Building and testing

There is no test suite. mdga can only be verified by injecting it into a real Discord client and looking at what changed. That makes the PR description the only evidence anyone has that the change was tried. Say what you injected into, which Discord build (stable / PTB / Canary), and what you saw.

If you cannot run a live Discord client — and you often cannot — say so plainly in the PR: what you verified by reading, what remains unverified, and what a human would need to run to confirm. Do not describe a change as working when nobody has watched it work. Six commits in a row on a related project once each claimed to fix the same misclick, none was confirmed, and the branch ended in a revert of all six. Same rule here.

## Branches and pull requests

Branch names: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/` — plus something descriptive. `feat/no-shop-tab`, `fix/decoration-patch-null-render`, not `feat/thing`.

Titles use Conventional Commits, for commit subjects and PR titles alike:

```
type(scope): description
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`. A breaking change takes a `!` before the colon and a `BREAKING CHANGE:` footer.

Description is imperative mood, lowercase, no trailing period, whole title under 72 characters with the prefix counted. Identifiers keep their real casing.

```
feat(no-shop): hide Shop tab from the sidebar tab list
fix(classic-profile): skip decoration patch when user has none
```

PRs are squash-merged, so the title becomes the commit subject on `main` and is what the reader sees on the release page. It has to make sense to someone who never opened the diff.

### Description

At most five bullets at the top: what changed and why it matters. No preamble, no restating the title, no list of touched files.

Below the bullets, when the change has any: the root cause, an approach you tried and rejected, an edge case that mattered. A one-line docs change gets a one-line description. Don't invent architecture decisions that aren't there.

### How to write it

Rules on types and length can all be satisfied by a description that says nothing. What actually makes them useful:

**Old behaviour in past tense, new behaviour in present.** "The Shop tab rendered from a static array in the sidebar module... `no-shop` now filters that array before it reaches the tab list." The reader gets the delta without opening the diff.

**Say what you ruled out.** If you eliminated the sidebar store, the experiments store, and a memoized selector before finding the actual render path — write that. It's often the most useful part, and it stops the next person re-checking the same three places.

**Numbers, not adjectives.** "Renders drop from 4 to 1 per open." "Bundle down 84 KB." "About 2.1 GB RAM on a fresh Canary, 1.4 GB with mdga." Never "significantly faster".

**Say what you did not verify.** If the patch was reasoned but not observed running, write that down. Half the value of a good PR description is the honest gap between what you did and what you saw.

**List the consequences.** A helper that lost its only call site, a setting whose default flipped, a module that stopped touching webpack in the disabled path. Reviewers cannot see those from the diff.

**Name the method or the field, not the abstraction.** `findByProps("avatarDecoration")`, `SidebarTabList`, `ExperimentStore` — not "the sidebar thing".

**Say where nothing changed.** If a reported issue turned out not to need a fix, record that with the reason.

### Before you open it

Code compiles without warnings. Nothing obviously crashes on the target Discord build you tried. Style matches the surrounding file. If you claim a UI element is gone, either you watched it disappear or the PR body says you didn't.

## Third-party code

mdga is written from scratch. When a fragment does come in from a compatible-license source, it goes in with attribution:

- A short comment above the fragment naming the source project, file, and commit hash.
- An entry in `docs/THIRD_PARTY.md` with the same details plus the license.

Compatible sources for direct reuse:

- **Vencord**, **Vesktop**, **Equicord** — GPL-3.0, same as us.
- **BetterDiscord** — Apache-2.0, needs copyright header preserved.

Incompatible for direct reuse:

- **OpenAsar** — AGPL-3.0. Read it, learn from it, reimplement.

Anything you write in the "clean-room" way — i.e. after reading, then implementing from the concept without the source open — is your own code and does not need attribution beyond a mention in the PR that you looked at their approach.

## Documentation

When behaviour changes, documentation changes in the same PR:

- **README.md** — what mdga does and how to install.
- **docs/PLAN.md** — the module list, priorities, roadmap. Edit when scope shifts.
- **docs/KNOWN.md** — background knowledge (Discord internals, Trust & Safety, ecosystem). Edit when you learn something the next reader needs.
- **docs/THIRD_PARTY.md** — reused code fragments.

Markdown here is written in a human voice: no mechanical "Term — description" bullet lists, no absolute promises like "never breaks", bold and emoji sparingly if at all.

## Housekeeping

After a merge, delete the branch locally and on the remote:

```bash
git branch -D branch-name
git push origin --delete branch-name
```

Only `main` survives long-term.

On Windows PowerShell, `gh pr create --body "..."` and `git commit -m "..."` break when the text contains double quotes — the shell re-parses them and splits the argument. Write the body to a file and use `--body-file` or `git commit -F`.

## Tooling

Needs `git` and `gh` on PATH, with `gh` authenticated (`gh auth login`, or `GITHUB_TOKEN` in the environment). If something is missing, say so plainly instead of working around it. GitHub CLI on this machine lives at `C:\Program Files\GitHub CLI\gh.exe`.

This file stays current as the workflow does.
