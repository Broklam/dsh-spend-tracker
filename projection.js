/**
 * Pure fold behind the `sessionSpend` session projection: provider-reported
 * token usage becomes an estimated cost plus token, call, and activity totals.
 *
 * The fold follows `@deepseek-ai/dsh-token-meter`'s `tokenUsage` unit: one
 * usage sample is attributed to the (turn, step) it belongs to, a settlement
 * that repeats a step replaces the earlier sample, and `llm/retry-started`
 * closes the replacement slot so the retried attempt adds instead of replacing.
 * A retried attempt that already streamed was billable, so its tokens stay
 * counted.
 *
 * Cost is not folded into state. The fold keeps per-tier token buckets (peak
 * versus off-peak, classified from each event's own timestamp with DeepSeek's
 * published UTC windows), and the wire view turns those buckets into money with
 * the current rate table. A price refresh or a schedule correction therefore
 * reprices existing sessions without rewriting durable state.
 *
 * State is plain JSON (the projection cache requires it) and is checkpointed,
 * so every field is validated on restore by {@link stateSchema}.
 */

import {
  PRICING_URL,
  isUsableRateTable,
  normalizeOffPeak,
  tierAt,
} from './pricing.js'

/** Token buckets carried by one usage sample. */
const UNITS = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning']

/** Buckets a rate table charges for; reasoning tokens are billed inside output. */
const BILLED = ['input', 'cacheRead', 'cacheWrite', 'output']

/** Route used when usage landed without any logged model route. */
export const UNKNOWN_ROUTE = 'unknown'

/** Wire field names of a rate table, in cost order. */
const RATE_FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output']

/**
 * Shipped peak-hour estimates in currency units per million tokens, keyed by
 * bare model id: the official DeepSeek peak prices for the two models the
 * shipped adapter catalogs. Cache writes bill at the cache-miss rate because
 * DeepSeek reports no separate cache-write price. Off-peak hours bill at
 * `1 - discount` of these.
 */
export const BUILTIN_RATES = Object.freeze({
  'deepseek-flash': Object.freeze({ input: 0.3, cacheRead: 0.006, cacheWrite: 0.3, output: 1.2 }),
  'deepseek-v4-pro': Object.freeze({ input: 1.32, cacheRead: 0.044, cacheWrite: 1.32, output: 3.96 }),
})

/** Default display currency symbol. */
const DEFAULT_CURRENCY = '$'
/** Default maximum fraction digits of a displayed cost. */
const DEFAULT_DECIMALS = 4
/** Model rows carried by one wire value; a session rarely bills more. */
const MAX_MODEL_ROWS = 8
/** Minutes between background rate refreshes when the user does not choose. */
export const DEFAULT_REFRESH_HOURS = 6

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function zeroUnits() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }
}

/** One provider-reported usage value as a non-negative number. */
function tokenCount(value) {
  return finiteNonNegative(value) ? value : 0
}

/** Read the buckets a `TokenUsage` record reports. */
function bucketsOf(usage) {
  return {
    input: tokenCount(usage.inputTokens),
    cacheRead: tokenCount(usage.cacheReadTokens),
    cacheWrite: tokenCount(usage.cacheWriteTokens),
    output: tokenCount(usage.outputTokens),
    reasoning: tokenCount(usage.reasoningTokens),
  }
}

function negate(units) {
  return { input: -units.input, cacheRead: -units.cacheRead, cacheWrite: -units.cacheWrite, output: -units.output, reasoning: -units.reasoning }
}

/** Every bucket of a unit set is zero. */
function unitsAreZero(units) {
  return UNITS.every(field => units[field] === 0)
}

/** Prompt-side plus completion tokens; reasoning stays informational. */
function billedTotal(units) {
  return BILLED.reduce((sum, field) => sum + units[field], 0)
}

/** `provider/model`, or null when either half is missing. */
function routeOf(source) {
  if (!isRecord(source)) return null
  const provider = source.provider
  const model = source.model
  if (typeof provider !== 'string' || provider === '') return null
  if (typeof model !== 'string' || model === '') return null
  return `${provider}/${model}`
}

