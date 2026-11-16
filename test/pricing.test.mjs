import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CN_HOLIDAYS,
  DEFAULT_SCHEDULE,
  PRICING_URL,
  isUsableRateTable,
  isUtcDay,
  normalizeOffPeak,
  normalizeWindow,
  parsePricingMarkdown,
  tierAt,
  utcDay,
} from '../pricing.js'

import { readFileSync } from 'node:fs'

const FIXTURE = new URL('./fixtures/pricing-2026-11-16.md', import.meta.url)

/** The pricing page's markdown as fetched on 2026-11-16. */
const FIXTURE_TEXT = readFileSync(FIXTURE, 'utf8')

/** Epoch milliseconds for one UTC instant. */
function utc(text) {
  return Date.parse(text)
}

test('the fixture loads and parses both DeepSeek models', () => {
  const parsed = parsePricingMarkdown(FIXTURE_TEXT)
  assert.deepEqual(parsed.warnings, [])
  assert.deepEqual(Object.keys(parsed.models).sort(), ['deepseek-flash', 'deepseek-v4-pro'])
  assert.deepEqual(parsed.models['deepseek-flash'], {
    peak: { input: 0.3, cacheRead: 0.006, output: 1.2 },
    offPeak: { input: 0.15, cacheRead: 0.003, output: 0.6 },
  })
  assert.deepEqual(parsed.models['deepseek-v4-pro'], {
    peak: { input: 1.32, cacheRead: 0.044, output: 3.96 },
    offPeak: { input: 0.66, cacheRead: 0.022, output: 1.98 },
  })
  assert.equal(isUsableRateTable(parsed.models), true)
})

test('the bundled schedule matches the published pricing footnote', () => {
  const parsed = parsePricingMarkdown(FIXTURE_TEXT)
  assert.equal(parsed.schedule.discount, 0.5)
  assert.deepEqual(parsed.schedule.windows, [
    { days: [1, 2, 3, 4, 5], start: 60, end: 240 },
    { days: [1, 2, 3, 4, 5], start: 360, end: 600 },
  ])
  assert.deepEqual(DEFAULT_SCHEDULE.windows, parsed.schedule.windows)
  assert.equal(DEFAULT_SCHEDULE.discount, parsed.schedule.discount)
  assert.deepEqual(DEFAULT_SCHEDULE.holidays, CN_HOLIDAYS)
})

test('the pricing URL is the page\'s copy-markdown link', () => {
  assert.equal(PRICING_URL, 'https://api-docs.deepseek.com/quick_start/pricing.md')
})

test('peak hours are the two weekday UTC windows, everything else off-peak', () => {
  // Monday 2026-11-16.
  assert.equal(tierAt(utc('2026-11-16T00:59:00Z'), DEFAULT_SCHEDULE), 'offPeak')
  assert.equal(tierAt(utc('2026-11-16T01:00:00Z'), DEFAULT_SCHEDULE), 'peak')
  assert.equal(tierAt(utc('2026-11-16T03:59:00Z'), DEFAULT_SCHEDULE), 'peak')
  assert.equal(tierAt(utc('2026-11-16T04:00:00Z'), DEFAULT_SCHEDULE), 'offPeak')
  assert.equal(tierAt(utc('2026-11-16T05:59:00Z'), DEFAULT_SCHEDULE), 'offPeak')
  assert.equal(tierAt(utc('2026-11-16T06:00:00Z'), DEFAULT_SCHEDULE), 'peak')
  assert.equal(tierAt(utc('2026-11-16T09:59:00Z'), DEFAULT_SCHEDULE), 'peak')
  assert.equal(tierAt(utc('2026-11-16T10:00:00Z'), DEFAULT_SCHEDULE), 'offPeak')
  assert.equal(tierAt(utc('2026-11-16T23:59:00Z'), DEFAULT_SCHEDULE), 'offPeak')
})

