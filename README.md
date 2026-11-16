# Session spend

[![CI](https://github.com/Broklam/dsh-spend-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/Broklam/dsh-spend-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

See what the chat you have open has cost so far, and where the spend went.

Session spend is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin. It adds one estimated amount to the small stats row under the message box, beside the built-in turns/steps and token readings. Click the amount for a breakdown by token bucket, cache hit, activity count, and model.

![The plugin icon](icon.svg)

## What it shows

A single reading: `≈$0.463`. The tilde marks an estimate. A session with no provider-reported usage shows nothing; a session on a model with no configured price shows its token count instead, so an unknown price never reads as zero spend.

Clicking the reading opens a panel with:

| Section | Rows |
| --- | --- |
| Estimated spend | Total, input, cache read, cache write, output, reasoning, cache hit |
| Activity | Turns, steps, tool calls, tool errors, retries, compactions |
| By model | Cost and tokens per model, when more than one was billed |

Empty rows stay out of the panel, so a short session reads short. Escape, a click outside, and moving to another stats control all close it.

Example figures from a real session:

```text
Session spend                                    $0.463
────────────────────────────────────────────────────────
Estimated spend
Total                                     $0.463 · 40,672,926
Input                                    $0.0675 · 224,908
Cache read                                 $0.242 · 40,319,616
Output                                     $0.154 · 128,402
Cache hit                                          99.4%

Activity
Turns                                                   2
Steps                                                 192
Tool calls                                            217
Retries                                                 9

Estimated from the configured price table, not a billed amount.
Shipped rates are DeepSeek peak rates; off-peak usage bills about half.
```

## Install

Requirements: DeepSeek Harness 0.2.2-rc.1 or newer, with the web UI (the Desktop app and `dsh web` both include it), and pnpm for profile installs.

From npm, once published:

```sh
dsh plugin --profile web add dsh-spend-tracker
```

From a clone, in the Desktop app:

1. Open **Plugins**.
2. Choose **Add plugin** and select the cloned `dsh-spend-tracker` directory.
3. Turn the **Session spend** row on.

From a clone, in a CLI profile:

```sh
git clone https://github.com/Broklam/dsh-spend-tracker.git
dsh plugin --profile web add ./dsh-spend-tracker
```

Install straight from GitHub with `dsh plugin --profile web add github:Broklam/dsh-spend-tracker`. The package ships plain JavaScript, so no build step or install permission is involved.

After installing, open a chat with at least one completed model call. The reading appears under the message box after the first settled response. Disable the row to remove the reading and stop the statistics.

## Configure prices

Cost is computed from token counts and a price table in units of your currency per million tokens. The shipped table holds the official [DeepSeek peak-hour rates](https://api-docs.deepseek.com/quick_start/pricing) for the two models the current DeepSeek adapter offers:

| Model | Input (cache miss) | Cache read | Cache write | Output |
| --- | --- | --- | --- | --- |
| `deepseek-flash` | 0.30 | 0.006 | 0.30 | 1.20 |
| `deepseek-v4-pro` | 1.32 | 0.044 | 1.32 | 3.96 |

Override a model, price another provider, or replace the fallback in your profile's `cordis.patch.yml`:

```yaml
- id: spend-tracker
  name: dsh-spend-tracker
  config:
    currencySymbol: '$'
    decimals: 4
    pricing:
      deepseek-v4-pro:
        input: 1.32
        cacheRead: 0.044
        cacheWrite: 1.32
        output: 3.96
      openai/gpt-5:
        input: 1.25
        cacheRead: 0.125
        cacheWrite: 1.25
        output: 10
    # Prices every route no `pricing` key matches. Omit, or set null, to leave
    # unmatched models unpriced.
    defaultPricing:
      input: 1
      cacheRead: 0.1
      cacheWrite: 1
      output: 4
```

Keys match as `provider/model` first, then as a bare model id, so one `deepseek-flash` entry covers every provider that serves it. A partial entry inherits its remaining fields from the shipped table. Prices are read when the session is rendered, so editing them also reprices past sessions.

The panel stops printing the peak-rate caveat as soon as you reprice a shipped model, because the table is then yours.

## How the estimate is computed

- Usage comes from the provider's own accounting on each settled assistant message. A retried attempt replaces the sample it supersedes instead of adding a second one, and compaction summaries count as their own billable calls.
- Cost is `tokens × price ÷ 1,000,000` for each of input, cache read, cache write, and output, summed over the models the session used.
- Reasoning tokens are reported separately and **not** charged: providers bill them inside output tokens.
- A fork inherits its parent's spend prefix, the same way the built-in token counter does.

This is an estimate, not an invoice. Search and fetch calls, file parsing, speech, subscription plans, bonus credit, currency conversion, and time-of-day pricing are not modelled.

## Privacy

The plugin makes no network requests, reads no credentials, and sends nothing anywhere. It folds usage that is already in the session log you control, and the result stays in memory and in the local projection cache. It has no account, telemetry, or update channel.

## Compatibility

| Item | Detail |
| --- | --- |
| DeepSeek Harness | `>=0.2.2-rc.1` (declared in `engines.dsh`) |
| Profiles | Desktop and web |
| UI surfaces | Composer dock entry `spend` in `conversation.composer.dock` |
| Dependencies | None at runtime; React and React DOM come from the app |
| Permissions | None; no tools, no shell, no files outside the profile |
| Disable | Turn the row off; the reading disappears and the statistics stop |

## How it works

```text
session events ──► sessionSpend projection (Host) ──► wire view ──► composer dock reading + panel (Browser)
```

- [`index.js`](index.js) registers the `sessionSpend` session projection.
- [`projection.js`](projection.js) is the pure fold: usage events in, token, call, and activity totals out; cost is derived when the value is rendered.
- [`client.js`](client.js) registers the reading and its panel, with English and Simplified Chinese copy.
- `projection` state is checkpointed and versioned, validated on restore, and excluded from session summaries so the sidebar list carries nothing extra.

## Development

```sh
node --test test/projection.test.mjs   # unit tests for the fold
node --check index.js projection.js client.js
```

The tests cover retry replacement, per-model attribution, unpriced models, compaction calls, activity counters, state validation, and the wire contract. There are no runtime dependencies to install.

## Marketplaces

- **DSH Discover tab**: this repository publishes a format-1 plugin index at `https://broklam.github.io/dsh-spend-tracker/index.json`. Enable **Custom plugin indexes**, open **Plugins → Discover → Add index source**, and paste that URL. The index lives in [`marketplace/index.json`](marketplace/index.json) and pins an exact release.
- **DSH Plugin Hub** ([dsh-plugin.org](https://dsh-plugin.org)): the community directory indexes public repositories tagged `dsh-plugin`, and lists npm-published plugins in the in-app Plugin Hub for one-click install.

[docs/PUBLISHING.md](docs/PUBLISHING.md) covers both submission paths step by step, including the npm release that puts the plugin in the in-app Plugin Hub.

## License

[MIT](LICENSE)
