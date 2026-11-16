/** Integration checks for the Host half: registration plus the background price refresh. */

import test from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../index.js'

/** A pricing document with one model at a distinctive price, so a refresh is visible. */
function pricingMarkdown({ peakInput = 1, offPeakInput = 0.5, peakOutput = 2, offPeakOutput = 1 } = {}) {
  return [
    '| MODEL | MODEL | demo-model |',
    '| --- | --- | --- |',
    `| PRICING | 1M INPUT TOKENS / (CACHE HIT) | PEAK | $${peakInput / 5} |`,
    `| PRICING | 1M INPUT TOKENS / (CACHE MISS) | PEAK | $${peakInput} |`,
    `| PRICING | 1M OUTPUT TOKENS | PEAK | $${peakOutput} |`,
    `| PRICING | 1M INPUT TOKENS / (CACHE HIT) | OFF-PEAK | $${offPeakInput / 5} |`,
    `| PRICING | 1M INPUT TOKENS / (CACHE MISS) | OFF-PEAK | $${offPeakInput} |`,
    `| PRICING | 1M OUTPUT TOKENS | OFF-PEAK | $${offPeakOutput} |`,
    '',
    'Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays.',
  ].join('\n')
}

/** A minimal Cordis-like context capturing the registration and the refresh resources. */
function fakeContext(web) {
  const captured = { definition: null, warnings: [], info: [], disposers: [] }
  const ctx = {
    logger: {
      warn: message => captured.warnings.push(message),
      info: message => captured.info.push(message),
    },
    get: name => (name === 'web' ? web : undefined),
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') captured.disposers.push(dispose)
      return dispose
    },
    sessionProjections: {
      register(definition) {
        captured.definition = definition
        return Promise.resolve({ stateOf: () => definition.init(), dispose: async () => {} })
      },
    },
    captured,
  }
  return ctx
}

/** One settlement at a chosen UTC instant on the demo model. */
function settlement(time) {
  return {
    type: 'assistant/message',
    time,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', source: { kind: 'model', provider: 'demo', model: 'demo-model' } },
      stream: [],
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    },
  }
}

/** Let the fire-and-forget refresh finish. */
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 20))
}

const PEAK = Date.parse('2026-11-16T02:00:00Z')
const OFF_PEAK = Date.parse('2026-11-16T05:00:00Z')

/** Build the wire view from the captured projection definition. */
function viewOf(definition, time) {
  return definition.wire.viewSchema.parse(definition.wire.view(definition.apply(definition.init(), settlement(time))))
}

test('the Host registers the unit and refreshes prices from the pricing page', async () => {
  const web = {
    fetch: async ({ url }) => ({ url, statusCode: 200, truncated: false, body: { kind: 'text', content: pricingMarkdown() } }),
  }
  const ctx = fakeContext(web)
  await apply(ctx, { pricingSource: 'deepseek', refreshHours: 6 })
  await settle()
  assert.ok(ctx.captured.definition, 'the projection must be registered')
  assert.equal(ctx.captured.definition.stateVersion, 3)
  const view = viewOf(ctx.captured.definition, PEAK)
  assert.equal(view.rates.source, 'deepseek')
  assert.equal(view.rates.updatedAt > 0, true)
  assert.equal(view.cost, 1)
  const off = viewOf(ctx.captured.definition, OFF_PEAK)
  assert.equal(off.cost, 0.5)
  for (const dispose of ctx.captured.disposers) dispose()
})

test('a failed refresh keeps the shipped table and reports one warning', async () => {
  const web = { fetch: async () => { throw new Error('network down') } }
  const ctx = fakeContext(web)
  await apply(ctx, {})
  await settle()
  const view = viewOf(ctx.captured.definition, PEAK)
  assert.equal(view.rates.source, 'shipped')
  assert.equal(view.pricedCalls, 0, 'the shipped table does not know the demo model')
  assert.equal(ctx.captured.warnings.length, 1)
  assert.match(ctx.captured.warnings[0], /network down/)
  for (const dispose of ctx.captured.disposers) dispose()
})

test('a page without a usable table is reported instead of replacing the table', async () => {
  const web = { fetch: async () => ({ statusCode: 200, truncated: false, body: { kind: 'text', content: '# Pricing moved' } }) }
  const ctx = fakeContext(web)
  await apply(ctx, {})
  await settle()
  assert.equal(viewOf(ctx.captured.definition, PEAK).rates.source, 'shipped')
  assert.ok(ctx.captured.warnings.some(message => message.includes('usable rate table')))
  for (const dispose of ctx.captured.disposers) dispose()
})

test('a non-2xx response is a failed refresh, not a crash', async () => {
  const web = { fetch: async () => ({ statusCode: 503, truncated: false, body: { kind: 'text', content: '' } }) }
  const ctx = fakeContext(web)
  await apply(ctx, {})
  await settle()
  assert.equal(viewOf(ctx.captured.definition, PEAK).rates.source, 'shipped')
  assert.match(ctx.captured.warnings[0], /HTTP 503/)
  for (const dispose of ctx.captured.disposers) dispose()
})

test('pricingSource "off" never touches the network', async () => {
  let called = 0
  const web = { fetch: async () => { called += 1; throw new Error('should not be called') } }
  const ctx = fakeContext(web)
  await apply(ctx, { pricingSource: 'off' })
  await settle()
  assert.equal(called, 0)
  assert.equal(viewOf(ctx.captured.definition, PEAK).rates.source, 'shipped')
  assert.equal(ctx.captured.disposers.length, 0)
})

test('an unavailable web provider falls back to the direct HTTP client', async () => {
  const web = {
    fetch: async () => {
      const error = new Error('no fetch provider is selected')
      error.code = 'WEB_PROVIDER_UNAVAILABLE'
      throw error
    },
  }
  const originalFetch = globalThis.fetch
  let directCalls = 0
  globalThis.fetch = async () => {
    directCalls += 1
    return new Response(pricingMarkdown(), { status: 200, headers: { 'content-type': 'text/markdown' } })
  }
  try {
    const ctx = fakeContext(web)
    await apply(ctx, {})
    await settle()
    assert.equal(directCalls, 1)
    assert.equal(viewOf(ctx.captured.definition, PEAK).rates.source, 'deepseek')
    for (const dispose of ctx.captured.disposers) dispose()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('an unreadable peak-hours sentence is reported but still installs the prices', async () => {
  const markdown = `${pricingMarkdown().split('\n').filter(line => !line.startsWith('Off-peak rates')).join('\n')}\n\nPeak hours are whenever.`
  const web = { fetch: async () => ({ statusCode: 200, truncated: false, body: { kind: 'text', content: markdown } }) }
  const ctx = fakeContext(web)
  await apply(ctx, {})
  await settle()
  const view = viewOf(ctx.captured.definition, PEAK)
  assert.equal(view.rates.source, 'deepseek', 'the price rows are still usable')
  assert.ok(ctx.captured.warnings.some(message => message.includes('peak-hours')), 'the schedule warning must be logged')
  for (const dispose of ctx.captured.disposers) dispose()
})