/** The usage a durable assistant settlement reports, or undefined. */
function usageOf(event) {
  if (event.type === 'assistant/message' && isRecord(event.data.usage)) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastStreamUsage(event.data.stream)
}

/** Last `usage` chunk in an embedded assistant stream (retry-safe by position). */
function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (isRecord(record) && record.type === 'chunk' && isRecord(record.chunk) && record.chunk.type === 'usage') {
      return isRecord(record.chunk.usage) ? record.chunk.usage : undefined
    }
  }
  return undefined
}

/** Read the non-negative rates a configured table provides. */
function readRates(raw) {
  const rates = {}
  if (!isRecord(raw)) return rates
  for (const field of RATE_FIELDS) {
    if (finiteNonNegative(raw[field])) rates[field] = raw[field]
  }
  return rates
}

/**
 * Merge configured rates over a base and keep the result only when it is
 * complete; a route with a missing rate cannot be priced honestly.
 * @param raw - the configured table.
 * @param base - complete fallback rates, or null when the route has none.
 * @returns the complete table, or null.
 */
function completeRates(raw, base) {
  const rates = { ...base }
  const provided = readRates(raw)
  for (const field of RATE_FIELDS) {
    if (provided[field] !== undefined) rates[field] = provided[field]
  }
  return RATE_FIELDS.every(field => finiteNonNegative(rates[field])) ? rates : null
}

/** Copy a shipped rate table, filling a missing cache-write rate from cache-miss. */
function shippedTable(rates) {
  return {
    input: rates.input,
    cacheRead: rates.cacheRead,
    cacheWrite: finiteNonNegative(rates.cacheWrite) ? rates.cacheWrite : rates.input,
    output: rates.output,
  }
}

/** `provider/model` route and bare model id, for table lookups. */
function modelOf(route) {
  const slash = route.indexOf('/')
  return slash === -1 ? route : route.slice(slash + 1)
}

/** Scale every rate in one table by a multiplier. */
function scaledRates(rates, multiplier) {
  return {
    input: rates.input * multiplier,
    cacheRead: rates.cacheRead * multiplier,
    cacheWrite: rates.cacheWrite * multiplier,
    output: rates.output * multiplier,
  }
}

/**
 * Resolve the rate pair for one route. User-provided fields override the live
 * peak base (refreshed table, shipped table, then fallback); off-peak rates
 * come from the refreshed table itself when it has them, and otherwise follow
 * the published discount.
 */
function ratesFor(config, route) {
  const model = modelOf(route)
  const user = config.userPricing
  const provided = Object.hasOwn(user, route) ? user[route] : Object.hasOwn(user, model) ? user[model] : undefined
  const remoteModels = config.remote === null ? null : config.remote.models
  const remote = remoteModels === null
    ? null
    : Object.hasOwn(remoteModels, route) ? remoteModels[route] : Object.hasOwn(remoteModels, model) ? remoteModels[model] : null
  const shipped = Object.hasOwn(config.models, route) ? config.models[route] : Object.hasOwn(config.models, model) ? config.models[model] : null
  const base = remote === null ? (shipped ?? config.fallback) : remote.peak
  if (provided === undefined) {
    if (remote !== null) return remote
    if (base === null) return null
    return { peak: base, offPeak: scaledRates(base, offPeakMultiplier(config)) }
  }
  const peak = completeRates(provided, base)
  if (peak === null) return null
  return { peak, offPeak: scaledRates(peak, offPeakMultiplier(config)) }
}

/** Off-peak multiplier applied to peak rates, or 1 while off-peak pricing is off. */
function offPeakMultiplier(config) {
  const schedule = config.schedule
  if (!schedule.enabled) return 1
  return 1 - schedule.discount
}

/** Rate table a refreshed model row contributes: one tier, cache writes at cache-miss. */
function remoteTable(rates, tier) {
  return {
    input: rates[tier].input,
    cacheRead: rates[tier].cacheRead,
    cacheWrite: rates[tier].input,
    output: rates[tier].output,
  }
}

