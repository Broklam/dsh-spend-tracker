# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-11-16

Initial release.

### Added

- `sessionSpend` session projection: a replayable fold of provider-reported usage into estimated cost plus token, call, and activity totals, with per-model attribution, retry replacement, and compaction summary calls.
- Composer-dock reading under the message box, marked `≈` as an estimate, with a token-count fallback for models without a configured price.
- Click-open breakdown: spend and tokens per bucket, cache hit, turns, steps, tool calls and errors, retries, compactions, and the per-model split.
- Configurable per-million-token price table with shipped DeepSeek peak rates for `deepseek-flash` and `deepseek-v4-pro`, plus a `defaultPricing` fallback for other providers.
- English and Simplified Chinese copy.
- Format-1 DSH plugin index and GitHub Pages workflow for the Discover tab.
- Unit tests for the fold, state validation, and wire contract.

[0.1.0]: https://github.com/Broklam/dsh-spend-tracker/releases/tag/v0.1.0
