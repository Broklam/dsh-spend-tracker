# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The estimate's provenance, the off-peak saving, and the price-table freshness now sit behind a collapsed **About this estimate** row, so the panel opens on the figures and the notes stay out of the way until opened.
- The panel title names the figure as an estimate: **Session spend (estimated)**.

## [0.2.2] — 2026-11-16

### Fixed

- The panel now honors the host's window-chrome top inset in windowed Desktop: the host value is a `calc()` expression, so it is measured with a probe box instead of parsed from the serialized custom property.
- Keyboard focus moves into the panel once it is visible, and returns to the reading when it closes.
- The off-peak label shows the percentage actually charged, including a fetched table with its own per-model off-peak rows; when those rows disagree, the label omits the percentage instead of naming a wrong one.
- Discount prose such as "25% of peak" or "25% of the list price" is read as a price share, not as "25% off"; a leading "Off-peak hours are…" sentence can no longer hijack the peak-hours footnote.
- The missing-holiday-year warning also runs when `pricingSource` is `off` and when only other `offPeak` fields are configured.
- An oversized pricing response is refused before its body is buffered.

### Changed

- Tests cover the chrome-inset probe, mixed-percentage status, the discount wordings, above-placement headroom, and the provider-failure path.

## [0.2.1] — 2026-11-16

### Fixed

- A user-configured off-peak discount is now applied to every table, including a freshly fetched one whose own off-peak rows differ, so the status line and the charged rate agree.
- The off-peak saving note is computed from the actual tier prices rather than the discount fraction, so per-model off-peak rows and overrides are reported correctly.
- The panel header now sticks to the top of its scroll area and shares the rows' width, so the title and values stay aligned and visible while long content scrolls.
- Escape now stops propagation, so closing the panel does not also trigger a host shortcut.

### Changed

- README documents the refresh options (`pricingSource`, `refreshHours`, `pricingUrl`), their ranges and defaults, and the fixed request headers.
- A configured rate that is present but non-numeric is reported as a warning instead of being silently ignored.

## [0.2.0] — 2026-11-16

### Added

- Peak and off-peak pricing from DeepSeek's published schedule. Each usage settlement is classified by its own UTC timestamp, so it bills at the peak rate or at the published off-peak discount for that moment; a session that spans a boundary pays the right rate on each side.
- A rate-status line in the panel: the tier in effect, the off-peak discount when it applies, and the time until the next change, refreshed every 30 seconds while the panel is open.
- The price table refreshes from DeepSeek's pricing document once at startup and every `refreshHours` (default six), through the Host's web capability. A failed fetch or an unreadable page leaves the previous table in place, writes a warning to the host log, and is retried after 15 minutes (up to three times) before returning to the normal period. `pricingSource: 'off'` keeps everything offline.
- Weekday Chinese public holidays for 2026 and 2027 are bundled, so holiday pricing follows the published rule; `offPeak.holidays` replaces the list.
- `offPeak` configuration for the discount, UTC peak windows, holidays, and disabling time-of-day pricing entirely.

### Changed

- Existing session totals are recomputed once from the session log after upgrading, because usage is now tracked per peak and off-peak tier.
- A refreshed price table reprices the session on the next read, with no state rewrite. While a session is open and idle, the current reading keeps its previous prices until the session's next activity or reopen.
- An override that sets only some rates now follows the refreshed table for the rest, instead of freezing the other fields at activation time.
- Notes: the estimate line names DeepSeek's prices, an off-peak line reports what the discount saved, and a rate-source line reports when the table was last refreshed.

### Fixed

- The panel no longer crawls upward while values update, and it no longer scrolls away from a bottom-docked pill when its content grows.
- A "25% off" discount is now billed as 25% off rather than as 75% of peak.

## [0.1.3] — 2026-11-16

### Fixed

- A rate entry that is not an object is ignored with a warning instead of silently reusing another model's rates.

### Changed

- `scripts/validate-index.mjs` is the one index check, and both the CI and Pages workflows run it before publishing. It covers names, versions, timestamps, source shapes, engine ranges, duplicates, and the icon file.
- Documentation: `defaultPricing` inheritance is stated, Desktop install commands name the `desktop` profile explicitly, and the hub submission template separates the issue title from its body.

## [0.1.2] — 2026-11-16

### Fixed

- The projection state version is now 2, so a checkpoint written under the 0.1.1 retry rule is discarded and refolded from the session log. Without it, sessions that had streamed before a retry kept the earlier, lower totals after upgrading.

## [0.1.1] — 2026-11-16

Documentation and correctness follow-up to the first release.

### Fixed

- A retried model attempt now stays billable: the attempt that streamed before `llm/retry-started` keeps its tokens, and the retried settlement adds instead of replacing it. The fold now matches the built-in token counter exactly on retried steps.
- The panel no longer borrows one model's rates for a different route: a new route needs all four rates (or a complete `defaultPricing`), and a malformed table is ignored with a warning instead of pricing silently.
- `engines.dsh` is bounded to `>=0.2.2-rc.1 <0.3.0`, so a future breaking DSH release is not claimed as compatible.
- The plugin index is validated more strictly in CI, and the Pages workflow refuses to deploy an index-less artifact.

### Changed

- README and publishing guide: profile-specific install commands, exact marketplace submission template, explicit rate-inheritance rules, and corrected retry and cache-write wording.

## [0.1.0] — 2026-11-16

Initial release.

### Added

- `sessionSpend` session projection: a replayable fold of provider-reported usage into estimated cost plus token, call, and activity totals, with per-model attribution, retry handling, and compaction summary calls.
- Composer-dock reading under the message box, marked `≈` as an estimate, with a token-count fallback for models without a configured price.
- Click-open breakdown: spend and tokens per bucket, cache hit, turns, steps, tool calls and errors, retries, compactions, and the per-model split.
- Configurable per-million-token price table with shipped DeepSeek peak rates for `deepseek-flash` and `deepseek-v4-pro`, plus a `defaultPricing` fallback for other providers.
- English and Simplified Chinese copy.
- Format-1 DSH plugin index and GitHub Pages workflow for the Discover tab.
- Unit tests for the fold, state validation, and wire contract.

[0.2.2]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.2.2
[0.2.1]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.2.1
[0.2.0]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.2.0
[0.1.3]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.1.3
[0.1.2]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.1.2
[0.1.1]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.1.1
[0.1.0]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.1.0