/**
 * Normalize a raw plugin `config` value into the fold's pricing options.
 * Malformed values are ignored and reported, so a half-configured price table
 * leaves a route visibly unpriced instead of billing it at borrowed rates.
 * @param raw - the loader row's `config` value, possibly undefined.
 * @returns currency symbol, display precision, complete peak rate tables,
 * the off-peak schedule, and configuration warnings.
 */
export function normalizeConfig(raw) {
  const config = isRecord(raw) ? raw : {}
  const symbol = typeof config.currencySymbol === 'string' && config.currencySymbol.length > 0 && config.currencySymbol.length <= 4
    ? config.currencySymbol
    : DEFAULT_CURRENCY
  const decimals = Number.isSafeInteger(config.decimals) && config.decimals >= 0 && config.decimals <= 6
    ? config.decimals
    : DEFAULT_DECIMALS
  const warnings = []
  const models = Object.create(null)
  for (const [model, rates] of Object.entries(BUILTIN_RATES)) models[model] = shippedTable(rates)

  // The fallback prices routes nothing else covers, so it must be complete on its own.
  let fallback = null
  if (config.defaultPricing !== undefined && config.defaultPricing !== null) {
    fallback = isRecord(config.defaultPricing) ? completeRates(config.defaultPricing, null) : null
    if (fallback === null) {
      warnings.push('defaultPricing needs input, cacheRead, cacheWrite, and output; ignoring it')
    }
  }

  const userPricing = Object.create(null)
  if (config.pricing !== undefined && config.pricing !== null) {
    if (!isRecord(config.pricing)) {
      warnings.push('pricing must be an object; ignoring it')
    } else {
      for (const [route, rates] of Object.entries(config.pricing)) {
        if (route === '') {
          warnings.push('pricing keys must be a model id or a provider/model route')
          continue
        }
        if (!isRecord(rates)) {
          warnings.push(`pricing["${route}"] must be an object of rates; ignoring it`)
          continue
        }
        const model = modelOf(route)
        const shipped = Object.hasOwn(models, model) ? models[model] : null
        // Validate completeness now, but store only the fields the user set:
        // an untouched field follows the refreshed table at lookup time.
        if (completeRates(rates, shipped ?? fallback) === null) {
          warnings.push(`pricing["${route}"] needs all four rates (input, cacheRead, cacheWrite, output); ignoring it`)
          continue
        }
        userPricing[route] = readRates(rates)
      }
    }
  }

  const offPeak = normalizeOffPeak(config.offPeak, warnings)
  const schedule = {
    enabled: offPeak.enabled,
    discount: offPeak.discount,
    windows: offPeak.windows,
    holidays: offPeak.holidays,
  }

  let refreshHours = DEFAULT_REFRESH_HOURS
  if (config.refreshHours !== undefined) {
    if (Number.isSafeInteger(config.refreshHours) && config.refreshHours >= 1 && config.refreshHours <= 24 * 7) refreshHours = config.refreshHours
    else warnings.push('refreshHours must be an integer between 1 and 168; using 6')
  }
  let pricingSource = 'deepseek'
  if (config.pricingSource !== undefined) {
    if (config.pricingSource === 'off' || config.pricingSource === 'deepseek') pricingSource = config.pricingSource
    else warnings.push("pricingSource must be 'deepseek' or 'off'; using 'deepseek'")
  }
  let pricingUrl = PRICING_URL
  if (config.pricingUrl !== undefined) {
    if (typeof config.pricingUrl === 'string' && /^https:\/\//.test(config.pricingUrl)) pricingUrl = config.pricingUrl
    else warnings.push('pricingUrl must be an https URL; using the DeepSeek pricing page')
  }

  return {
    currencySymbol: symbol,
    decimals,
    models,
    userPricing,
    fallback,
    schedule,
    scheduleConfigured: offPeak.configured,
    remote: null,
    revision: 0,
    refreshHours,
    pricingSource,
    pricingUrl,
    warnings,
  }
}

/**
 * Replace the live rate table with one freshly parsed from the pricing page.
 * The fold state is untouched: the next wire read reprices every tier bucket
 * with the new peak prices, at the moment the pricing changes.
 * @param config - resolved config returned by {@link normalizeConfig}.
 * @param parsed - `parsePricingMarkdown` output; its models must be usable.
 * @param meta - when the document was fetched and from where.
 * @returns true when the new table was installed.
 */
export function applyRemotePricing(config, parsed, meta) {
  if (!isUsableRateTable(parsed?.models)) return false
  const models = Object.create(null)
  for (const [model, rates] of Object.entries(parsed.models)) {
    models[model] = { peak: remoteTable(rates, 'peak'), offPeak: remoteTable(rates, 'offPeak') }
  }
  config.remote = { models, url: meta.url, updatedAt: meta.updatedAt }
  if (!config.scheduleConfigured && isRecord(parsed.schedule) && Array.isArray(parsed.schedule.windows) && parsed.schedule.windows.length > 0) {
    config.schedule = {
      ...config.schedule,
      windows: parsed.schedule.windows,
      discount: typeof parsed.schedule.discount === 'number' && parsed.schedule.discount > 0 && parsed.schedule.discount < 1
        ? parsed.schedule.discount
        : config.schedule.discount,
    }
  }
  config.revision += 1
  return true
}

function roundCost(value) {
  return Math.round(value * 1e6) / 1e6
}

function fail(where, issue) {
  throw new TypeError(`sessionSpend projection ${where} is invalid: ${issue}`)
}

function checkUnits(value, where) {
  if (!isRecord(value)) fail(where, 'expected an object')
  for (const field of UNITS) {
    const number = value[field]
    if (!finiteNonNegative(number)) fail(where, `${field} must be a non-negative number`)
  }
}

function checkTierBuckets(value, where) {
  if (!isRecord(value)) fail(where, 'expected an object of tier buckets')
  checkUnits(value.peak, `${where}.peak`)
  checkUnits(value.offPeak, `${where}.offPeak`)
}

function checkModel(value, where) {
  if (!isRecord(value)) fail(where, 'expected a model entry')
  if (!isCount(value.calls)) fail(where, 'calls must be a non-negative integer')
  checkTierBuckets(value, where)
}

function checkSample(value, where) {
  if (value === null) return
  if (!isRecord(value)) fail(where, 'expected a sample or null')
  if (!isCount(value.turn) || !isCount(value.step)) fail(where, 'turn and step must be non-negative integers')
  if (typeof value.route !== 'string' || value.route === '') fail(where, 'route must be a non-empty string')
  if (value.tier !== 'peak' && value.tier !== 'offPeak') fail(where, 'tier must be "peak" or "offPeak"')
  checkUnits(value.units, `${where}.units`)
}

function checkState(value) {
  if (!isRecord(value)) fail('state', 'expected an object')
  for (const field of ['calls', 'turns', 'steps', 'toolCalls', 'toolErrors', 'retries', 'compactions']) {
    if (!isCount(value[field])) fail('state', `${field} must be a non-negative integer`)
  }
  if (!isRecord(value.models)) fail('state', 'models must be an object')
  for (const [route, entry] of Object.entries(value.models)) {
    if (route === '') fail('state', 'a model route must not be empty')
    checkModel(entry, `state.models[${JSON.stringify(route)}]`)
  }
  checkSample(value.sample, 'state.sample')
  if (value.route !== null && (typeof value.route !== 'string' || value.route === '')) fail('state', 'route must be a non-empty string or null')
  if (value.lastTurn !== null && !isCount(value.lastTurn)) fail('state', 'lastTurn must be a non-negative integer or null')
  return value
}

const stateSchema = { parse: checkState }

function checkWindow(value, where) {
  if (!isRecord(value)) fail(where, 'expected a window object')
  if (!Array.isArray(value.days) || value.days.length === 0) fail(where, 'days must be a non-empty array')
  for (const day of value.days) {
    if (!Number.isSafeInteger(day) || day < 0 || day > 6) fail(where, 'days must be weekday numbers 0-6')
  }
  if (!isCount(value.start) || value.start < 0 || value.start > 1440) fail(where, 'start must be a UTC minute 0-1440')
  if (!isCount(value.end) || value.end <= value.start || value.end > 1440) fail(where, 'end must be a UTC minute after start')
}

function checkSchedule(value, where) {
  if (!isRecord(value)) fail(where, 'expected an object')
  if (typeof value.enabled !== 'boolean') fail(where, 'enabled must be a boolean')
  if (typeof value.discount !== 'number' || !Number.isFinite(value.discount) || value.discount < 0 || value.discount >= 1) {
    fail(where, 'discount must be a fraction between 0 and 1')
  }
  if (!Array.isArray(value.windows)) fail(where, 'windows must be an array')
  value.windows.forEach((window, index) => checkWindow(window, `${where}.windows[${index}]`))
  if (!Array.isArray(value.holidays)) fail(where, 'holidays must be an array')
  for (const day of value.holidays) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(where, 'holidays must contain YYYY-MM-DD strings')
  }
}

