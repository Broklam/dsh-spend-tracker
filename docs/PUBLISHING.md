# Publishing and marketplace submission

DeepSeek Harness has no central plugin store. There are three places a plugin can be discovered, and this repository is set up for all of them:

1. **DSH Discover tab** — any static JSON *index* that a user adds with **Plugins → Discover → Add index source**. This is the official mechanism, and this repo ships an index plus a GitHub Pages workflow.
2. **DSH Plugin Hub** ([dsh-plugin.org](https://dsh-plugin.org)) — a community directory. Public repositories tagged `dsh-plugin` are indexed automatically; npm-published packages also appear in the in-app Plugin Hub for one-click install.
3. **Direct install** — npm, GitHub, or a local clone, without any marketplace.

## 1. Publish to npm

The package name `dsh-spend-tracker` is unclaimed, and the package needs no build step: `index.js`, `projection.js`, and `client.js` are the published files, listed in `files`.

```sh
npm login
npm publish
```

`publishConfig.access` is `public`, and the package is not private. Verify the result with `npm view dsh-spend-tracker version`.

Once published, the install command in the README works as written:

```sh
dsh plugin --profile web add dsh-spend-tracker
```

To cut a release, bump `version` in `package.json`, update [`CHANGELOG.md`](../CHANGELOG.md), commit, then publish and tag:

```sh
npm publish
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 --generate-notes
```

## 2. Submit to the DSH Plugin Hub

The hub crawls public repositories and generates a listing. Requirements, all already met by this repository:

- [x] The repository is public.
- [x] The GitHub topic `dsh-plugin` is set.
- [x] `package.json` sits at the repository root with the package name and version.
- [x] The README includes a copyable install command.
- [x] The plugin exports `apply(ctx)` (`index.js`).
- [x] A license is declared (MIT).
- [x] Compatibility, permissions, and limitations are documented in the README.

Two actions complete the submission:

1. Keep the npm publish from step 1 current. Without an npm package the site still lists the repository, but the in-app Plugin Hub only shows one-command installs.
2. Optionally open the prefilled submission issue so a reviewer verifies the listing faster:
   `https://github.com/dshplugin/dsh-plugin-hub/issues/new?title=%5BPlugin%20submission%5D%20Broklam%2Fdsh-spend-tracker&body=...`

The issue body template is on [dsh-plugin.org/submit](https://dsh-plugin.org/submit). Use this content:

```markdown
### Repository
https://github.com/Broklam/dsh-spend-tracker

### One-line value
Shows what the open chat has cost so far and breaks the estimate down by token bucket, cache hit, activity, and model.

### Category
UI & Experience

### Install command
dsh plugin --profile web add dsh-spend-tracker

### Compatibility
DeepSeek Harness >= 0.2.2-rc.1; Desktop and web profiles; no runtime dependencies.

### License
MIT

### Notes
Local estimates only: no network requests, no credentials, no telemetry. Prices come from a configurable per-million-token table; default rates are DeepSeek's official peak rates.
```

After listing, the detail page is `https://dsh-plugin.org/plugins/Broklam/dsh-spend-tracker`. Add the badge to the README:

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/Broklam/dsh-spend-tracker)
```

## 3. Publish a DSH plugin index

[`marketplace/index.json`](../marketplace/index.json) is a format-1 index with one plugin and one version. Host it anywhere static; this repository includes `.github/workflows/pages.yml`, which publishes the `marketplace/` directory to GitHub Pages on every push that touches it.

Prepare it once:

1. Push this repository.
2. Enable Pages for the repository with **GitHub Actions** as the source (Settings → Pages → Build and deployment → Source: GitHub Actions), or run `gh api --method POST repos/Broklam/dsh-spend-tracker/pages -f build_type=workflow`.
3. Let the Pages workflow run. The index URL becomes `https://broklam.github.io/dsh-spend-tracker/index.json`.

Users add that URL in **Plugins → Discover → Add index source** after enabling **Custom plugin indexes**.

An index pins an exact version and source. After each release, update the version entry: `version`, `publishTimestamp` (Unix seconds), and `source`. Prefer npm after step 1, because it is the install path the Plugin Hub also uses:

```json
{
  "version": "0.1.0",
  "publishTimestamp": 1794825600,
  "source": { "type": "npm" },
  "engines": { "dsh": ">=0.2.2-rc.1" }
}
```

A Git source stays useful before an npm release or for a pinned commit:

```json
{
  "version": "0.1.0",
  "publishTimestamp": 1794825600,
  "source": {
    "type": "git",
    "url": "https://github.com/Broklam/dsh-spend-tracker",
    "commit": "<40-character sha>"
  },
  "engines": { "dsh": ">=0.2.2-rc.1" }
}
```

The index format is documented in the DSH user guide, section **Plugin indexes**. Check the file against the format rules after editing: DSH rejects the whole index when one field is invalid and shows the offending JSON path under the source in **Manage index sources…**.

## 4. Direct install without a marketplace

```sh
# npm
dsh plugin --profile web add dsh-spend-tracker

# GitHub
dsh plugin --profile web add github:Broklam/dsh-spend-tracker

# local clone
dsh plugin --profile web add ./dsh-spend-tracker
```

In the Desktop app, open **Plugins → Add plugin** and pick the package directory instead.
