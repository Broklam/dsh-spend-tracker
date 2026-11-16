/**
 * Host half of the Session spend plugin: registers the `sessionSpend` session
 * projection, the one place this plugin turns provider-reported token usage
 * into an estimated cost, and keeps its price table current from DeepSeek's
 * published pricing page.
 *
 * The projection seam carries the finished value to the browser half, which
 * renders it in the composer dock. The row's `config` is normalized here rather
 * than declared as a plugin `Config`, so the bundle ships without a schema
 * dependency. Rate tables are overridable from the profile's
 * `cordis.patch.yml`; a malformed table is ignored with a warning instead of
 * pricing a route at borrowed rates.
 *
 * The refresh is best effort: it reads the public pricing document without
 * credentials, keeps the last shipped table when the network or the page's
 * format fails, and never blocks plugin activation.
 */

import { applyRemotePricing, createProjectionDefinition, normalizeConfig } from './projection.js'
import { CN_HOLIDAYS, parsePricingMarkdown } from './pricing.js'

/** Cordis plugin name. */
export const name = 'spend-tracker'

/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/** How long one pricing-page request may take before it is abandoned. */
const FETCH_TIMEOUT_MS = 15000
/** Short retry delay after a failed refresh, before falling back to the full period. */
const RETRY_AFTER_MS = 15 * 60 * 1000
/** Refuse an oversized pricing document instead of handing it to the parser. */
const MAX_PRICING_CHARS = 1024 * 1024
/** Web-service failures that mean "no provider", not "the page failed". */
const SELECTION_FAILURE_CODES = new Set([
  'WEB_PROVIDER_UNAVAILABLE',
  'WEB_PROVIDER_CONFIGURED_MISSING',
  'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
  'WEB_PROVIDER_AMBIGUOUS',
])

function warn(ctx, message) {
  if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(`spend-tracker: ${message}`)
}

function info(ctx, message) {
  if (typeof ctx.logger?.info === 'function') ctx.logger.info(`spend-tracker: ${message}`)
}

/**
 * Read the pricing document through DSH's web capability when it is mounted,
 * falling back to the process-wide `fetch`. Both paths return the decoded text.
 * @param ctx - plugin context.
 * @param url - https URL of the pricing document.
 * @param signal - plugin-lifetime cancellation signal.
 * @returns the document text.
 */
async function fetchPricingDocument(ctx, url, signal) {
  const web = typeof ctx.get === 'function' ? ctx.get('web') : undefined
  if (web !== undefined && typeof web.fetch === 'function') {
    try {
      const result = await web.fetch({ url }, signal)
      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(`DeepSeek pricing page answered HTTP ${result.statusCode}`)
      }
      if (result.truncated) throw new Error('DeepSeek pricing page was truncated')
      const content = result.body?.content
      if (typeof content !== 'string') throw new Error('DeepSeek pricing page returned no text')
      if (content.length > MAX_PRICING_CHARS) throw new Error('DeepSeek pricing page is too large to parse safely')
      return content
    } catch (error) {
      // A registered but unavailable provider is a selection failure, not a
      // network answer; the direct client below still reads the public page.
      // A real fetch failure is reported as-is instead of retried twice.
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
      if (!SELECTION_FAILURE_CODES.has(code) || typeof fetch !== 'function' || signal.aborted) throw error
    }
  }
  if (typeof fetch !== 'function') throw new Error('no HTTP client is available in this Host')
  const response = await fetch(url, {
    signal,
    headers: {
      accept: 'text/markdown, text/plain;q=0.9, */*;q=0.5',
      'user-agent': 'dsh-spend-tracker',
    },
  })
  if (!response.ok) throw new Error(`DeepSeek pricing page answered HTTP ${response.statusCode}`)
  const text = await response.text()
  if (text.length > MAX_PRICING_CHARS) throw new Error('DeepSeek pricing page is too large to parse safely')
  return text
}

/**
 * Keep the live rate table in step with DeepSeek's published prices: one fetch
 * at activation, then one per configured interval. A failed attempt is retried
 * after a short delay (up to three times) so a boot without a network does not
 * postpone fresh prices for a whole refresh period. Failures leave the previous
 * table in place and are reported once per distinct message.
 * @param ctx - plugin context.
 * @param resolved - normalized config, mutated in place on a successful refresh.
 * @returns the cleanup that aborts a pending request and stops the timer.
 */
function startPriceRefresh(ctx, resolved) {
  let timer = null
  let active = null
  let lastFailure = null
  let failures = 0
  let stopped = false
  const period = resolved.refreshHours * 60 * 60 * 1000
  const reported = new Set()
  const warnOnce = message => {
    if (reported.has(message)) return
    reported.add(message)
    warn(ctx, message)
  }
  if (!resolved.scheduleConfigured) {
    const latestHolidayYear = Math.max(...CN_HOLIDAYS.map(day => Number(day.slice(0, 4))))
    const year = new Date().getUTCFullYear()
    if (year > latestHolidayYear) {
      warn(ctx, `no Chinese public holidays are bundled for ${year}; weekday holidays bill at peak until the plugin updates`)
    }
  }

  const refresh = async () => {
    if (stopped) return
    const controller = new AbortController()
    active = controller
    const timeout = setTimeout(() => { controller.abort() }, FETCH_TIMEOUT_MS)
    try {
      const markdown = await fetchPricingDocument(ctx, resolved.pricingUrl, controller.signal)
      const parsed = parsePricingMarkdown(markdown)
      for (const warning of parsed.warnings) warnOnce(warning)
      const applied = applyRemotePricing(resolved, parsed, { url: resolved.pricingUrl, updatedAt: Date.now() })
      if (!applied) {
        failures += 1
        const message = 'the pricing page did not contain a usable rate table; keeping the current prices'
        if (message !== lastFailure) warn(ctx, message)
        lastFailure = message
        return
      }
      failures = 0
      lastFailure = null
      const models = Object.keys(resolved.remote.models).length
      info(ctx, `refreshed ${models} DeepSeek price row${models === 1 ? '' : 's'} from ${resolved.pricingUrl}`)
    } catch (error) {
      if (stopped) return
      failures += 1
      const message = `could not refresh prices (${error instanceof Error ? error.message : String(error)}); keeping the current table`
      if (message !== lastFailure) warn(ctx, message)
      lastFailure = message
    } finally {
      clearTimeout(timeout)
      if (active === controller) active = null
    }
  }

  const plan = () => {
    if (stopped) return
    const delay = failures === 0 ? period : failures <= 3 ? RETRY_AFTER_MS : period
    timer = setTimeout(async () => {
      await refresh()
      plan()
    }, delay)
    if (typeof timer.unref === 'function') timer.unref()
  }

  void refresh().then(plan)

  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    if (active !== null) active.abort()
  }
}

/**
 * Register the `sessionSpend` unit and, unless disabled, its price refresh.
 * The registration is an effect on this plugin's fiber, so disabling the row
 * removes the key again.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - row configuration: currency symbol, display precision, rate
 * tables, off-peak schedule, and pricing-source options.
 * @returns when the unit is registered.
 */
export async function apply(ctx, config) {
  const resolved = normalizeConfig(config)
  for (const warning of resolved.warnings) warn(ctx, warning)
  await ctx.sessionProjections.register(createProjectionDefinition(resolved))
  if (resolved.pricingSource === 'off') {
    info(ctx, 'live price refresh is disabled; using the shipped table and configured overrides')
    return
  }
  ctx.effect(() => startPriceRefresh(ctx, resolved), 'spend-tracker.price-refresh')
}