function checkRatesMeta(value, where) {
  if (!isRecord(value)) fail(where, 'expected an object')
  if (value.source !== 'deepseek' && value.source !== 'shipped') fail(where, 'source must be "deepseek" or "shipped"')
  if (value.updatedAt !== null && !finiteNonNegative(value.updatedAt)) fail(where, 'updatedAt must be a timestamp or null')
  if (typeof value.url !== 'string' || value.url === '') fail(where, 'url must be a non-empty string')
}

function checkTokenTotals(value, where) {
  if (!isRecord(value)) fail(where, 'expected an object')
  for (const field of [...UNITS, 'total']) {
    if (!finiteNonNegative(value[field])) fail(where, `${field} must be a non-negative number`)
  }
}

function checkModelView(value, where) {
  if (!isRecord(value)) fail(where, 'expected a model row')
  if (typeof value.route !== 'string' || value.route === '') fail(where, 'route must be a non-empty string')
  if (typeof value.priced !== 'boolean') fail(where, 'priced must be a boolean')
  if (!finiteNonNegative(value.cost)) fail(where, 'cost must be a non-negative number')
  if (!isCount(value.calls)) fail(where, 'calls must be a non-negative integer')
  checkTokenTotals(value.tokens, where)
}

function checkView(value) {
  if (!isRecord(value)) fail('view', 'expected an object')
  if (typeof value.currencySymbol !== 'string' || value.currencySymbol === '') fail('view', 'currencySymbol must be a non-empty string')
  if (!isCount(value.decimals)) fail('view', 'decimals must be a non-negative integer')
  for (const field of ['cost', 'costPeak', 'costOffPeak', 'costInput', 'costCacheRead', 'costCacheWrite', 'costOutput', 'unpricedTokens']) {
    if (!finiteNonNegative(value[field])) fail('view', `${field} must be a non-negative number`)
  }
  checkTokenTotals(value.tokens, 'view.tokens')
  for (const field of ['calls', 'turns', 'steps', 'toolCalls', 'toolErrors', 'retries', 'compactions', 'pricedCalls', 'unpricedCalls', 'modelsTotal']) {
    if (!isCount(value[field])) fail('view', `${field} must be a non-negative integer`)
  }
  checkSchedule(value.schedule, 'view.schedule')
  checkRatesMeta(value.rates, 'view.rates')
  if (!Array.isArray(value.models)) fail('view', 'models must be an array')
  if (value.models.length > value.modelsTotal) fail('view', 'models must not exceed modelsTotal')
  value.models.forEach((row, index) => checkModelView(row, `view.models[${index}]`))
  return value
}

