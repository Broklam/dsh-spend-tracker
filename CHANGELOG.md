# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.2]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.1.2
[0.1.1]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.1.1
[0.1.0]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.1.0