test('weekends are off-peak in full even inside a peak window', () => {
  // Saturday 2026-11-14 02:00 UTC would be inside the 01:00-04:00 window on a weekday.
  assert.equal(tierAt(utc('2026-11-14T02:00:00Z'), DEFAULT_SCHEDULE), 'offPeak')
  assert.equal(tierAt(utc('2026-11-15T02:00:00Z'), DEFAULT_SCHEDULE), 'offPeak')
  assert.equal(tierAt(utc('2026-11-16T02:00:00Z'), DEFAULT_SCHEDULE), 'peak')
})

test('Chinese public holidays are off-peak in full', () => {
  // National Day, Thursday 2026-10-01, would otherwise be peak at 02:00 UTC.
  assert.equal(tierAt(utc('2026-10-01T02:00:00Z'), DEFAULT_SCHEDULE), 'offPeak')
  assert.equal(CN_HOLIDAYS.includes('2026-10-01'), true)
  assert.equal(CN_HOLIDAYS.includes('2027-10-01'), true)
  // A non-holiday Thursday at the same time is peak.
  assert.equal(tierAt(utc('2026-10-08T02:00:00Z'), DEFAULT_SCHEDULE), 'peak')
})

test('a disabled or empty schedule bills everything as peak', () => {
  assert.equal(tierAt(utc('2026-11-14T02:00:00Z'), { ...DEFAULT_SCHEDULE, enabled: false }), 'peak')
  assert.equal(tierAt(utc('2026-11-14T02:00:00Z'), { ...DEFAULT_SCHEDULE, windows: [] }), 'peak')
  assert.equal(tierAt(Number.NaN, DEFAULT_SCHEDULE), 'peak')
  assert.equal(tierAt(utc('2026-11-14T02:00:00Z'), null), 'peak')
})

test('UTC calendar days round-trip and reject impossible dates', () => {
  assert.equal(utcDay(utc('2026-11-16T02:00:00Z')), '2026-11-16')
  assert.equal(isUtcDay('2026-02-29'), false)
  assert.equal(isUtcDay('2028-02-29'), true)
  assert.equal(isUtcDay('2026-1-1'), false)
})

test('windows accept HH:MM or minute values and reject inverted ranges', () => {
  assert.deepEqual(normalizeWindow({ days: [1], start: '01:00', end: '04:00' }), { days: [1], start: 60, end: 240 })
  assert.deepEqual(normalizeWindow({ days: [0, 6], start: 0, end: 1440 }), { days: [0, 6], start: 0, end: 1440 })
  assert.equal(normalizeWindow({ days: [1], start: '04:00', end: '01:00' }), null)
  assert.equal(normalizeWindow({ days: [], start: 0, end: 60 }), null)
  assert.equal(normalizeWindow({ days: [7], start: 0, end: 60 }), null)
  assert.deepEqual(normalizeWindow({ days: [1], start: '1:00', end: '04:00' }), { days: [1], start: 60, end: 240 })
})

test('off-peak config keeps published defaults when absent', () => {
  const warnings = []
  const schedule = normalizeOffPeak(undefined, warnings)
  assert.deepEqual(warnings, [])
  assert.equal(schedule.configured, false)
  assert.equal(schedule.enabled, true)
  assert.equal(schedule.discount, 0.5)
  assert.deepEqual(schedule.windows, DEFAULT_SCHEDULE.windows)
})

test('off-peak config can disable pricing, change the discount, and override windows', () => {
  const warnings = []
  const disabled = normalizeOffPeak(false, warnings)
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.configured, true)
  assert.deepEqual(warnings, [])
  const custom = normalizeOffPeak({
    discount: 0.25,
    windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '08:00' }],
    holidays: ['2028-01-03'],
  }, warnings)
  assert.deepEqual(warnings, [])
  assert.equal(custom.discount, 0.25)
  assert.deepEqual(custom.windows, [{ days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 480 }])
  assert.deepEqual(custom.holidays, ['2028-01-03'])
  assert.equal(custom.configured, true)
})

test('malformed off-peak config is reported and falls back to the published schedule', () => {
  const warnings = []
  const schedule = normalizeOffPeak({
    discount: 2,
    windows: [{ days: [1] }],
    holidays: ['not-a-day'],
  }, warnings)
  assert.equal(warnings.length, 3)
  assert.equal(schedule.discount, 0.5)
  assert.deepEqual(schedule.windows, DEFAULT_SCHEDULE.windows)
  assert.deepEqual(schedule.holidays, CN_HOLIDAYS)
})

