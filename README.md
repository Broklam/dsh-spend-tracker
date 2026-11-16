# Session spend

[![CI](https://github.com/Broklam/dsh-spend-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/Broklam/dsh-spend-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

See what the chat you have open has spent so far, and where that spend went.

Session spend is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin. It adds one estimated spend reading to the small stats row under the message box, beside the built-in turns/steps and token readings. Click the reading for a breakdown by token bucket, cache hit, activity count, and model.

![The plugin icon](icon.svg)

## What it shows

A single reading: `≈$0.67`. The tilde marks an estimate. A session with no provider-reported usage shows nothing; a session on a model with no configured price shows its token count instead, so an unknown price never reads as zero spend.

Clicking the reading opens a panel with:

| Section | Rows |
| --- | --- |
| Estimated spend | Total, input, cache read, cache write, output, reasoning, cache hit |
| Activity | Turns, steps, tool calls, tool errors, retries, compactions |
| By model | Spend and tokens per model, when more than one was billed |

A row appears when it has data; turns, steps, and tool calls are always shown. Escape, a click outside, or activating another stats control closes the panel.

Example output from one session:

```text
Session spend                                      $0.67
─────────────────────────────────────────────────────────
Estimated spend
Total                                       $0.67 · 62,341,069
Input                                       $0.0785 · 261,752
Cache read                                   $0.371 · 61,895,936
Output                                         $0.22 · 183,381
Cache hit                                          99.6%

Activity
Turns                                                   3
Steps                                                 249
Tool calls                                            290
Retries                                                 9

Estimated from the configured price table, not a billed amount.
Shipped rates are DeepSeek peak rates; off-peak usage bills about half.
```

## Install

Requirements: DeepSeek Harness 0.2.2-rc.1 up to, but not including, 0.3.0, with the web UI (the Desktop app and `dsh web` both include it), and pnpm for CLI profile installs.

### Desktop app

1. Open **Plugins**.
2. Choose **Add plugin** and select this package's directory.
3. Turn the **Session spend** row on.

The Desktop app runs the `desktop` profile. To install from a terminal instead, name that profile:

```sh
dsh plugin --profile desktop add dsh-spend-tracker                                  # npm, once published
dsh plugin --profile desktop add github:Broklam/dsh-spend-tracker                   # this repository
dsh plugin --profile desktop add ./dsh-spend-tracker                                # a local clone
```

Once the package is published to npm, **Settings → Plugin Hub** also installs it without a terminal.

### Web profile (CLI)

```sh
# npm, once published
dsh plugin --profile web add dsh-spend-tracker

# this repository
dsh plugin --profile web add github:Broklam/dsh-spend-tracker

# a local clone
dsh plugin --profile web add ./dsh-spend-tracker
```

The package ships plain JavaScript, so no build step or install-build permission is involved. After installing, open a chat with at least one completed model call; the reading appears after the first settled response. Disable the row to remove the reading and stop the statistics.

## Configure prices

Spend is computed from token counts and a price table in units of your currency per million tokens. The shipped table holds the official [DeepSeek peak-hour rates](https://api-docs.deepseek.com/quick_start/pricing) for the two models the current DeepSeek adapter offers:

| Model | Input (cache miss) | Cache read | Cache write | Output |
| --- | --- | --- | --- | --- |
| `deepseek-flash` | 0.30 | 0.006 | 0.30 | 1.20 |
| `deepseek-v4-pro` | 1.32 | 0.044 | 1.32 | 3.96 |

DeepSeek publishes three rates: cache-hit input, cache-miss input, and output. The cache-write column repeats the cache-miss rate because that is what a written prefix is billed at; DeepSeek currently reports no cache-write tokens.

Override or extend the table in your profile's `cordis.patch.yml`:

```yaml
- id: spend-tracker
  name: dsh-spend-tracker
  config:
    currencySymbol: '$'
    decimals: 4
    pricing:
      # A new route needs all four rates: no other model's numbers are borrowed.
      openai/gpt-5:
        input: 1.25
        cacheRead: 0.125
        cacheWrite: 1.25
        output: 10
      # A shipped model may set only the rates you want to change.
      deepseek-flash:
        output: 1.30
    # Prices every route no `pricing` key matches. Must be complete; omit the
    # key, or set it to null, to leave unmatched models unpriced.
    defaultPricing:
      input: 1
      cacheRead: 0.1
      cacheWrite: 1
      output: 4
```

Keys match as `provider/model` first, then as a bare model id, so one `deepseek-flash` entry covers every provider that serves it. An entry for a shipped model inherits the rest of that model's shipped rates. Another route inherits from `defaultPricing` when it is set, and must supply all four rates otherwise. A malformed entry is ignored with a warning in the host log, and its route stays unpriced, so a typo never bills at borrowed rates.

Prices are read when a session is rendered, so editing the table also reprices past sessions. The panel stops printing the peak-rate caveat as soon as you reprice a shipped model, because the table is then yours.

## How the estimate is computed

- Usage comes from the provider's own accounting on each settled assistant message. A retried attempt stays billable: the attempt that streamed before the retry keeps its tokens, and the retried settlement adds, which matches the built-in token counter. Compaction summaries count as their own calls.
- Spend is `tokens × price ÷ 1,000,000` for each of input, cache read, cache write, and output, summed over the models the session used.
- Reasoning tokens are reported separately and **not** charged: providers bill them inside output tokens.
- A fork inherits its parent's spend prefix, the same way the built-in token counter does.

This is an estimate, not an invoice. Search and fetch calls, file parsing, speech, subscription plans, bonus credit, currency conversion, and time-of-day pricing are not modelled.

## Privacy

The plugin makes no network requests, reads no credentials, and sends nothing anywhere. It folds usage that is already in the session log you control, and the result stays in memory and in the local projection cache. It has no account, telemetry, or update channel.

## Compatibility

| Item | Detail |
| --- | --- |
| DeepSeek Harness | `>=0.2.2-rc.1 <0.3.0` (declared in `engines.dsh`) |
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
- [`projection.js`](projection.js) is the pure fold: usage events in, token, call, and activity totals out; spend is derived when the value is rendered.
- [`client.js`](client.js) registers the reading and its panel, with English and Simplified Chinese copy.
- Projection state is checkpointed and versioned, validated on restore, and excluded from session summaries, so the sidebar list carries nothing extra.

## Development

```sh
node --check index.js && node --check projection.js && node --check client.js
node --test test/projection.test.mjs
```

The tests cover retry bills, per-model attribution, unpriced models, compaction calls, activity counters, state validation, and the wire contract. There are no runtime dependencies to install.

## Marketplaces

- **DSH Discover tab**: this repository publishes a format-1 plugin index at `https://broklam.github.io/dsh-spend-tracker/index.json`. Enable **Custom plugin indexes**, open **Plugins → Discover → Add index source**, and paste that URL. The index lives in [`marketplace/index.json`](marketplace/index.json) and pins each listed release commit.
- **DSH Plugin Hub** ([dsh-plugin.org](https://dsh-plugin.org)): the community directory indexes public repositories tagged `dsh-plugin`, and lists npm-published plugins in the in-app Plugin Hub for one-click install.

[docs/PUBLISHING.md](docs/PUBLISHING.md) covers both submission paths step by step, including the npm release that puts the plugin in the in-app Plugin Hub.

## License

[MIT](LICENSE)
