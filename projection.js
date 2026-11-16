/**
 * Pure fold behind the `sessionSpend` session projection: provider-reported
 * token usage becomes an estimated cost plus token, call, and activity totals.
 *
 * The fold follows `@deepseek-ai/dsh-token-meter`'s `tokenUsage` unit: one
 * usage sample is attributed to the (turn, step) it belongs to, a settlement
 * that repeats a step replaces the earlier sample, and `llm/retry-started`
 * closes the replacement slot so the retried attempt adds instead of replacing.
 * A retried attempt that already streamed was billable, so its tokens stay
 * counted. Cost is derived in the wire view from token buckets and a per-model
 * rate table, so a pricing change reprices existing sessions instead of
 * rewriting durable state.
 *
 * State is plain JSON (the projection cache requires it) and is checkpointed,
 * so every field is validated on restore by {@link stateSchema}.
 */

/** Token buckets carried by one usage sample. */
const UNITS = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning']

/** Buckets a rate table charges for; reasoning tokens are billed inside output. */
const BILLED = ['input', 'cacheRead', 'cacheWrite', 'output']

/** Route used when usage landed without any logged model route. */
export const UNKNOWN_ROUTE = 'unknown'

/** Wire field names of a rate table, in cost order. */
const RATE_FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output']

/**
 * Shipped estimates in currency units per million tokens, keyed by bare model
 * id. These are the official DeepSeek peak-hour rates for the two models the
 * shipped adapter catalogs; off-peak hours bill about half, so the folded cost
 * is an upper estimate unless the user overrides the table.
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

/**
 * Normalize a raw plugin `config` value into the fold's pricing options.
 * Malformed values are ignored and reported, so a half-configured price table
 * leaves a route visibly unpriced instead of billing it at borrowed rates.
 * @param raw - the loader row's `config` value, possibly undefined.
 * @returns currency symbol, display precision, complete rate tables, whether
 * the shipped peak-rate table is still in use, and configuration warnings.
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
  const pricing = Object.create(null)
  for (const [model, rates] of Object.entries(BUILTIN_RATES)) pricing[model] = { ...rates }

  // The fallback prices routes nothing else covers, so it must be complete on its own.
  let fallback = null
  if (config.defaultPricing !== undefined && config.defaultPricing !== null) {
    fallback = isRecord(config.defaultPricing) ? completeRates(config.defaultPricing, null) : null
    if (fallback === null) {
      warnings.push('defaultPricing needs input, cacheRead, cacheWrite, and output; ignoring it')
    }
  }

  // The shipped peak-rate caveat stays true while every shipped model still
  // bills from its shipped table; pricing an unrelated route changes nothing.
  let overridden = false
  if (config.pricing !== undefined && config.pricing !== null) {
    if (!isRecord(config.pricing)) {
      warnings.push('pricing must be an object; ignoring it')
    } else {
      for (const [route, rates] of Object.entries(config.pricing)) {
        if (route === '') {
          warnings.push('pricing keys must be a model id or a provider/model route')
          continue
        }
        const model = route.includes('/') ? route.slice(route.indexOf('/') + 1) : route
        const shipped = Object.hasOwn(BUILTIN_RATES, model) ? BUILTIN_RATES[model] : null
        const complete = completeRates(rates, shipped ?? fallback)
        if (complete === null) {
          warnings.push(`pricing["${route}"] needs all four rates (input, cacheRead, cacheWrite, output); ignoring it`)
          continue
        }
        if (shipped !== null) overridden = true
        pricing[route] = complete
      }
    }
  }
  return { currencySymbol: symbol, decimals, pricing, fallback, shippedRates: !overridden, warnings }
}

/** Resolve the rate table for one route: exact route, bare model id, then fallback. */
function ratesFor(config, route) {
  const pricing = config.pricing
  if (Object.hasOwn(pricing, route)) return pricing[route]
  const slash = route.indexOf('/')
  const model = slash === -1 ? route : route.slice(slash + 1)
  if (Object.hasOwn(pricing, model)) return pricing[model]
  return config.fallback
}