test('an empty or unrelated document yields no models and a warning', () => {
  for (const text of ['', '   ', '# Nothing here\n\nJust prose.']) {
    const parsed = parsePricingMarkdown(text)
    assert.equal(parsed.models, null)
    assert.ok(parsed.warnings.length > 0)
  }
})

test('a table with an incomplete model row drops that model instead of guessing', () => {
  const markdown = [
    '| MODEL | MODEL | a-model | b-model |',
    '| --- | --- | --- | --- |',
    '| PRICING(1) | 1M INPUT TOKENS / (CACHE HIT) | PEAK | $0.01 | $0.02 |',
    '| PRICING(1) | 1M INPUT TOKENS / (CACHE MISS) | PEAK | $0.1 | $0.2 |',
    '| PRICING(1) | 1M OUTPUT TOKENS | PEAK | $1 | $2 |',
    '| PRICING(1) | 1M INPUT TOKENS / (CACHE HIT) | OFF-PEAK | $0.005 | $0.01 |',
    '| PRICING(1) | 1M INPUT TOKENS / (CACHE MISS) | OFF-PEAK | $0.05 | $0.1 |',
    // b-model's off-peak output price is missing.
    '| PRICING(1) | 1M OUTPUT TOKENS | OFF-PEAK | $0.5 | n/a |',
  ].join('\n')
  const parsed = parsePricingMarkdown(markdown)
  assert.deepEqual(Object.keys(parsed.models), ['a-model'])
  assert.ok(parsed.warnings.some(warning => warning.includes('b-model')))
})

test('an implausible off-peak price above its peak price is rejected', () => {
  const markdown = [
    '| MODEL | MODEL | odd-model |',
    '| --- | --- | --- |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | PEAK | $0.01 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | PEAK | $0.1 |',
    '| PRICING | 1M OUTPUT TOKENS | PEAK | $1 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | OFF-PEAK | $0.02 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | OFF-PEAK | $0.2 |',
    '| PRICING | 1M OUTPUT TOKENS | OFF-PEAK | $2 |',
  ].join('\n')
  const parsed = parsePricingMarkdown(markdown)
  assert.equal(parsed.models, null)
  assert.ok(parsed.warnings.some(warning => warning.includes('implausible')))
})

test('a changed footnote reassigns the windows and discount, or is reported', () => {
  const markdown = [
    '| MODEL | MODEL | a-model |',
    '| --- | --- | --- |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | PEAK | $0.01 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | PEAK | $0.1 |',
    '| PRICING | 1M OUTPUT TOKENS | PEAK | $1 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | OFF-PEAK | $0.0075 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | OFF-PEAK | $0.075 |',
    '| PRICING | 1M OUTPUT TOKENS | OFF-PEAK | $0.75 |',
    '',
    'Off-peak rates are 25% off. Peak hours are 02:00 - 05:00 UTC, every day, excluding Chinese public holidays.',
  ].join('\n')
  const parsed = parsePricingMarkdown(markdown)
  assert.deepEqual(parsed.warnings, [])
  assert.deepEqual(parsed.schedule.windows, [{ days: [0, 1, 2, 3, 4, 5, 6], start: 120, end: 300 }])
  assert.equal(parsed.schedule.discount, 0.25)

  const unreadable = parsePricingMarkdown(`${markdown.split('\n\n')[0]}\n\nPeak hours are whenever.`)
  assert.equal(unreadable.schedule.windows, null)
  assert.ok(unreadable.warnings.some(warning => warning.includes('peak-hours')), 'the schedule warning must reach the caller')
})

