/**
 * Pricing knowledge behind the `sessionSpend` projection: DeepSeek's published
 * peak/off-peak schedule, the shipped fallback rate table, and the parser that
 * refreshes those rates from DeepSeek's own pricing page.
 *
 * Everything here is pure and dependency-free so the fold, the background
 * refresh, and the tests share one definition. The only I/O in the plugin is
 * the refresh in `index.js`, which calls {@link parsePricingMarkdown}.
 *
 * Times come from https://api-docs.deepseek.com/quick_start/pricing (fetched
 * 2026-11-16): peak hours are 01:00-04:00 and 06:00-10:00 UTC, Monday through
 * Friday, excluding Chinese public holidays; every other hour bills off-peak
 * at half the peak rate.
 */

/** Markdown source of the official pricing page; the page's "Copy Markdown" link. */
export const PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing.md'

/** Minute-of-day when UTC peak pricing starts. */
const PEAK_WINDOWS = Object.freeze([
  Object.freeze({ days: Object.freeze([1, 2, 3, 4, 5]), start: 60, end: 240 }),
  Object.freeze({ days: Object.freeze([1, 2, 3, 4, 5]), start: 360, end: 600 }),
])

/** Peak-hour time windows in UTC; `days` uses `Date#getUTCDay` numbers (0 = Sunday). */
export const DEFAULT_WINDOWS = PEAK_WINDOWS

/** Fraction taken off the peak rates while off-peak, as published. */
export const DEFAULT_DISCOUNT = 0.5

/**
 * Chinese public holidays whose weekdays bill off-peak, as told by the State
 * Council schedule (source: NateScarlet/holiday-cn, `isOffDay: true`). Weekends
 * are off-peak regardless, so only weekday dates change the calculation.
 * Years not listed bill weekday holidays at peak until the plugin updates.
 */
export const CN_HOLIDAYS = Object.freeze([
  '2026-01-01', '2026-01-02', '2026-02-16', '2026-02-17', '2026-02-18',
  '2026-02-19', '2026-02-20', '2026-02-23', '2026-04-06',
  '2026-05-01', '2026-05-04', '2026-05-05', '2026-06-19', '2026-09-25',
  '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07',
  '2027-01-01', '2027-02-05', '2027-02-08', '2027-02-09', '2027-02-10',
  '2027-02-11', '2027-02-12', '2027-04-05',
  '2027-05-03', '2027-05-04', '2027-05-05', '2027-06-09', '2027-09-15',
  '2027-10-01', '2027-10-04', '2027-10-05', '2027-10-06', '2027-10-07',
])

/** The shipped fallback schedule: DeepSeek's published windows and discount. */
export const DEFAULT_SCHEDULE = Object.freeze({
  enabled: true,
  discount: DEFAULT_DISCOUNT,
  windows: PEAK_WINDOWS,
  holidays: CN_HOLIDAYS,
})

/** Buckets a peak rate table must provide; cache writes bill as cache misses. */
const RATE_FIELDS = ['input', 'cacheRead', 'output']

const DAY_NAMES = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** UTC calendar day of an epoch-millisecond instant, as `YYYY-MM-DD`. */
export function utcDay(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10)
}

/**
 * Whether one instant bills at peak rates under a schedule.
 * The windows are half-open `[start, end)` in UTC minutes; a listed holiday day
 * is off-peak in full, and a weekend is off-peak because no window covers it.
 * @param epochMs - Unix epoch milliseconds of the request's usage settlement.
 * @param schedule - resolved schedule; a missing or disabled one always bills peak.
 * @returns `'peak'` or `'offPeak'`.
 */
export function tierAt(epochMs, schedule) {
  if (!isRecord(schedule) || schedule.enabled !== true || !Array.isArray(schedule.windows) || schedule.windows.length === 0) return 'peak'
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return 'peak'
  const time = new Date(epochMs)
  const day = time.getUTCDay()
  const minutes = time.getUTCHours() * 60 + time.getUTCMinutes()
  if (Array.isArray(schedule.holidays) && schedule.holidays.includes(utcDay(epochMs))) return 'offPeak'
  const peak = schedule.windows.some(window => window.days.includes(day) && minutes >= window.start && minutes < window.end)
  return peak ? 'peak' : 'offPeak'
}

/** Parse `HH:MM` (or plain minutes) into minutes after UTC midnight. */
function minutesOf(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 && value <= 1440 ? value : null
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) return null
  return hours * 60 + minutes
}

/** Parse a UTC calendar day into `YYYY-MM-DD`, rejecting impossible dates. */
export function isUtcDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value
}

