/** Unit checks for the pure `sessionSpend` fold; run with `node --test test/`. */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BUILTIN_RATES,
  buildView,
  createProjectionDefinition,
  normalizeConfig,
} from '../projection.js'

const config = normalizeConfig(undefined)

/** One durable assistant settlement with provider usage and an explicit route. */
function assistant(turn, step, usage, provider = 'deepseek-account', model = 'deepseek-flash') {
  return {
    type: 'assistant/message',
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
function wire(events, pricing = config) {
  const unit = createProjectionDefinition(pricing)
  const state = fold(events, unit)
  return { state, view: unit.wire.viewSchema.parse(unit.wire.view(state)) }
}

test('an assistant settlement is priced from its reported usage', () => {
  const { state, view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }),
  ])
  assert.equal(state.calls, 1)
  assert.equal(view.cost, BUILTIN_RATES['deepseek-flash'].input)
  assert.equal(view.tokens.input, 1_000_000)
  assert.equal(view.tokens.total, 1_000_000)
  assert.equal(view.pricedCalls, 1)
  assert.equal(view.unpricedCalls, 0)
  assert.equal(view.models.length, 1)
  assert.equal(view.models[0].route, 'deepseek-account/deepseek-flash')
  assert.equal(view.models[0].priced, true)
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

test('a retried attempt stays billable, so both attempts count', () => {
  // Matches the host tokenUsage unit: retry-started closes the replacement slot,
  // and the retried attempt's settlement adds instead of replacing.
  const { state, view } = wire([
    assistant(2, 1, { inputTokens: 500, outputTokens: 50 }),
    { type: 'llm/retry-started', data: { turn: 2, step: 1, retry: 1 } },
    assistant(2, 1, { inputTokens: 600, outputTokens: 60 }),
  ])
  assert.equal(view.retries, 1)
  assert.equal(state.calls, 2)
  assert.equal(view.tokens.input, 1100)
  assert.equal(view.tokens.output, 110)
  assert.equal(view.models[0].calls, 2)
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
    { type: 'request/header', data: { header: { config: { provider: 'deepseek-account', model: 'deepseek-v4-pro' } }, reason: 'initial' } },
    {
      type: 'assistant/attempt',
      data: {
        turn: 1,
        step: 1,
        stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 0 } } }],
      },
    },
  ])
  assert.equal(view.models[0].route, 'deepseek-account/deepseek-v4-pro')
  assert.equal(view.cost, BUILTIN_RATES['deepseek-v4-pro'].input)
})

test('cache buckets are charged at their own rates', () => {
  const { view } = wire([
    assistant(1, 1, {
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
  ], normalizeConfig({ pricing: { 'deepseek-flash': { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 } } }))
  assert.equal(view.cost, 10)
  assert.equal(view.costInput, 1)
  assert.equal(view.costCacheRead, 2)
  assert.equal(view.costCacheWrite, 3)
  assert.equal(view.costOutput, 4)
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

test('defaultPricing prices a route missing from the table', () => {
  const { view } = wire([
    assistant(1, 1, { inputTokens: 2_000_000, outputTokens: 0 }, 'other-provider', 'mystery-model'),
  ], normalizeConfig({ defaultPricing: { input: 0.5, cacheRead: 0.05, cacheWrite: 0.5, output: 2 } }))
  assert.equal(view.cost, 1)
  assert.equal(view.unpricedCalls, 0)
})

test('an incomplete defaultPricing is ignored with a warning', () => {
  const config = normalizeConfig({ defaultPricing: { input: 0.5 } })
  assert.equal(config.fallback, null)
  assert.equal(config.warnings.length, 1)
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000, outputTokens: 10 }, 'other-provider', 'mystery-model'),
  ], config)
  assert.equal(view.unpricedCalls, 1)
})

test('a new route needs all four rates instead of borrowing another model\'s', () => {
  const config = normalizeConfig({ pricing: { 'openai/gpt-5': { input: 1.25 } } })
  assert.equal(config.warnings.length, 1)
  const { view } = wire([
    assistant(1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'openai', 'gpt-5'),
  ], config)
  assert.equal(view.unpricedCalls, 1)
  assert.equal(view.cost, 0)
})

test('a partial override of a shipped model inherits that model\'s own rates', () => {
  const config = normalizeConfig({ pricing: { 'deepseek-v4-pro': { output: 8 } } })
  assert.deepEqual(config.warnings, [])
  assert.equal(config.pricing['deepseek-v4-pro'].input, BUILTIN_RATES['deepseek-v4-pro'].input)
  assert.equal(config.pricing['deepseek-v4-pro'].output, 8)
})

