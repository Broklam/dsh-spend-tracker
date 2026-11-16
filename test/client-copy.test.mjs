/**
 * Static checks for the browser half's copy tables: every dictionary key is
 * translated, placeholders agree, and every `t('key')` the component uses is
 * defined. The client bundle is a browser module, so the check reads its
 * source rather than importing it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** Keys and placeholder values of one `const NAME = { ... }` dictionary. */
function readDictionary(name) {
  const start = SOURCE.indexOf(`const ${name} = {`)
  assert.notEqual(start, -1, `${name} dictionary must exist`)
  const end = SOURCE.indexOf('\n    }', start)
  assert.notEqual(end, -1, `${name} dictionary must be closed`)
  const body = SOURCE.slice(start, end)
  const entries = new Map()
  for (const match of body.matchAll(/'([^']+)':\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)) {
    entries.set(match[1], match[2])
  }
  return entries
}

const EN = readDictionary('EN')
const ZH = readDictionary('ZH')

test('English and Simplified Chinese dictionaries have the same keys', () => {
  assert.ok(EN.size > 0)
  assert.deepEqual([...ZH.keys()].sort(), [...EN.keys()].sort())
})

test('every placeholder in an English string exists in its translation', () => {
  for (const [key, english] of EN) {
    const placeholders = [...english.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]).sort()
    const chinese = ZH.get(key) ?? ''
    const translated = [...chinese.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]).sort()
    assert.deepEqual(translated, placeholders, `${key} placeholders must match`)
  }
})

test('every key the components translate is defined in both dictionaries', () => {
  const used = new Set([...SOURCE.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]))
  assert.ok(used.size > 0)
  for (const key of used) {
    assert.ok(EN.has(key), `EN is missing ${key}`)
    assert.ok(ZH.has(key), `ZH is missing ${key}`)
  }
})

test('the panel title names the figure as an estimate', () => {
  assert.match(EN.get('dialog.title'), /estimated/i)
  assert.match(ZH.get('dialog.title'), /估算/)
})