/**
 * Normalize one window entry: `days` is a non-empty array of 0-6, and
 * `start`/`end` are UTC minutes with `start < end`.
 * @param raw - configured value.
 * @returns the window, or null when the value is unusable.
 */
export function normalizeWindow(raw) {
  if (!isRecord(raw)) return null
  const start = minutesOf(raw.start)
  const end = minutesOf(raw.end)
  if (start === null || end === null || start >= end || end > 1440) return null
  const rawDays = Array.isArray(raw.days) ? raw.days : []
  const days = []
  for (const day of rawDays) {
    if (!Number.isSafeInteger(day) || day < 0 || day > 6 || days.includes(day)) return null
    days.push(day)
  }
  if (days.length === 0) return null
  return { days, start, end }
}

/**
 * Normalize a configured `offPeak` value over the published defaults.
 * @param raw - the row's `offPeak` config value.
 * @param warnings - warning sink for values that had to be ignored.
 * @returns `{ enabled, discount, windows, holidays, configured }`; `configured`
 * is true when the user supplied any part, which keeps the live refresh from
 * replacing their choice.
 */
export function normalizeOffPeak(raw, warnings) {
  if (raw === false) return { enabled: false, discount: DEFAULT_DISCOUNT, windows: DEFAULT_WINDOWS, holidays: CN_HOLIDAYS, configured: true }
  if (raw === undefined || raw === null) {
    return { enabled: true, discount: DEFAULT_DISCOUNT, windows: DEFAULT_WINDOWS, holidays: CN_HOLIDAYS, configured: false }
  }
  if (!isRecord(raw)) {
    warnings.push('offPeak must be an object or false; using the published schedule')
    return { enabled: true, discount: DEFAULT_DISCOUNT, windows: DEFAULT_WINDOWS, holidays: CN_HOLIDAYS, configured: false }
  }
  let enabled = true
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === 'boolean') enabled = raw.enabled
    else warnings.push('offPeak.enabled must be a boolean; keeping it on')
  }
  let discount = DEFAULT_DISCOUNT
  if (raw.discount !== undefined) {
    if (typeof raw.discount === 'number' && Number.isFinite(raw.discount) && raw.discount > 0 && raw.discount < 1) discount = raw.discount
    else warnings.push('offPeak.discount must be a fraction between 0 and 1; using 0.5')
  }
  let windows = DEFAULT_WINDOWS
  if (raw.windows !== undefined) {
    if (!Array.isArray(raw.windows) || raw.windows.length === 0) {
      warnings.push('offPeak.windows must be a non-empty array; using the published peak windows')
    } else {
      const parsed = []
      for (const entry of raw.windows) {
        const window = normalizeWindow(entry)
        if (window === null) {
          warnings.push('offPeak.windows entries need days [0-6], a start, and an end (start before end); using the published peak windows')
          parsed.length = 0
          break
        }
        parsed.push(window)
      }
      if (parsed.length > 0) windows = parsed
    }
  }
  let holidays = CN_HOLIDAYS
  if (raw.holidays !== undefined) {
    if (!Array.isArray(raw.holidays)) {
      warnings.push('offPeak.holidays must be an array of YYYY-MM-DD dates; keeping the bundled Chinese holidays')
    } else if (raw.holidays.some(day => !isUtcDay(day))) {
      warnings.push('offPeak.holidays contains an invalid date; keeping the bundled Chinese holidays')
    } else {
      holidays = raw.holidays
    }
  }
  return { enabled, discount, windows, holidays, configured: true }
}

/** Strip markdown emphasis, links, backticks, and footnote markers from a table cell. */
function cellText(raw) {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\(\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cells of one markdown table row, or null when the line is not a row. */
function rowCells(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null
  return trimmed.slice(1, -1).split('|').map(cellText)
}

/** A model id cell, or null when the text cannot be a model id. */
function modelName(cell) {
  if (typeof cell !== 'string' || cell.length === 0 || cell.length > 64) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cell)) return null
  return cell
}

/** Locate the pricing table's model columns from its `MODEL` header row. */
function readModelColumns(lines) {
  for (const line of lines) {
    const cells = rowCells(line)
    if (cells === null) continue
    let lastModel = -1
    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index].toUpperCase() === 'MODEL') lastModel = index
    }
    if (lastModel === -1) continue
    const models = cells.slice(lastModel + 1).map(modelName)
    if (models.length > 0 && models.every(name => name !== null)) return models
  }
  return null
}

