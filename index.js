/**
 * Host half of the Session spend plugin: registers the `sessionSpend` session
 * projection, the one place this plugin turns provider-reported token usage
 * into an estimated cost. The projection seam carries the finished value to
 * the browser half, which renders it in the composer dock.
 *
 * The row's `config` is normalized here rather than declared as a plugin
 * `Config`, so the bundle ships without a schema dependency. List price tables
 * are overridable from the profile's `cordis.patch.yml`.
 */

import { createProjectionDefinition, normalizeConfig } from './projection.js'

/** Cordis plugin name. */
export const name = 'spend-tracker'

/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `sessionSpend` unit; the registration is an effect on this
 * plugin's fiber, so disabling the row removes the key again.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - row configuration: currency symbol, display precision, rate tables.
 * @returns when the unit is registered.
 */
export async function apply(ctx, config) {
  const resolved = normalizeConfig(config)
  await ctx.sessionProjections.register(createProjectionDefinition(resolved))
}