/** Estimated cost of one unit set in currency units. */
function costOf(units, rates) {
  let micro = 0
  for (const field of RATE_FIELDS) micro += units[field] * rates[field]
  return micro / 1e6
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

function checkModel(value, where) {
  if (!isRecord(value)) fail(where, 'expected a model entry')
  if (!isCount(value.calls)) fail(where, 'calls must be a non-negative integer')
  checkUnits(value, where)
}

function checkSample(value, where) {
  if (value === null) return
  if (!isRecord(value)) fail(where, 'expected a sample or null')
  if (!isCount(value.turn) || !isCount(value.step)) fail(where, 'turn and step must be non-negative integers')
  if (typeof value.route !== 'string' || value.route === '') fail(where, 'route must be a non-empty string')
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
  for (const field of ['cost', 'costInput', 'costCacheRead', 'costCacheWrite', 'costOutput', 'unpricedTokens']) {
    if (!finiteNonNegative(value[field])) fail('view', `${field} must be a non-negative number`)
  }
  checkTokenTotals(value.tokens, 'view.tokens')
  for (const field of ['calls', 'turns', 'steps', 'toolCalls', 'toolErrors', 'retries', 'compactions', 'pricedCalls', 'unpricedCalls', 'modelsTotal']) {
    if (!isCount(value[field])) fail('view', `${field} must be a non-negative integer`)
  }
  if (typeof value.peakRates !== 'boolean') fail('view', 'peakRates must be a boolean')
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

/** One model entry with a signed bucket delta and a signed call delta applied. */
function withModelDelta(models, route, units, calls) {
  const base = Object.hasOwn(models, route)
    ? models[route]
    : { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }
  const next = { calls: Math.max(0, base.calls + calls) }
  for (const field of UNITS) next[field] = Math.max(0, base[field] + units[field])
  const modelsNext = { ...models }
  if (next.calls === 0 && unitsAreZero(next)) delete modelsNext[route]
  else modelsNext[route] = next
  return modelsNext
}

/** Record one usage sample, replacing the sample of the same (turn, step). */
function withSample(state, turn, step, route, units) {
  const previous = state.sample
  const replaces = previous !== null && previous.turn === turn && previous.step === step
  let models = replaces ? withModelDelta(state.models, previous.route, negate(previous.units), -1) : state.models
  models = withModelDelta(models, route, units, 1)
  return {
    ...state,
    models,
    calls: state.calls + (replaces ? 0 : 1),
    sample: { turn, step, route, units },
  }
}

/** The `sessionSpend` projection unit for one resolved configuration. */
export function createProjectionDefinition(config) {
  let lastState
  let lastView

  return {
    key: 'sessionSpend',
    // Version 2 changed retry billing: version-1 rows must refold from the log.
    stateVersion: 2,
    stateSchema,
    init: initialState,
    apply: (state, event) => {
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
          return withSample(state, event.data.turn, event.data.step, route, bucketsOf(usage))
        }
        case 'compaction/summary': {
          // The summarize call is its own request: it never replaces a step sample.
          if (!isRecord(event.data.usage)) return state
          const route = routeOf(event.data) ?? state.route ?? UNKNOWN_ROUTE
          return { ...state, models: withModelDelta(state.models, route, bucketsOf(event.data.usage), 1), calls: state.calls + 1 }
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
      // The registry publishes only when this reference changes; immutable
      // state makes the state reference itself a sound memo key.
      view: state => {
        if (state !== lastState) {
          lastState = state
          lastView = buildView(state, config)
        }
        return lastView
      },
      summary: false,
    },
  }
}

/** Turn fold state plus configuration into the wire value the Client renders. */
export function buildView(state, config) {
  const totals = zeroUnits()
  let costInput = 0
  let costCacheRead = 0
  let costCacheWrite = 0
  let costOutput = 0
  let pricedCalls = 0
  let unpricedCalls = 0
  let unpricedTokens = 0
  const models = []
  for (const [route, entry] of Object.entries(state.models)) {
    for (const field of UNITS) totals[field] += entry[field]
    const rates = ratesFor(config, route)
    let cost = 0
    if (rates === null) {
      unpricedCalls += entry.calls
      unpricedTokens += billedTotal(entry)
    } else {
      costInput += entry.input * rates.input / 1e6
      costCacheRead += entry.cacheRead * rates.cacheRead / 1e6
      costCacheWrite += entry.cacheWrite * rates.cacheWrite / 1e6
      costOutput += entry.output * rates.output / 1e6
      cost = costOf(entry, rates)
      pricedCalls += entry.calls
    }
    models.push({
      route,
      priced: rates !== null,
      cost: roundCost(cost),
      calls: entry.calls,
      tokens: {
        input: entry.input,
        cacheRead: entry.cacheRead,
        cacheWrite: entry.cacheWrite,
        output: entry.output,
        reasoning: entry.reasoning,
        total: billedTotal(entry),
      },
    })
  }
  models.sort((left, right) => right.cost - left.cost
    || right.tokens.total - left.tokens.total
    || (left.route < right.route ? -1 : left.route > right.route ? 1 : 0))
  return {
    currencySymbol: config.currencySymbol,
    decimals: config.decimals,
    cost: roundCost(costInput + costCacheRead + costCacheWrite + costOutput),
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
    peakRates: config.shippedRates,
    modelsTotal: models.length,
    models: models.slice(0, MAX_MODEL_ROWS),
  }
}