/** Read one `$0.003`-style price cell. */
function priceCell(cell) {
  if (typeof cell !== 'string') return null
  const match = /^\$?\s*(\d+(?:\.\d+)?)$/.exec(cell)
  if (match === null) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** Map a pricing row's metric cell to the rate bucket it fills. */
function metricField(cell) {
  const text = cell.toUpperCase()
  if (text.includes('CACHE HIT')) return 'cacheRead'
  if (text.includes('CACHE MISS') || text.includes('INPUT')) return 'input'
  if (text.includes('OUTPUT')) return 'output'
  return null
}

/** Weekday numbers named in the note, or null when the note names none. */
function readDays(text) {
  if (/every\s+day|daily|all\s+days|seven\s+days/i.test(text)) return [0, 1, 2, 3, 4, 5, 6]
  const tokens = text.match(/sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat/gi) ?? []
  const named = tokens.map(token => DAY_NAMES[token.toLowerCase()]).filter(day => day !== undefined)
  if (named.length === 0) return null
  const unique = [...new Set(named)]
  if (unique.length === 1) return unique
  const contiguous = /(\bthrough\b|\bto\b|[-–—])/i.test(text)
  if (!contiguous) return unique.sort((left, right) => left - right)
  // "Friday through Monday" wraps the weekend, so walk forward from the first
  // named day to the last one instead of assuming an ascending range.
  const first = named[0]
  const last = named[named.length - 1]
  const range = []
  for (let step = 0; step < 7; step += 1) {
    const day = (first + step) % 7
    range.push(day)
    if (day === last) break
  }
  return range
}

/**
 * Read the peak windows and discount out of the pricing page's footnote.
 * Returns null pieces when the prose no longer has the shape it has today,
 * so the caller keeps the shipped schedule instead of guessing.
 */
function readSchedule(markdown) {
  // Prefer the candidate that carries the UTC marker: "Off-peak hours are"
  // contains the same phrase and must not win just because it comes first.
  const candidates = [...markdown.matchAll(/Peak hours\s+are\s+([^.]+)\./gi)].map(match => match[1])
  const sentence = candidates.find(text => /\bUTC\b/i.test(text)) ?? candidates[0]
  if (sentence === undefined) return { windows: null, discount: null, warning: 'pricing page no longer states its peak hours; keeping the shipped schedule' }
  const utcIndex = sentence.toUpperCase().indexOf(' UTC')
  if (utcIndex === -1) return { windows: null, discount: null, warning: 'peak-hours sentence has no UTC marker; keeping the shipped schedule' }
  const rangePart = sentence.slice(0, utcIndex)
  const dayPart = sentence.slice(utcIndex + 4)
  const windows = []
  for (const match of rangePart.matchAll(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g)) {
    const start = Number(match[1]) * 60 + Number(match[2])
    const end = Number(match[3]) * 60 + Number(match[4])
    if (start >= 0 && start < end && end <= 1440) windows.push({ start, end })
  }
  if (windows.length === 0) return { windows: null, discount: null, warning: 'peak-hours sentence has no time ranges; keeping the shipped schedule' }
  const days = readDays(dayPart)
  if (days === null) return { windows: null, discount: null, warning: 'peak-hours sentence has no weekdays; keeping the shipped schedule' }
  const discountSentence = /off-peak rates?[^.]*\./i.exec(markdown)?.[0] ?? sentence
  const readDiscount = () => {
    if (/half/i.test(discountSentence)) return { discount: 0.5, warning: null }
    // Decide from the words after the number, never from "Off" in "Off-peak".
    const percentOff = /(\d{1,3})\s*%\s*off\b/i.exec(discountSentence)
    if (percentOff !== null) {
      const value = Number(percentOff[1]) / 100
      return value > 0 && value < 1
        ? { discount: value, warning: null }
        : { discount: null, warning: 'off-peak discount is outside 0-100%; keeping the shipped 50%' }
    }
    const percentOf = /(\d{1,3})\s*%\s*of\b/i.exec(discountSentence)
    if (percentOf !== null) {
      const value = 1 - Number(percentOf[1]) / 100
      return value > 0 && value < 1
        ? { discount: value, warning: null }
        : { discount: null, warning: 'off-peak price share is outside 0-100%; keeping the shipped 50%' }
    }
    const bare = /(\d{1,3})\s*%/.exec(discountSentence)
    if (bare !== null) {
      const value = Number(bare[1]) / 100
      return value > 0 && value < 1
        ? { discount: value, warning: `off-peak discount wording is ambiguous; read it as ${value * 100}% off` }
        : { discount: null, warning: 'off-peak discount wording is unreadable; keeping the shipped 50%' }
    }
    return { discount: null, warning: 'off-peak discount is not stated; keeping the shipped 50%' }
  }
  const { discount, warning: discountWarning } = readDiscount()
  const warning = discountWarning === null ? null : discountWarning
  return { windows: windows.map(window => ({ days, start: window.start, end: window.end })), discount, warning }
}

/**
 * Parse the official pricing markdown into per-model peak and off-peak rates.
 * Every accepted model must carry cache-hit, cache-miss, and output prices for
 * both tiers; anything less is dropped with a warning rather than guessed.
 * @param markdown - the pricing document's text.
 * @returns `{ models, schedule, warnings }`. `models` is null when no usable
 * model row was found; `schedule` carries whatever the footnote still says.
 */
export function parsePricingMarkdown(markdown) {
  const warnings = []
  const schedule = readSchedule(typeof markdown === 'string' ? markdown : '')
  const noteSchedule = () => {
    if (schedule.warning !== null) warnings.push(schedule.warning)
  }
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return { models: null, schedule, warnings: ['the pricing document is empty'] }
  }
  const lines = markdown.split(/\r?\n/)
  const names = readModelColumns(lines)
  if (names === null) {
    warnings.push('the pricing table has no model columns')
    noteSchedule()
    return { models: null, schedule, warnings }
  }
  const parsed = Object.create(null)
  for (const name of names) parsed[name] = { peak: {}, offPeak: {} }
  let rows = 0
  for (const line of lines) {
    const cells = rowCells(line)
    if (cells === null || !/^PRICING/i.test(cells[0])) continue
    const metricIndex = cells.findIndex(cell => metricField(cell) !== null)
    if (metricIndex === -1) continue
    const field = metricField(cells[metricIndex])
    const tierIndex = cells.findIndex(cell => /^(OFF[- ]?PEAK|PEAK)$/i.test(cell))
    if (tierIndex === -1) continue
    const tier = /^OFF/i.test(cells[tierIndex]) ? 'offPeak' : 'peak'
    const values = cells.slice(tierIndex + 1)
    if (values.length !== names.length) {
      warnings.push(`pricing row "${cells[1]}" ${tier} has ${values.length} price cells for ${names.length} models`)
      continue
    }
    // A non-numeric price cell marks that model's row incomplete; it is left
    // unset so the model is dropped later instead of borrowing a neighbour's
    // price. Rows stay per-model so one retired model cannot poison the table.
    let assigned = false
    names.forEach((name, index) => {
      const price = priceCell(values[index])
      if (price === null) return
      parsed[name][tier][field] = price
      assigned = true
    })
    if (assigned) rows += 1
  }
  if (rows === 0) {
    warnings.push('the pricing table has no readable PRICING rows')
    noteSchedule()
    return { models: null, schedule, warnings }
  }
  const models = Object.create(null)
  for (const [name, rates] of Object.entries(parsed)) {
    if (!RATE_FIELDS.every(field => finiteNonNegative(rates.peak[field]) && finiteNonNegative(rates.offPeak[field]))) {
      warnings.push(`pricing for "${name}" is incomplete; keeping the shipped rates for it`)
      continue
    }
    const implausible = RATE_FIELDS.some(field => rates.peak[field] > 1000 || rates.offPeak[field] > 1000 || rates.offPeak[field] > rates.peak[field])
    if (implausible) {
      warnings.push(`pricing for "${name}" is implausible; keeping the shipped rates for it`)
      continue
    }
    if (typeof schedule.discount === 'number' && rates.peak.input > 0) {
      const expected = 1 - schedule.discount
      const ratio = rates.offPeak.input / rates.peak.input
      if (Math.abs(ratio - expected) > 0.01) {
        warnings.push(`off-peak input for "${name}" is ${Math.round(ratio * 100)}% of peak, not the stated ${Math.round(expected * 100)}%; its own price row is used`)
      }
    }
    models[name] = rates
  }
  noteSchedule()
  return { models: Object.keys(models).length > 0 ? models : null, schedule, warnings }
}

/**
 * Whether a parsed rate table is worth switching to: at least one model with
 * complete, plausible peak and off-peak prices.
 * @param models - parsed models, or null.
 * @returns true when the refresh can replace the shipped table.
 */
export function isUsableRateTable(models) {
  if (!isRecord(models)) return false
  return Object.values(models).some(rates => RATE_FIELDS.every(field =>
    finiteNonNegative(rates?.peak?.[field]) && finiteNonNegative(rates?.offPeak?.[field])
    && rates.offPeak[field] <= rates.peak[field]))
}