const viewSchema = { parse: checkView }

/** Fold state before any event. */
function initialState() {
  return {
    calls: 0,
    turns: 0,
    steps: 0,
    toolCalls: 0,
    toolErrors: 0,
    retries: 0,
    compactions: 0,
    models: {},
    sample: null,
    route: null,
    lastTurn: null,
  }
}

/**
 * One model entry with a signed bucket delta for one tier and a signed call
 * delta applied; an entry that returns to zero disappears.
 */
function withModelDelta(models, route, tier, units, calls) {
  const base = Object.hasOwn(models, route)
    ? models[route]
    : { calls: 0, peak: zeroUnits(), offPeak: zeroUnits() }
  const next = {
    calls: Math.max(0, base.calls + calls),
    peak: zeroUnits(),
    offPeak: zeroUnits(),
  }
  for (const kind of ['peak', 'offPeak']) {
    for (const field of UNITS) next[kind][field] = Math.max(0, base[kind][field] + (kind === tier ? units[field] : 0))
  }
  const modelsNext = { ...models }
  const empty = next.calls === 0 && unitsAreZero(next.peak) && unitsAreZero(next.offPeak)
  if (empty) delete modelsNext[route]
  else modelsNext[route] = next
  return modelsNext
}

/** Record one usage sample, replacing the sample of the same (turn, step). */
function withSample(state, turn, step, route, tier, units) {
  const previous = state.sample
  const replaces = previous !== null && previous.turn === turn && previous.step === step
  let models = replaces
    ? withModelDelta(state.models, previous.route, previous.tier, negate(previous.units), -1)
    : state.models
  models = withModelDelta(models, route, tier, units, 1)
  return {
    ...state,
    models,
    calls: state.calls + (replaces ? 0 : 1),
    sample: { turn, step, route, tier, units },
  }
}