test('a compaction summary is charged as its own summarize call', () => {
  const { view } = wire([
    { type: 'compaction/start', data: { compactionId: 'c1', turn: 1 } },
    {
      type: 'compaction/summary',
      data: {
        compactionId: 'c1',
        provider: 'deepseek-account',
        model: 'deepseek-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      },
    },
    { type: 'compaction/end', data: { compactionId: 'c1', turn: 1 } },
  ])
  assert.equal(view.compactions, 1)
  assert.equal(view.calls, 1)
  assert.equal(view.cost, BUILTIN_RATES['deepseek-flash'].input)
})

test('activity counters fold turns, steps, tools, and tool errors', () => {
  const { view } = wire([
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'step/start', data: { turn: 1, step: 2 } },
    { type: 'step/end', data: { turn: 1, step: 2 } },
    { type: 'step/start', data: { turn: 2, step: 1 } },
    { type: 'step/end', data: { turn: 2, step: 1 } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'a', name: 'bash', arguments: '{}' } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{}' } },
    { type: 'tool/result', data: { turn: 1, step: 1, message: { source: { callId: 'a' }, isError: true } } },
    { type: 'tool/result', data: { turn: 1, step: 1, message: { source: { callId: 'b' } } } },
    { type: 'user/message', data: { role: 'user' } },
  ])
  assert.equal(view.turns, 2)
  assert.equal(view.steps, 3)
  assert.equal(view.toolCalls, 2)
  assert.equal(view.toolErrors, 1)
})

test('irrelevant events keep the state reference', () => {
  const unit = createProjectionDefinition(config)
  const state = unit.init()
  assert.equal(unit.apply(state, { type: 'user/message', data: { role: 'user' } }), state)
})

test('the wire view keeps its reference while the state is unchanged', () => {
  const unit = createProjectionDefinition(config)
  const state = unit.apply(unit.init(), assistant(1, 1, { inputTokens: 10, outputTokens: 1 }))
  assert.equal(unit.wire.view(state), unit.wire.view(state))
})

test('restored state is validated strictly', () => {
  const unit = createProjectionDefinition(config)
  const state = fold([assistant(1, 1, { inputTokens: 10, outputTokens: 1 })])
  assert.doesNotThrow(() => unit.stateSchema.parse(state))
  assert.throws(() => unit.stateSchema.parse({ ...state, calls: -1 }), /calls/)
  assert.throws(() => unit.stateSchema.parse({ ...state, models: { x: { calls: 1 } } }), /input/)
  assert.throws(() => unit.stateSchema.parse({ ...state, sample: { turn: 1, step: 1, route: 'a/b' } }), /units/)
})

test('configured currency and precision reach the wire', () => {
  const { view } = wire([], normalizeConfig({ currencySymbol: '¥', decimals: 2 }))
  assert.equal(view.currencySymbol, '¥')
  assert.equal(view.decimals, 2)
})

test('cost equals the sum of its bucket parts', () => {
  const { view } = wire([
    assistant(1, 1, { inputTokens: 12_345, cacheReadTokens: 67_890, cacheWriteTokens: 1_234, outputTokens: 5_678 }),
  ])
  const parts = view.costInput + view.costCacheRead + view.costCacheWrite + view.costOutput
  assert.ok(Math.abs(view.cost - parts) < 1e-9)
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

test('the peak-rate caveat follows whether a shipped model was repriced', () => {
  assert.equal(wire([]).view.peakRates, true)
  assert.equal(wire([], normalizeConfig({ currencySymbol: '$' })).view.peakRates, true)
  // Pricing another provider leaves every shipped DeepSeek row on its peak table.
  const otherProvider = normalizeConfig({ pricing: { 'openai/gpt-5': { input: 1.25, cacheRead: 0.125, cacheWrite: 1.25, output: 10 } } })
  assert.equal(wire([], otherProvider).view.peakRates, true)
  // A fallback only prices routes the shipped table does not know.
  assert.equal(wire([], normalizeConfig({ defaultPricing: { input: 1, cacheRead: 0.1, cacheWrite: 1, output: 4 } })).view.peakRates, true)
  // Replacing a shipped model's rate, directly or by route, drops the caveat.
  assert.equal(wire([], normalizeConfig({ pricing: { 'deepseek-flash': { output: 2 } } })).view.peakRates, false)
  assert.equal(wire([], normalizeConfig({ pricing: { 'deepseek-account/deepseek-v4-pro': { input: 1 } } })).view.peakRates, false)
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
