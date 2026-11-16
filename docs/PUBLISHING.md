# Publishing and marketplace submission

DeepSeek Harness has no central plugin store. There are three places a plugin can be discovered, and this repository is set up for all of them:

1. **DSH Discover tab** — any static JSON *index* that a user adds with **Plugins → Discover → Add index source**. This is the official mechanism, and this repo ships an index plus a GitHub Pages workflow.
2. **DSH Plugin Hub** ([dsh-plugin.org](https://dsh-plugin.org)) — a community directory. Public repositories tagged `dsh-plugin` are indexed automatically; npm-published packages can then be installed by name from **Plugins → Add plugin**.
3. **Direct install** — npm, GitHub, or a local clone, without any marketplace.

Profiles matter for every install command below: the Desktop app runs the `desktop` profile, and `dsh web` runs the `web` profile. The hub's install command uses the `web` profile, so the submission text keeps that form, while Desktop users install from **Plugins → Add plugin** or with `dsh plugin --profile desktop add …`.

## 1. Publish to npm

The package name `dsh-spend-tracker` is unclaimed, and the package needs no build step. The published files are `index.js`, `projection.js`, `pricing.js`, `client.js`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, the README and CHANGELOG, and `docs`/`marketplace`, as listed in `files`. You need Node.js 22 or newer with the npm CLI.

```sh
npm login
npm publish
```

`publishConfig.access` is `public`, and the package is not private. Verify the result with `npm view dsh-spend-tracker version`.

Once published, the npm install works as written:

```sh
dsh plugin --profile web add dsh-spend-tracker      # dsh web
dsh plugin --profile desktop add dsh-spend-tracker  # Desktop, from a terminal
```

To cut a release, bump `version` in [`package.json`](../package.json), update [`CHANGELOG.md`](../CHANGELOG.md), commit, then publish and tag. These commands need the GitHub CLI (`gh`) in addition to npm:

```sh
VERSION=$(node -p "require('./package.json').version")
npm publish
git tag "v$VERSION"
git push origin "v$VERSION"
gh release create "v$VERSION" --generate-notes
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

1. Keep the npm publish from step 1 current. Without an npm package the site still lists the repository, but one-command installs by package name are not available from **Plugins → Add plugin**.
2. Open a submission issue in [dshplugin/dsh-plugin-hub](https://github.com/dshplugin/dsh-plugin-hub/issues/new) to have the listing reviewed, using the template from [dsh-plugin.org/submit](https://dsh-plugin.org/submit). Use this issue title:

```text
[Plugin submission] Broklam/dsh-spend-tracker — see what the open chat has spent, broken down by tokens, cache, activity, and model
```

and this issue body:

```markdown
### Repository
https://github.com/Broklam/dsh-spend-tracker

### One-line value
Estimates what the open chat has spent, using DeepSeek's peak or off-peak rate for each request, and breaks it down by token bucket, cache hit, activity, and model.

### Category
UI & Experience

### Install command
dsh plugin --profile web add dsh-spend-tracker

### Compatibility
DeepSeek Harness >= 0.2.2-rc.1 < 0.3.0; Desktop and web profiles; no runtime dependencies.

### License
MIT

### Screenshots / demo
Example panel output and the rendering rules are in the README. Add a screenshot of the reading under the input box before submitting.

### Notes
Local estimates only. The sole network request is a background HTTPS GET for DeepSeek's public pricing page (no credentials, no session data, no telemetry); prices come from that page when it is reachable and from a bundled table otherwise. Each request is priced at the published peak or off-peak rate for the time its usage settled.

### Pre-submission checklist
- [x] Repository is public
- [x] GitHub topic `dsh-plugin` added
- [x] README includes the install command
- [x] Plugin exports an `apply(ctx)` module
- [x] Repository root includes a `package.json`
```

After listing, the detail page is `https://dsh-plugin.org/plugins/Broklam/dsh-spend-tracker`. Add the badge to the README:

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/Broklam/dsh-spend-tracker)
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
  "version": "0.2.0",
  "publishTimestamp": 1794834000,
  "source": { "type": "npm" },
  "engines": { "dsh": ">=0.2.2-rc.1 <0.3.0" }
}
```

A Git source stays useful before an npm release or for a pinned commit. The commit must be the full 40-character sha, and the package is at the repository root, so no `path` is needed:

```json
{
  "version": "0.2.0",
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

In the Desktop app, open **Plugins → Add plugin** and pick the package directory instead; the Desktop app runs the `desktop` profile.