test('the discount wording is read literally: off means off, of means a share', () => {
  const base = [
    '| MODEL | MODEL | a-model |',
    '| --- | --- | --- |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | PEAK | $0.01 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | PEAK | $0.1 |',
    '| PRICING | 1M OUTPUT TOKENS | PEAK | $1 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | OFF-PEAK | $0.0075 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | OFF-PEAK | $0.075 |',
    '| PRICING | 1M OUTPUT TOKENS | OFF-PEAK | $0.75 |',
    '',
  ].join('\n')
  const off = parsePricingMarkdown(`${base}Off-peak rates are 25% off. Peak hours are 01:00 - 04:00 UTC, Monday through Friday.`)
  assert.equal(off.schedule.discount, 0.25)
  const share = parsePricingMarkdown(`${base}Off-peak rates are 25% of the peak rates. Peak hours are 01:00 - 04:00 UTC, Monday through Friday.`)
  assert.equal(share.schedule.discount, 0.75)
  const shareShort = parsePricingMarkdown(`${base}Off-peak rates are 25% of peak. Peak hours are 01:00 - 04:00 UTC, Monday through Friday.`)
  assert.equal(shareShort.schedule.discount, 0.75)
  const listShare = parsePricingMarkdown(`${base}Off-peak rates are 75% of the list price. Peak hours are 01:00 - 04:00 UTC, Monday through Friday.`)
  assert.equal(listShare.schedule.discount, 0.25)
  const unknown = parsePricingMarkdown(`${base}Off-peak pricing is generous. Peak hours are 01:00 - 04:00 UTC, Monday through Friday.`)
  assert.equal(unknown.schedule.discount, null)
  assert.ok(unknown.warnings.some(warning => warning.includes('discount')))
})

test('the UTC peak sentence wins over a misleading earlier one', () => {
  const markdown = [
    '| MODEL | MODEL | a-model |',
    '| --- | --- | --- |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | PEAK | $0.01 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | PEAK | $0.1 |',
    '| PRICING | 1M OUTPUT TOKENS | PEAK | $1 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | OFF-PEAK | $0.005 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | OFF-PEAK | $0.05 |',
    '| PRICING | 1M OUTPUT TOKENS | OFF-PEAK | $0.5 |',
    '',
    'Off-peak hours are billed at 25% off. Peak hours are 01:00 - 04:00 UTC, Monday through Friday.',
    'Off-peak rates are 25% off.',
  ].join('\n')
  const parsed = parsePricingMarkdown(markdown)
  assert.deepEqual(parsed.schedule.windows, [{ days: [1, 2, 3, 4, 5], start: 60, end: 240 }])
  assert.equal(parsed.schedule.discount, 0.25)
})

test('a wrapping weekday range keeps every named day', () => {
  const markdown = [
    '| MODEL | MODEL | a-model |',
    '| --- | --- | --- |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | PEAK | $0.01 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | PEAK | $0.1 |',
    '| PRICING | 1M OUTPUT TOKENS | PEAK | $1 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | OFF-PEAK | $0.005 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | OFF-PEAK | $0.05 |',
    '| PRICING | 1M OUTPUT TOKENS | OFF-PEAK | $0.5 |',
    '',
    'Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 UTC, Friday through Monday.',
  ].join('\n')
  const parsed = parsePricingMarkdown(markdown)
  assert.deepEqual(parsed.schedule.windows, [{ days: [5, 6, 0, 1], start: 60, end: 240 }])
})

test('a table whose off-peak row contradicts the prose discount is reported', () => {
  const markdown = [
    '| MODEL | MODEL | a-model |',
    '| --- | --- | --- |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | PEAK | $0.01 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | PEAK | $0.1 |',
    '| PRICING | 1M OUTPUT TOKENS | PEAK | $1 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE HIT) | OFF-PEAK | $0.0025 |',
    '| PRICING | 1M INPUT TOKENS / (CACHE MISS) | OFF-PEAK | $0.025 |',
    '| PRICING | 1M OUTPUT TOKENS | OFF-PEAK | $0.25 |',
    '',
    'Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 UTC, Monday through Friday.',
  ].join('\n')
  const parsed = parsePricingMarkdown(markdown)
  assert.deepEqual(Object.keys(parsed.models), ['a-model'])
  assert.ok(parsed.warnings.some(warning => warning.includes('off-peak input')))
})

/** Unit checks for the DeepSeek pricing knowledge and its markdown parser. */
