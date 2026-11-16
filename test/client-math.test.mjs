/**
 * Executable checks for the browser half's pure helpers. The client file is a
 * browser module, so the test stands in for the module loader and reads the
 * helpers the plugin exposes for tests.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SCHEDULE, tierAt as hostTierAt } from '../pricing.js'

/** Capture the factory the bundle registers instead of talking to a browser. */
const registration = { spec: null }
globalThis.window = {
  __ModuleLoader__: {
    load(spec) { registration.spec = spec },
  },
  innerWidth: 1280,
  innerHeight: 800,
}
await import('../client.js')
assert.ok(registration.spec !== null, 'client.js must register a module factory')

/** Minimal React stand-in; only the shape the factory reads at load is needed. */
const react = {
  createElement: () => null,
  useState: value => [value, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useId: () => ':r0:',
}
const plugin = registration.spec.factory(name => (name === 'react' ? react : {}))
const math = plugin.__test

/** Translate with the English dictionary the client ships. */
function translate(key, values) {
  const text = math.dictionaries.EN[key]
  assert.ok(typeof text === 'string', `missing dictionary key ${key}`)
  return text.replace(/\{([a-zA-Z]+)\}/g, (_, name) => String(values?.[name] ?? ''))
}

const PEAK = Date.parse('2026-11-16T02:00:00Z')
const OFF_PEAK = Date.parse('2026-11-16T05:00:00Z')
/** Pre-Spring-Festival Friday afternoon: the next peak is ten days away. */
const HOLIDAY_EVE = Date.parse('2026-02-13T11:00:00Z')

test('the client tier rule matches the Host rule at every sampled instant', () => {
  const start = Date.parse('2026-01-01T00:00:00Z')
  for (let step = 0; step < 24 * 21; step += 1) {
    const instant = start + step * 3600000 + 17 * 60000
    assert.equal(math.tierAt(DEFAULT_SCHEDULE, instant), hostTierAt(instant, DEFAULT_SCHEDULE), new Date(instant).toISOString())
  }
})

test('the status line names the tier, the discount, and the next change', () => {
  const peak = math.describeStatus(DEFAULT_SCHEDULE, PEAK, translate)
  assert.equal(peak.tier, 'peak')
  assert.match(peak.text, /Peak hours · off-peak starts in/)
  const off = math.describeStatus(DEFAULT_SCHEDULE, OFF_PEAK, translate)
  assert.equal(off.tier, 'offPeak')
  assert.equal(off.percentOff, 50)
  assert.match(off.text, /Off-peak hours · 50% off · peak starts in/)
  const custom = math.describeStatus({ ...DEFAULT_SCHEDULE, discount: 0.25 }, OFF_PEAK, translate)
  assert.equal(custom.percentOff, 25)
  assert.match(custom.text, /25% off/)
  // The Host's billed percentage wins over the prose discount.
  const billed = math.describeStatus({ ...DEFAULT_SCHEDULE, offPeakPercent: 25 }, OFF_PEAK, translate)
  assert.equal(billed.percentOff, 25)
  assert.match(billed.text, /25% off/)
  // No single percentage (per-model off-peak rows) drops the segment.
  const mixed = math.describeStatus({ ...DEFAULT_SCHEDULE, offPeakPercent: null }, OFF_PEAK, translate)
  assert.equal(mixed.percentOff, null)
  assert.match(mixed.text, /Off-peak hours · peak starts in/)
  assert.equal(math.describeStatus({ ...DEFAULT_SCHEDULE, enabled: false }, PEAK, translate), null)
})

test('the countdown reaches across a long holiday off-peak stretch', () => {
  const remaining = math.msUntilTierChange(DEFAULT_SCHEDULE, HOLIDAY_EVE)
  assert.ok(remaining > 250 * 3600000, `expected the February holiday stretch, got ${remaining}`)
  assert.ok(remaining <= 260 * 3600000, `expected the February holiday stretch, got ${remaining}`)
  assert.equal(math.msUntilTierChange(DEFAULT_SCHEDULE, OFF_PEAK), 3600000)
  assert.equal(math.msUntilTierChange(DEFAULT_SCHEDULE, PEAK), 7200000)
})

test('remaining time is rendered at the right unit', () => {
  assert.equal(math.formatRemaining(90 * 1000, translate), '2m')
  assert.equal(math.formatRemaining(60 * 60 * 1000, translate), '1h')
  assert.equal(math.formatRemaining(125 * 60 * 1000, translate), '2h 5m')
  assert.equal(math.formatRemaining(5 * 24 * 3600 * 1000, translate), '5d')
  assert.equal(math.formatRemaining((24 + 3) * 3600 * 1000, translate), '1d 3h')
})

test('a panel above a bottom-docked pill stays pinned above it', () => {
  const trigger = { top: 700, bottom: 728, left: 40, width: 100 }
  const placement = math.computePanelPlacement(trigger, { width: 340, height: 420 }, { width: 1280, height: 800 })
  assert.deepEqual(placement, { top: 272, left: 40, width: 340, height: 420 })
})

test('the panel clamps into narrow and short viewports', () => {
  const trigger = { top: 700, bottom: 728, left: 40, width: 100 }
  const narrow = math.computePanelPlacement(trigger, { width: 340, height: 420 }, { width: 320, height: 800 })
  assert.equal(narrow.width, 296)
  assert.equal(narrow.left, 12)
  const short = math.computePanelPlacement({ top: 180, bottom: 208, left: 40, width: 100 }, { width: 340, height: 420 }, { width: 1280, height: 240 }, 12)
  assert.equal(short.height, 160)
  assert.ok(short.top >= 12 && short.top + short.height <= 228)
})

test('the panel flips below the trigger when there is no room above', () => {
  const placement = math.computePanelPlacement({ top: 300, bottom: 328, left: 40, width: 100 }, { width: 340, height: 420 }, { width: 1280, height: 800 })
  assert.equal(placement.top, 336)
  assert.equal(placement.height, 420)
})

test('the panel stays below host window chrome', () => {
  const placement = math.computePanelPlacement({ top: 300, bottom: 328, left: 40, width: 100 }, { width: 340, height: 420 }, { width: 1280, height: 800 }, 60)
  assert.ok(placement.top >= 60)
  assert.ok(placement.top + placement.height <= 800 - 12)
})

test('the chrome inset resolves a calc() host value', () => {
  const previous = globalThis.document
  globalThis.document = {
    createElement: () => ({ style: {}, getBoundingClientRect: () => ({ height: 68 }), remove() {} }),
    body: { appendChild() {} },
  }
  try {
    assert.equal(math.overlayTopInset(), 68)
  } finally {
    globalThis.document = previous
  }
})

test('the chrome inset falls back when the probe has no height', () => {
  const previous = globalThis.document
  globalThis.document = {
    createElement: () => ({ style: {}, getBoundingClientRect: () => ({ height: 0 }), remove() {} }),
    body: { appendChild() {} },
  }
  try {
    assert.equal(math.overlayTopInset(), 12)
  } finally {
    globalThis.document = previous
  }
})

test('an above-placed panel respects host headroom', () => {
  const placement = math.computePanelPlacement({ top: 500, bottom: 528, left: 40, width: 100 }, { width: 340, height: 420 }, { width: 1280, height: 800 }, 200)
  assert.equal(placement.top, 200)
  assert.equal(placement.height, 292)
})

test('rate-table age is relative to the reader', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')
  assert.equal(math.formatAge(now - 10 * 1000, now, translate), 'just now')
  assert.equal(math.formatAge(now - 12 * 60 * 1000, now, translate), '12 min ago')
  assert.equal(math.formatAge(now - 3 * 3600 * 1000, now, translate), '3h ago')
  assert.equal(math.formatAge(now - 2 * 86400 * 1000, now, translate), '2d ago')
})
