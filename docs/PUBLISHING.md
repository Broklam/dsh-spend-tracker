# Publishing and marketplace submission

DeepSeek Harness has no central plugin store. There are three places a plugin can be discovered, and this repository is set up for all of them:

1. **DSH Discover tab** — any static JSON *index* that a user adds with **Plugins → Discover → Add index source**. This is the official mechanism, and this repo ships an index plus a GitHub Pages workflow.
2. **DSH Plugin Hub** ([dsh-plugin.org](https://dsh-plugin.org)) — a community directory. Public repositories tagged `dsh-plugin` are indexed automatically; npm-published packages can then be installed by name from **Plugins → Add plugin**.
3. **Direct install** — npm, GitHub, or a local clone, without any marketplace.

Profiles matter for every install command below: the Desktop app runs the `desktop` profile, and `dsh web` runs the `web` profile. The hub's install command uses the `web` profile, so the submission text keeps that form, while Desktop users install from **Plugins → Add plugin** or with `dsh plugin --profile desktop add …`.

## Current status

| Item | Value |
| --- | --- |
| npm package | `dsh-spend-tracker@0.2.2` — published and public |
| One-step install | `dsh plugin --profile web add dsh-spend-tracker` |
| Hub listing | <https://dsh-plugin.org/plugins/broklam/dsh-spend-tracker> |
| Hub category | **Models & Reasoning** |
| License | MIT |
| Compatibility | DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`; `web` and `desktop` profiles |

The README carries the listing badge, the category, the copyable install command, both screenshots, the permissions note, and the compatibility table.

## 1. Publish to npm

The package name `dsh-spend-tracker` is claimed by this project, and the package needs no build step. The published files are `index.js`, `projection.js`, `pricing.js`, `client.js`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, the README and CHANGELOG, and `docs`/`marketplace`, as listed in `files`. You need Node.js 22 or newer with the npm CLI.

The release that is live now is `0.2.2`:

```sh
npm view dsh-spend-tracker version
```

To ship the changes currently on `main` (the agent-team reading and the model-count fix), cut the next release:

```sh
npm version patch --no-git-tag-version    # bump package.json
VERSION=$(node -p "require('./package.json').version")
# edit CHANGELOG.md: move [Unreleased] under the new version with today's date
git add package.json CHANGELOG.md
git commit -m "Release v$VERSION"
npm publish
git tag "v$VERSION"
git push origin main "v$VERSION"
gh release create "v$VERSION" --generate-notes
```

`publishConfig.access` is `public`, and the package is not private. Publishing prompts for the npm two-factor code; a 403 `two-factor authentication` error means the one-time code was missing or stale, not that the package name is taken.

After the publish, the npm install works as written:

```sh
dsh plugin --profile web add dsh-spend-tracker      # dsh web
dsh plugin --profile desktop add dsh-spend-tracker  # Desktop, from a terminal
```

The package's embedded README is captured at publish time, so publish after editing the README.

## 2. The DSH Plugin Hub listing

The hub crawls public repositories and generates a listing. Requirements, all met and verified by the live listing:

- [x] The repository is public.
- [x] The GitHub topic `dsh-plugin` is set.
- [x] `package.json` sits at the repository root with the package name and version, and the matching npm package exists.
- [x] The README includes the copyable install command `dsh plugin --profile web add dsh-spend-tracker`.
- [x] The plugin exports `apply(ctx)` (`index.js`).
- [x] A license is declared (MIT).
- [x] The README states the hub category (**Models & Reasoning**), the supported profiles, permissions, compatibility, and limitations, and shows screenshots of the plugin in action.

The listing was created on 2026-11-17 and is verified. The site re-syncs metadata, README changes, and version info automatically, while the in-app **DSH Plugin Hub** catalog carries an npm package only after the hub's own verification, so keep the npm publish current and re-check after each release.

To correct or re-request the listing, open an issue in [dshplugin/dsh-plugin-hub](https://github.com/dshplugin/dsh-plugin-hub/issues/new) with the template below.

Title:

```text
[Plugin submission] Broklam/dsh-spend-tracker — see what the open chat has spent, broken down by tokens, cache, activity, and model
```

Body:

```markdown
### Repository
https://github.com/Broklam/dsh-spend-tracker

### One-line value
Adds an estimated spend reading to the DeepSeek Harness composer, priced at DeepSeek's published peak or off-peak rate, with a breakdown of where the open chat's money went.

### Category
Models & Reasoning

### Install command
dsh plugin --profile web add dsh-spend-tracker

### Compatibility
DeepSeek Harness >= 0.2.2-rc.1 < 0.3.0; web and desktop profiles; no runtime dependencies.

### License
MIT

### Screenshots / demo
The composer reading and the open breakdown panel are in the README (docs/images/composer-dock.png and docs/images/session-spend-panel.png).

### Notes
Local estimates only. The sole network request is a background HTTPS GET for DeepSeek's public pricing page (no credentials, no session data, no telemetry); prices come from that page when it is reachable, and otherwise from the bundled table or the last table it fetched. Each request is priced at the published peak or off-peak rate for the time its usage settled. The estimate covers this chat and its local subagent conversations; provider-billed calls that never record usage in the session log (session-title generation and the web-search provider's own model turn) are not included.

### Pre-submission checklist
- [x] Repository is public
- [x] GitHub topic `dsh-plugin` added
- [x] README includes the install command
- [x] Plugin exports an `apply(ctx)` module
- [x] Repository root includes a `package.json`
```

After a successful listing, the detail page is <https://dsh-plugin.org/plugins/broklam/dsh-spend-tracker>. The badge below is already in the README and needs no further edit:

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/broklam/dsh-spend-tracker)
```

## 3. Publish a DSH plugin index

[`marketplace/index.json`](../marketplace/index.json) is a format-1 index with one plugin and its released versions. `.github/workflows/pages.yml` publishes the `marketplace/` directory to GitHub Pages on every push that touches it, so the index is live at:

```text
https://broklam.github.io/dsh-spend-tracker/index.json
```

Users add that URL in **Plugins → Discover → Add index source** after enabling **Custom plugin indexes**. A fork needs one setup step first: enable Pages with **GitHub Actions** as the source (Settings → Pages → Build and deployment → Source: GitHub Actions), or run `gh api --method POST repos/<owner>/<repo>/pages -f build_type=workflow`.

An index pins an exact version and source. After each release, add a version entry and keep the older ones for users who pin versions. Prefer npm after step 1, because it is the install path **Plugins → Add plugin** uses:

```json
{
  "version": "0.2.2",
  "publishTimestamp": 1794834000,
  "source": { "type": "npm" },
  "engines": { "dsh": ">=0.2.2-rc.1 <0.3.0" }
}
```

A Git source stays useful before an npm release or for a pinned commit. The commit must be the full 40-character sha, and the package is at the repository root, so no `path` is needed:

```json
{
  "version": "0.2.2",
  "publishTimestamp": 1794834000,
  "source": {
    "type": "git",
    "url": "https://github.com/Broklam/dsh-spend-tracker",
    "commit": "<40-character sha>"
  },
  "engines": { "dsh": ">=0.2.2-rc.1 <0.3.0" }
}
```

The index format is documented in the DSH user guide, section **Plugin indexes**. DSH rejects the whole index when one field is invalid and shows the offending JSON path under the source in **Manage index sources…**. Both workflows run `node scripts/validate-index.mjs` before anything is published: it checks names, versions, timestamps, source shapes, the `engines` range, duplicates, and the icon file, and you can run it locally before committing. DSH re-validates the complete format when a user adds the index.

## 4. Direct install without a marketplace

```sh
# npm
dsh plugin --profile web add dsh-spend-tracker

# GitHub
dsh plugin --profile web add github:Broklam/dsh-spend-tracker

# local clone
dsh plugin --profile web add ./dsh-spend-tracker
```

In the Desktop app, open **Plugins → Add plugin** and paste the package directory's absolute path instead; the Desktop app runs the `desktop` profile.