/** The `sessionSpend` projection unit for one resolved configuration. */
export function createProjectionDefinition(config) {
  let lastState
  let lastRevision = -1
  let lastView

  return {
    key: 'sessionSpend',
    // Version 3 splits per-model token buckets into peak and off-peak tiers;
    // version-1/2 rows must refold from the log.
    stateVersion: 3,
    stateSchema,
    init: initialState,
    apply: (state, event) => {
      const tierFor = () => (typeof event.time === 'number' ? tierAt(event.time, config.schedule) : 'peak')
      switch (event.type) {
        case 'request/header': {
          const route = routeOf(event.data.header?.config)
          if (route === null || route === state.route) return state
          return { ...state, route }
        }
        case 'llm/retry-started': {
          const next = { ...state, retries: state.retries + 1 }
          const sample = state.sample
          // The superseded attempt's tokens stay counted: it was a billable
          // request. Closing the slot only stops the next settlement from
          // replacing it under the tokenUsage unit's rule.
          if (sample === null || sample.turn !== event.data.turn || sample.step !== event.data.step) return next
          return { ...next, sample: null }
        }
        case 'assistant/message':
        case 'assistant/attempt': {
          const usage = usageOf(event)
          if (usage === undefined) return state
          const settled = event.type === 'assistant/message' ? routeOf(event.data.message?.source) : null
          const route = settled ?? state.route ?? UNKNOWN_ROUTE
          return withSample(state, event.data.turn, event.data.step, route, tierFor(), bucketsOf(usage))
        }
        case 'compaction/summary': {
          // The summarize call is its own request: it never replaces a step sample.
          if (!isRecord(event.data.usage)) return state
          const route = routeOf(event.data) ?? state.route ?? UNKNOWN_ROUTE
          return { ...state, models: withModelDelta(state.models, route, tierFor(), bucketsOf(event.data.usage), 1), calls: state.calls + 1 }
        }
        case 'compaction/start':
          return { ...state, compactions: state.compactions + 1 }
        case 'tool/call':
          return { ...state, toolCalls: state.toolCalls + 1 }
        case 'tool/result': {
          if (event.data.message?.isError !== true) return state
          return { ...state, toolErrors: state.toolErrors + 1 }
        }
        case 'step/end': {
          const { turn } = event.data
          const turns = state.lastTurn === turn ? state.turns : state.turns + 1
          return { ...state, turns, steps: state.steps + 1, lastTurn: turn }
        }
        default:
          return state
      }
    },
    wire: {
      viewSchema,
      // The registry publishes only when this reference changes. A single
      // slot is enough: the registry reads one session's state at a time, and
      // the pricing revision forces a rebuild after a refresh.
      view: state => {
        if (state !== lastState || config.revision !== lastRevision) {
          lastState = state
          lastRevision = config.revision
          lastView = buildView(state, config)
        }
        return lastView
      },
      summary: false,
    },
  }
}

