/** Unit checks for the pure `sessionSpend` fold; run with `node --test test/`. */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BUILTIN_RATES,
  applyRemotePricing,
  buildView,
  createProjectionDefinition,
  normalizeConfig,
} from '../projection.js'

/** Monday 2026-11-16 02:00 UTC: inside the 01:00-04:00 peak window. */
const PEAK = Date.parse('2026-11-16T02:00:00Z')
/** Monday 2026-11-16 05:00 UTC: between the two peak windows. */
const OFF_PEAK = Date.parse('2026-11-16T05:00:00Z')
/** Thursday 2026-10-01 02:00 UTC: Chinese National Day, so off-peak in full. */
const HOLIDAY = Date.parse('2026-10-01T02:00:00Z')

const config = normalizeConfig(undefined)

/** Compare money at the view's 1e-6 rounding scale. */
function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`)
}

/** One durable assistant settlement with provider usage and an explicit route. */
function assistant(turn, step, usage, provider = 'deepseek-account', model = 'deepseek-flash', time = PEAK) {
  return {
    type: 'assistant/message',
    time,
    data: {
      turn,
      step,
      message: { role: 'assistant', source: { kind: 'model', provider, model } },
      stream: [],
      usage,
    },
  }
}

/** Fold a whole event list from the unit's initial state. */
function fold(events, unit = createProjectionDefinition(config)) {
  return events.reduce((state, event) => unit.apply(state, event), unit.init())
}

/** Run events through the unit and validate its wire output on the way out. */
function wire(events, resolved = config) {
  const unit = createProjectionDefinition(resolved)
  const state = fold(events, unit)
  return { state, view: unit.wire.viewSchema.parse(unit.wire.view(state)) }
}

/** The shipped peak price of one unit bucket for a shipped model. */
function peakRate(model, field = 'input') {
  return BUILTIN_RATES[model][field]
}

test('a peak-hour settlement is priced from its reported usage', () => {
  const { state, view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }),
  ])
  assert.equal(state.calls, 1)
  assert.equal(view.cost, peakRate('deepseek-flash'))
  assert.equal(view.costPeak, peakRate('deepseek-flash'))
  assert.equal(view.costOffPeak, 0)
  assert.equal(view.tokens.input, 1_000_000)
  assert.equal(view.tokens.total, 1_000_000)
  assert.equal(view.pricedCalls, 1)
  assert.equal(view.unpricedCalls, 0)
  assert.equal(view.models.length, 1)
  assert.equal(view.models[0].route, 'deepseek-account/deepseek-flash')
  assert.equal(view.models[0].priced, true)
})

test('an off-peak settlement bills at the published discount', () => {
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ])
  assert.equal(view.costPeak, 0)
  assert.equal(view.costOffPeak, peakRate('deepseek-flash') / 2)
  assert.equal(view.cost, peakRate('deepseek-flash') / 2)
})

test('a Chinese public holiday bills off-peak in full', () => {
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', HOLIDAY),
  ])
  assert.equal(view.costPeak, 0)
  assert.equal(view.costOffPeak, peakRate('deepseek-flash') / 2)
})

test('a session that spans the boundary splits peak and off-peak cost', () => {
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', PEAK),
    assistant(1, 2, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ])
  assert.equal(view.costPeak, peakRate('deepseek-flash'))
  assert.equal(view.costOffPeak, peakRate('deepseek-flash') / 2)
  closeTo(view.cost, peakRate('deepseek-flash') * 1.5)
  assert.equal(view.costInput, view.cost)
  assert.equal(view.calls, 2)
})

test('off-peak pricing can be switched off, billing everything at peak', () => {
  const peakOnly = normalizeConfig({ offPeak: false })
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ], peakOnly)
  assert.equal(view.costPeak, peakRate('deepseek-flash'))
  assert.equal(view.costOffPeak, 0)
  assert.equal(view.schedule.enabled, false)
})

test('a repeated settlement for the same step replaces the earlier sample', () => {
  const { state, view } = wire([
    assistant(1, 1, { inputTokens: 100, outputTokens: 10 }),
    assistant(1, 1, { inputTokens: 200, outputTokens: 20 }),
  ])
  assert.equal(state.calls, 1)
  assert.equal(view.tokens.input, 200)
  assert.equal(view.tokens.output, 20)
})

test('a replacement across the tier boundary moves the whole sample', () => {
  const { state, view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }),
    assistant(1, 1, { inputTokens: 2_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ])
  assert.equal(state.calls, 1)
  assert.equal(view.costPeak, 0)
  assert.equal(view.costOffPeak, peakRate('deepseek-flash'))
  assert.equal(view.tokens.input, 2_000_000)
})

test('a retried attempt stays billable, so both attempts count', () => {
  // Matches the host tokenUsage unit: retry-started closes the replacement slot,
  // and the retried attempt's settlement adds instead of replacing. The two
  // attempts may land in different pricing tiers.
  const { state, view } = wire([
    assistant(2, 1, { inputTokens: 500, outputTokens: 50 }),
    { type: 'llm/retry-started', time: PEAK, data: { turn: 2, step: 1, retry: 1 } },
    assistant(2, 1, { inputTokens: 600, outputTokens: 60 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ])
  assert.equal(view.retries, 1)
  assert.equal(state.calls, 2)
  assert.equal(view.tokens.input, 1100)
  assert.equal(view.tokens.output, 110)
  assert.equal(view.models[0].calls, 2)
  assert.ok(view.costPeak > 0 && view.costOffPeak > 0)
})

test('samples from different steps accumulate', () => {
  const { view } = wire([
    assistant(1, 1, { inputTokens: 100, outputTokens: 10 }),
    assistant(1, 2, { inputTokens: 200, outputTokens: 20 }),
  ])
  assert.equal(view.tokens.input, 300)
  assert.equal(view.calls, 2)
})

test('an attempt without a message is priced under the logged request route', () => {
  const { view } = wire([
    { type: 'request/header', time: PEAK, data: { header: { config: { provider: 'deepseek-account', model: 'deepseek-v4-pro' } }, reason: 'initial' } },
    {
      type: 'assistant/attempt',
      time: PEAK,
      data: {
        turn: 1,
        step: 1,
        stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 0 } } }],
      },
    },
  ])
  assert.equal(view.models[0].route, 'deepseek-account/deepseek-v4-pro')
  assert.equal(view.cost, peakRate('deepseek-v4-pro'))
})

test('cache buckets are charged at their own rates, off-peak included', () => {
  const { view } = wire([
    assistant(1, 1, {
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 1_000_000,
    }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ], normalizeConfig({ pricing: { 'deepseek-flash': { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 } } }))
  assert.equal(view.cost, 5)
  assert.equal(view.costInput, 0.5)
  assert.equal(view.costCacheRead, 1)
  assert.equal(view.costCacheWrite, 1.5)
  assert.equal(view.costOutput, 2)
  assert.equal(view.tokens.total, 4_000_000)
})

test('an unpriced model reports tokens instead of a fabricated cost', () => {
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1000, outputTokens: 100 }, 'other-provider', 'mystery-model'),
  ])
  assert.equal(view.cost, 0)
  assert.equal(view.pricedCalls, 0)
  assert.equal(view.unpricedCalls, 1)
  assert.equal(view.unpricedTokens, 1100)
  assert.equal(view.models[0].priced, false)
})

test('defaultPricing prices a route missing from the table, at both tiers', () => {
  const resolved = normalizeConfig({ defaultPricing: { input: 0.5, cacheRead: 0.05, cacheWrite: 0.5, output: 2 } })
  const peak = wire([
    assistant(1, 1, { inputTokens: 2_000_000, outputTokens: 0 }, 'other-provider', 'mystery-model'),
  ], resolved)
  assert.equal(peak.view.cost, 1)
  assert.equal(peak.view.unpricedCalls, 0)
  const off = wire([
    assistant(1, 1, { inputTokens: 2_000_000, outputTokens: 0 }, 'other-provider', 'mystery-model', OFF_PEAK),
  ], resolved)
  assert.equal(off.view.cost, 0.5)
})

test('an incomplete defaultPricing is ignored with a warning', () => {
  const resolved = normalizeConfig({ defaultPricing: { input: 0.5 } })
  assert.equal(resolved.fallback, null)
  assert.equal(resolved.warnings.length, 1)
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000, outputTokens: 10 }, 'other-provider', 'mystery-model'),
  ], resolved)
  assert.equal(view.unpricedCalls, 1)
})

test('a new route needs all four rates instead of borrowing another model\'s', () => {
  const resolved = normalizeConfig({ pricing: { 'openai/gpt-5': { input: 1.25 } } })
  assert.equal(resolved.warnings.length, 1)
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'openai', 'gpt-5'),
  ], resolved)
  assert.equal(view.unpricedCalls, 1)
  assert.equal(view.cost, 0)
})

test('a partial override of a shipped model inherits that model\'s own rates', () => {
  const resolved = normalizeConfig({ pricing: { 'deepseek-v4-pro': { output: 8 } } })
  assert.deepEqual(resolved.warnings, [])
  assert.deepEqual(resolved.userPricing['deepseek-v4-pro'], { output: 8 })
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'deepseek-account', 'deepseek-v4-pro'),
  ], resolved)
  assert.equal(view.cost, peakRate('deepseek-v4-pro') + 8)
  const off = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'deepseek-account', 'deepseek-v4-pro', OFF_PEAK),
  ], resolved)
  assert.equal(off.view.cost, peakRate('deepseek-v4-pro') / 2 + 4)
})

test('a user override still follows refreshed prices for the fields it leaves alone', () => {
  const resolved = normalizeConfig({ pricing: { 'deepseek-flash': { output: 8 } } })
  applyRemotePricing(resolved, {
    models: {
      'deepseek-flash': {
        peak: { input: 2, cacheRead: 0.02, output: 10 },
        offPeak: { input: 1, cacheRead: 0.01, output: 5 },
      },
    },
    schedule: null,
  }, { url: 'https://example.test/pricing.md', updatedAt: 2 })
  const peak = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'deepseek-account', 'deepseek-flash'),
  ], resolved)
  assert.equal(peak.view.cost, 2 + 8, 'input follows the refreshed table, output keeps the override')
  const off = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ], resolved)
  assert.equal(off.view.cost, 1 + 4, 'off-peak follows the peak override at the published discount')
})

test('a compaction summary is charged as its own summarize call at its own tier', () => {
  const { view } = wire([
    { type: 'compaction/start', time: PEAK, data: { compactionId: 'c1', turn: 1 } },
    {
      type: 'compaction/summary',
      time: OFF_PEAK,
      data: {
        compactionId: 'c1',
        provider: 'deepseek-account',
        model: 'deepseek-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      },
    },
    { type: 'compaction/end', time: OFF_PEAK, data: { compactionId: 'c1', turn: 1 } },
  ])
  assert.equal(view.compactions, 1)
  assert.equal(view.calls, 1)
  assert.equal(view.cost, peakRate('deepseek-flash') / 2)
})

test('activity counters fold turns, steps, tools, and tool errors', () => {
  const { view } = wire([
    { type: 'step/start', time: PEAK, data: { turn: 1, step: 1 } },
    { type: 'step/end', time: PEAK, data: { turn: 1, step: 1 } },
    { type: 'step/start', time: PEAK, data: { turn: 1, step: 2 } },
    { type: 'step/end', time: PEAK, data: { turn: 1, step: 2 } },
    { type: 'step/start', time: PEAK, data: { turn: 2, step: 1 } },
    { type: 'step/end', time: PEAK, data: { turn: 2, step: 1 } },
    { type: 'tool/call', time: PEAK, data: { turn: 1, step: 1, callId: 'a', name: 'bash', arguments: '{}' } },
    { type: 'tool/call', time: PEAK, data: { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{}' } },
    { type: 'tool/result', time: PEAK, data: { turn: 1, step: 1, message: { source: { callId: 'a' }, isError: true } } },
    { type: 'tool/result', time: PEAK, data: { turn: 1, step: 1, message: { source: { callId: 'b' } } } },
    { type: 'user/message', time: PEAK, data: { role: 'user' } },
  ])
  assert.equal(view.turns, 2)
  assert.equal(view.steps, 3)
  assert.equal(view.toolCalls, 2)
  assert.equal(view.toolErrors, 1)
})

test('irrelevant events keep the state reference', () => {
  const unit = createProjectionDefinition(config)
  const state = unit.init()
  assert.equal(unit.apply(state, { type: 'user/message', time: PEAK, data: { role: 'user' } }), state)
})

test('an event without a timestamp conservatively bills as peak', () => {
  const { view } = wire([
    { ...assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash'), time: undefined },
  ])
  assert.equal(view.costPeak, peakRate('deepseek-flash'))
})

test('the wire view keeps its reference while the state and prices are unchanged', () => {
  const unit = createProjectionDefinition(config)
  const state = unit.apply(unit.init(), assistant(1, 1, { inputTokens: 10, outputTokens: 1 }))
  assert.equal(unit.wire.view(state), unit.wire.view(state))
})

test('a refreshed price table reprices the same state on the next read', () => {
  const resolved = normalizeConfig(undefined)
  const unit = createProjectionDefinition(resolved)
  const state = unit.apply(unit.init(), assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }))
  const before = unit.wire.view(state)
  assert.equal(before.cost, peakRate('deepseek-flash'))
  assert.equal(before.rates.source, 'shipped')
  assert.equal(before.rates.updatedAt, null)

  const applied = applyRemotePricing(resolved, {
    models: {
      'deepseek-flash': {
        peak: { input: 0.6, cacheRead: 0.012, output: 2.4 },
        offPeak: { input: 0.3, cacheRead: 0.006, output: 1.2 },
      },
    },
    schedule: { windows: [{ days: [1, 2, 3, 4, 5], start: 60, end: 240 }], discount: 0.5 },
  }, { url: 'https://example.test/pricing.md', updatedAt: 1763337600000 })
  assert.equal(applied, true)
  const after = unit.wire.view(state)
  assert.notEqual(after, before)
  assert.equal(after.cost, 0.6)
  assert.equal(after.rates.source, 'deepseek')
  assert.equal(after.rates.updatedAt, 1763337600000)
  assert.deepEqual(after.schedule.windows, [{ days: [1, 2, 3, 4, 5], start: 60, end: 240 }])
  assert.doesNotThrow(() => unit.wire.viewSchema.parse(after))
})

test('a user-configured off-peak schedule survives a price refresh', () => {
  const resolved = normalizeConfig({ offPeak: { discount: 0.25 } })
  const before = resolved.schedule
  applyRemotePricing(resolved, {
    models: { 'deepseek-flash': { peak: { input: 1, cacheRead: 0.1, output: 2 }, offPeak: { input: 0.5, cacheRead: 0.05, output: 1 } } },
    schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 120 }], discount: 0.5 },
  }, { url: 'https://example.test/pricing.md', updatedAt: 1 })
  assert.deepEqual(resolved.schedule, before)
  const off = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ], resolved)
  assert.equal(off.view.costOffPeak, 0.75, 'the user\'s 25% discount wins over the fetched 50% off-peak row')
})

test('an unusable refreshed table leaves the current prices alone', () => {
  const resolved = normalizeConfig(undefined)
  const applied = applyRemotePricing(resolved, { models: null, schedule: {}, warnings: [] }, { url: 'x', updatedAt: 1 })
  assert.equal(applied, false)
  assert.equal(resolved.remote, null)
  assert.equal(resolved.revision, 0)
})

test('restored state is validated strictly', () => {
  const unit = createProjectionDefinition(config)
  const state = fold([assistant(1, 1, { inputTokens: 10, outputTokens: 1 })])
  assert.doesNotThrow(() => unit.stateSchema.parse(state))
  assert.throws(() => unit.stateSchema.parse({ ...state, calls: -1 }), /calls/)
  assert.throws(() => unit.stateSchema.parse({
    ...state,
    models: { x: { calls: 1 } },
  }), /peak/)
  assert.throws(() => unit.stateSchema.parse({ ...state, sample: { turn: 1, step: 1, route: 'a/b' } }), /tier/)
  // Version-2 model entries (flat token fields) are not a valid version-3 state.
  assert.throws(() => unit.stateSchema.parse({
    ...state,
    models: { 'a/b': { calls: 1, input: 5, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 } },
  }), /peak/)
})

test('configured currency and precision reach the wire', () => {
  const { view } = wire([], normalizeConfig({ currencySymbol: '¥', decimals: 2 }))
  assert.equal(view.currencySymbol, '¥')
  assert.equal(view.decimals, 2)
})

test('cost equals the sum of its bucket parts and of its tier parts', () => {
  const { view } = wire([
    assistant(1, 1, { inputTokens: 12_345, cacheReadTokens: 67_890, cacheWriteTokens: 1_234, outputTokens: 5_678 }),
    assistant(1, 2, { inputTokens: 9_876, outputTokens: 4_321 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ])
  const parts = view.costInput + view.costCacheRead + view.costCacheWrite + view.costOutput
  assert.ok(Math.abs(view.cost - parts) < 2e-6)
  assert.ok(Math.abs(view.cost - (view.costPeak + view.costOffPeak)) < 2e-6)
})

test('shipped rates cover both models the DeepSeek adapter catalogs', () => {
  for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
    assert.ok(BUILTIN_RATES[model], `${model} must ship with a rate table`)
  }
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'deepseek-account', 'deepseek-v4-pro'),
  ])
  assert.equal(view.pricedCalls, 1)
  assert.equal(view.cost, BUILTIN_RATES['deepseek-v4-pro'].input + BUILTIN_RATES['deepseek-v4-pro'].output)
})

test('the wire view always carries the schedule and rate source', () => {
  const { view } = wire([])
  assert.equal(view.rates.source, 'shipped')
  assert.equal(view.rates.url, 'https://api-docs.deepseek.com/quick_start/pricing.md')
  assert.equal(view.schedule.enabled, true)
  assert.equal(view.schedule.discount, 0.5)
  assert.deepEqual(view.schedule.windows, [
    { days: [1, 2, 3, 4, 5], start: 60, end: 240 },
    { days: [1, 2, 3, 4, 5], start: 360, end: 600 },
  ])
  assert.ok(view.schedule.holidays.includes('2026-10-01'))
})

test('the model row cap reports how many routes were kept', () => {
  const events = []
  for (let index = 0; index < 11; index += 1) {
    events.push(assistant(1, index + 1, { inputTokens: 10, outputTokens: 1 }, 'provider', `model-${index}`))
  }
  const { view } = wire(events, normalizeConfig({ defaultPricing: { input: 1, cacheRead: 0.1, cacheWrite: 1, output: 4 } }))
  assert.equal(view.modelsTotal, 11)
  assert.equal(view.models.length, 8)
  assert.doesNotThrow(() => createProjectionDefinition(normalizeConfig(undefined)).wire.viewSchema.parse(view))
})

test('the unit declares state version 3 so stale checkpoints refold', () => {
  assert.equal(createProjectionDefinition(config).stateVersion, 3)
})

test('a non-numeric configured rate is reported instead of silently dropped', () => {
  const resolved = normalizeConfig({ pricing: { 'deepseek-flash': { output: '1.30' } } })
  assert.ok(resolved.warnings.some(warning => warning.includes('output')))
  assert.deepEqual(resolved.userPricing['deepseek-flash'], {})
})

test('a non-object pricing entry is ignored instead of reusing other rates', () => {
  const resolved = normalizeConfig({ pricing: { 'deepseek-flash': 5 } })
  assert.equal(resolved.warnings.length, 1)
  assert.equal(resolved.userPricing['deepseek-flash'], undefined)
  assert.equal(resolved.models['deepseek-flash'].output, BUILTIN_RATES['deepseek-flash'].output)
})

test('a partial custom route inherits defaultPricing when one is configured', () => {
  const resolved = normalizeConfig({
    pricing: { 'openai/gpt-5': { input: 1.25 } },
    defaultPricing: { input: 1, cacheRead: 0.1, cacheWrite: 1, output: 4 },
  })
  assert.deepEqual(resolved.warnings, [])
  assert.deepEqual(resolved.userPricing['openai/gpt-5'], { input: 1.25 })
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'openai', 'gpt-5'),
  ], resolved)
  assert.equal(view.cost, 1.25 + 4)
})

test('the wire reports the discount actually charged', () => {
  const plain = wire([])
  assert.equal(plain.view.schedule.offPeakPercent, 50)
  const resolved = normalizeConfig(undefined)
  applyRemotePricing(resolved, {
    models: {
      'deepseek-flash': {
        peak: { input: 1, cacheRead: 0.01, output: 2 },
        offPeak: { input: 0.25, cacheRead: 0.0025, output: 0.5 },
      },
    },
    schedule: null,
  }, { url: 'https://example.test/pricing.md', updatedAt: 3 })
  const off = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ], resolved)
  assert.equal(off.view.schedule.offPeakPercent, 75, 'an off-peak price at 25% of peak is 75% off')
  assert.equal(off.view.costOffPeak, 0.25)
  assert.equal(off.view.saved, 0.75)
})

test('a refreshed off-peak price that differs from the prose discount is used as printed', () => {
  const resolved = normalizeConfig(undefined)
  applyRemotePricing(resolved, {
    models: {
      'deepseek-flash': {
        peak: { input: 1, cacheRead: 0.01, output: 2 },
        offPeak: { input: 0.25, cacheRead: 0.0025, output: 0.5 },
      },
    },
    schedule: null,
  }, { url: 'https://example.test/pricing.md', updatedAt: 3 })
  const off = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ], resolved)
  assert.equal(off.view.costOffPeak, 0.25, 'the table\'s own off-peak row wins over 50%')
  const peak = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash'),
  ], resolved)
  assert.equal(peak.view.costPeak, 1)
})

test('invalid pricing-source options fall back with a warning', () => {
  const resolved = normalizeConfig({ pricingSource: 'sometimes', refreshHours: 0, pricingUrl: 'http://example.test/pricing' })
  assert.equal(resolved.pricingSource, 'deepseek')
  assert.equal(resolved.refreshHours, 6)
  assert.equal(resolved.pricingUrl, 'https://api-docs.deepseek.com/quick_start/pricing.md')
  assert.equal(resolved.warnings.length, 3)
})

test('a malformed off-peak block warns but keeps the published schedule', () => {
  const resolved = normalizeConfig({ offPeak: { windows: [{ days: [9] }] } })
  assert.equal(resolved.warnings.length, 1)
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ], resolved)
  assert.equal(view.costOffPeak, peakRate('deepseek-flash') / 2)
})

test('custom peak windows reclassify an instant', () => {
  const resolved = normalizeConfig({ offPeak: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }] } })
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-account', 'deepseek-flash', OFF_PEAK),
  ], resolved)
  assert.equal(view.costPeak, peakRate('deepseek-flash'))
})

test('buildView is exported for callers that hold a state directly', () => {
  const unit = createProjectionDefinition(config)
  const state = unit.apply(unit.init(), assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0 }))
  const view = buildView(state, config)
  assert.equal(view.cost, peakRate('deepseek-flash'))
  assert.equal(view.calls, 1)
})
