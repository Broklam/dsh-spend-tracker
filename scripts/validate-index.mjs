/**
 * Structural check of the published plugin index.
 *
 * DSH validates the complete format-1 rule set when a user adds the index; this
 * script catches the mistakes that would otherwise reach the live Pages site,
 * with no dependencies. Run it locally with `node scripts/validate-index.mjs`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'

const INDEX_PATH = 'marketplace/index.json'
const INDEX_DIR = 'marketplace'
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
/** One SemVer comparator token accepted in an `engines.dsh` range. */
const RANGE_TOKEN = /^(?:(?:[<>=^~]{0,2})v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?|\*|x)$/

function fail(message) {
  console.error(`Invalid plugin index: ${message}`)
  process.exit(1)
}

/** Whether a range is made only of comparator tokens the format permits. */
function validRange(range) {
  if (typeof range !== 'string' || range.trim() === '') return false
  return range.split('||').every(part => {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    return tokens.length > 0 && tokens.every(token => RANGE_TOKEN.test(token))
  })
}

let index
try {
  index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
} catch (error) {
  fail(`${INDEX_PATH} is not valid JSON (${error.message})`)
}

if (index.format !== 1) fail('format must be 1')
if (!Array.isArray(index.plugins) || index.plugins.length === 0) fail('plugins must be a non-empty array')

const names = new Set()
for (const plugin of index.plugins) {
  if (typeof plugin.name !== 'string' || plugin.name === '') fail('every plugin needs a non-empty name')
  if (names.has(plugin.name)) fail(`duplicate plugin name ${plugin.name}`)
  names.add(plugin.name)
  if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) fail(`${plugin.name} needs at least one version`)

  const versions = new Set()
  for (const version of plugin.versions) {
    if (!SEMVER.test(version.version)) fail(`${plugin.name} has an invalid version: ${String(version.version)}`)
    if (versions.has(version.version)) fail(`${plugin.name} repeats version ${version.version}`)
    versions.add(version.version)
    if (!Number.isInteger(version.publishTimestamp)) fail(`${plugin.name} ${version.version} needs an integer publishTimestamp`)
    if (version.engines?.dsh !== undefined && !validRange(version.engines.dsh)) {
      fail(`${plugin.name} ${version.version} has an invalid engines.dsh range: ${String(version.engines.dsh)}`)
    }
    if (version.source?.type === 'git') {
      if (!/^[0-9a-f]{40}$/.test(version.source.commit ?? '')) fail(`${plugin.name} ${version.version} git source needs a full 40-hex commit`)
      if (!/^https:\/\//.test(version.source.url ?? '')) fail(`${plugin.name} ${version.version} git source needs an https URL`)
    } else if (version.source?.type !== 'npm') {
      fail(`${plugin.name} ${version.version} has an invalid source type`)
    }
  }

  if (plugin.icon !== undefined) {
    if (typeof plugin.icon !== 'string' || plugin.icon === '') fail(`${plugin.name} icon must be a non-empty string`)
    if (!plugin.icon.startsWith('data:')) {
      if (!/^https?:\/\//.test(plugin.icon)) {
        const resolved = normalize(join(INDEX_DIR, plugin.icon))
        if (resolved.startsWith(`..${sep}`) || resolved === '..') fail(`${plugin.name} icon escapes the index directory: ${plugin.icon}`)
        if (!existsSync(resolved)) fail(`${plugin.name} icon file is missing: ${plugin.icon}`)
      }
    }
  }
}

console.log(`Plugin index is structurally valid (${index.plugins.length} plugin(s)).`)