/** Estimated cost of one unit set at one complete rate table. */
function costOf(units, rates) {
  let micro = 0
  for (const field of RATE_FIELDS) micro += units[field] * rates[field]
  return micro / 1e6
}

/** Turn fold state plus configuration into the wire value the Client renders. */
export function buildView(state, config) {
  const totals = zeroUnits()
  let costInput = 0
  let costCacheRead = 0
  let costCacheWrite = 0
  let costOutput = 0
  let costPeak = 0
  let costOffPeak = 0
  let pricedCalls = 0
  let unpricedCalls = 0
  let unpricedTokens = 0
  const models = []
  for (const [route, entry] of Object.entries(state.models)) {
    const peakTotal = billedTotal(entry.peak)
    const offPeakTotal = billedTotal(entry.offPeak)
    for (const field of UNITS) totals[field] += entry.peak[field] + entry.offPeak[field]
    const rates = ratesFor(config, route)
    let cost = 0
    if (rates === null) {
      unpricedCalls += entry.calls
      unpricedTokens += peakTotal + offPeakTotal
    } else {
      const peakCost = costOf(entry.peak, rates.peak)
      const offPeakCost = costOf(entry.offPeak, rates.offPeak)
      for (const field of RATE_FIELDS) {
        const fieldCost = (entry.peak[field] * rates.peak[field] + entry.offPeak[field] * rates.offPeak[field]) / 1e6
        if (field === 'input') costInput += fieldCost
        else if (field === 'cacheRead') costCacheRead += fieldCost
        else if (field === 'cacheWrite') costCacheWrite += fieldCost
        else costOutput += fieldCost
      }
      costPeak += peakCost
      costOffPeak += offPeakCost
      cost = peakCost + offPeakCost
      pricedCalls += entry.calls
    }
    models.push({
      route,
      priced: rates !== null,
      cost: roundCost(cost),
      calls: entry.calls,
      tokens: {
        input: entry.peak.input + entry.offPeak.input,
        cacheRead: entry.peak.cacheRead + entry.offPeak.cacheRead,
        cacheWrite: entry.peak.cacheWrite + entry.offPeak.cacheWrite,
        output: entry.peak.output + entry.offPeak.output,
        reasoning: entry.peak.reasoning + entry.offPeak.reasoning,
        total: peakTotal + offPeakTotal,
      },
    })
  }
  models.sort((left, right) => right.cost - left.cost
    || right.tokens.total - left.tokens.total
    || (left.route < right.route ? -1 : left.route > right.route ? 1 : 0))
  return {
    currencySymbol: config.currencySymbol,
    decimals: config.decimals,
    cost: roundCost(costPeak + costOffPeak),
    costPeak: roundCost(costPeak),
    costOffPeak: roundCost(costOffPeak),
    costInput: roundCost(costInput),
    costCacheRead: roundCost(costCacheRead),
    costCacheWrite: roundCost(costCacheWrite),
    costOutput: roundCost(costOutput),
    tokens: { ...totals, total: billedTotal(totals) },
    calls: state.calls,
    turns: state.turns,
    steps: state.steps,
    toolCalls: state.toolCalls,
    toolErrors: state.toolErrors,
    retries: state.retries,
    compactions: state.compactions,
    pricedCalls,
    unpricedCalls,
    unpricedTokens,
    schedule: {
      enabled: config.schedule.enabled,
      discount: config.schedule.discount,
      windows: config.schedule.windows,
      holidays: config.schedule.holidays,
    },
    rates: {
      source: config.remote === null ? 'shipped' : 'deepseek',
      updatedAt: config.remote === null ? null : remoteUpdatedAt(config),
      url: config.remote === null ? config.pricingUrl : config.remote.url,
    },
    modelsTotal: models.length,
    models: models.slice(0, MAX_MODEL_ROWS),
  }
}

/** Timestamp of the installed remote table, or null. */
function remoteUpdatedAt(config) {
  return config.remote === null ? null : config.remote.updatedAt
}
