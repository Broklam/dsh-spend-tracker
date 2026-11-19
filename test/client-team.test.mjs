/**
 * Executable checks for the browser half's agent-team reading. The client file
 * is a browser module, so the test stands in for the module loader and reads
 * the helpers the plugin exposes for tests.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

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

/** Minimal React stand-in; the helpers under test never render. */
const react = {
  createElement: () => null,
  useState: value => [value, () => {}],
  useRef: value => ({ current: value ?? null }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: factory => factory(),
  useId: () => ':r0:',
}
const plugin = registration.spec.factory(name => (name === 'react' ? react : {}))
const team = plugin.__test

const ZERO_TOKENS = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 }

/** One complete `sessionSpend` wire value with chosen figures. */
function spendView({
  cost = 0,
  tokens = {},
  calls = 0,
  models = [],
  modelsTotal = models.length,
  pricedCalls = calls,
} = {}) {
  return {
    currencySymbol: '$',
    decimals: 4,
    cost,
    costPeak: cost,
    costOffPeak: 0,
    saved: 0,
    costInput: cost / 2,
    costCacheRead: 0,
    costCacheWrite: 0,
    costOutput: cost / 2,
    tokens: { ...ZERO_TOKENS, ...tokens },
    calls,
    turns: 1,
    steps: 1,
    toolCalls: 2,
    toolErrors: 0,
    retries: 0,
    compactions: 0,
    pricedCalls,
    unpricedCalls: calls - pricedCalls,
    unpricedTokens: 0,
    schedule: { enabled: false, discount: 0.5, offPeakPercent: null, windows: [], holidays: [] },
    rates: { source: 'shipped', updatedAt: null, url: 'https://example.test/pricing' },
    modelsTotal,
    models,
  }
}

/** One model row as the Host wire view carries it. */
function modelRow(route, { cost = 0, tokens = 0, calls = 1, priced = true } = {}) {
  return {
    route,
    priced,
    cost,
    calls,
    tokens: { ...ZERO_TOKENS, input: tokens, total: tokens },
  }
}

/** A projection cut map: session id → `{ values, state }`. */
function projections(entries) {
  const map = {}
  for (const [id, rows] of Object.entries(entries)) {
    map[id] = { values: { subagentCatalog: rows }, state: 'ready', error: null }
  }
  return map
}

test('the team follows every local catalog row and skips external tasks', () => {
  const cut = projections({
    root: [
      { id: 'direct', createdAt: 1, mode: 'continuable', label: 'Review the diff', name: 'reviewer' },
      { id: 'external', createdAt: 2, mode: 'external', label: 'Remote SDK' },
      { id: 'one-shot', createdAt: 3, mode: 'one-shot' },
    ],
    direct: [{ id: 'nested', createdAt: 4, mode: 'one-shot', label: 'Check the tests' }],
    nested: [],
  })
  assert.deepEqual(team.subagentTree(cut, 'root'), [
    { id: 'direct', parentId: 'root', label: 'Review the diff', name: 'reviewer' },
    { id: 'one-shot', parentId: 'root', label: null, name: null },
    { id: 'nested', parentId: 'direct', label: 'Check the tests', name: null },
  ])
})

test('the team is empty before the conversation catalog is read', () => {
  assert.deepEqual(team.subagentTree({}, 'root'), [])
  assert.deepEqual(team.subagentTree(undefined, 'root'), [])
})

test('a session listed twice is visited once', () => {
  const cut = projections({
    root: [
      { id: 'a', createdAt: 1, mode: 'continuable', label: 'a' },
      { id: 'a', createdAt: 1, mode: 'continuable', label: 'a again' },
    ],
    a: [{ id: 'root', createdAt: 2, mode: 'continuable', label: 'cycle' }],
  })
  assert.deepEqual(team.subagentTree(cut, 'root'), [
    { id: 'a', parentId: 'root', label: 'a', name: null },
  ])
})

test('a lone session keeps its own view untouched', () => {
  const own = spendView({ cost: 0.25, tokens: { input: 100, total: 100 }, calls: 1 })
  const combined = team.combineSpend(own, [])
  assert.equal(combined.view, own)
  assert.equal(combined.cost, 0)
  assert.equal(combined.tokens, 0)
})

test('the combined view sums spend, tokens, calls, and models across the team', () => {
  const own = spendView({
    cost: 0.1,
    tokens: { input: 80, output: 20, total: 100 },
    calls: 2,
    models: [modelRow('demo/flash', { cost: 0.1, tokens: 100, calls: 2 })],
  })
  const member = spendView({
    cost: 0.2,
    tokens: { input: 40, output: 10, total: 50 },
    calls: 1,
    models: [modelRow('demo/flash', { cost: 0.15, tokens: 30, calls: 1 }), modelRow('demo/pro', { cost: 0.05, tokens: 20, calls: 1 })],
  })
  const other = spendView({ cost: 0.3, tokens: { input: 10, total: 10 }, calls: 1, models: [modelRow('demo/pro', { cost: 0.3, tokens: 10 })] })
  const combined = team.combineSpend(own, [
    { id: 'member', parentId: 'root', label: null, name: null, view: member },
    { id: 'other', parentId: 'root', label: null, name: null, view: other },
  ])
  assert.equal(combined.cost, 0.5)
  assert.equal(combined.tokens, 60)
  assert.equal(combined.calls, 2)
  assert.equal(combined.view.cost, 0.6)
  assert.equal(combined.view.calls, 4)
  assert.equal(combined.view.pricedCalls, 4)
  assert.deepEqual(combined.view.tokens, { input: 130, cacheRead: 0, cacheWrite: 0, output: 30, reasoning: 0, total: 160 })
  // Two routes, not four: the same route billed in several conversations is one model.
  assert.equal(combined.view.modelsTotal, 2)
  assert.deepEqual(combined.view.models.map(row => row.route), ['demo/pro', 'demo/flash'])
  assert.equal(combined.view.models[0].cost, 0.35)
  assert.equal(combined.view.models[0].tokens.total, 30)
  assert.equal(combined.view.models[1].cost, 0.25)
  assert.equal(combined.view.models[1].calls, 3)
  assert.equal(combined.view.models[1].tokens.total, 130)
})

test('the combined view keeps the session own activity counters and pricing context', () => {
  const own = spendView({ cost: 0.1, tokens: { total: 10 }, calls: 1 })
  const combined = team.combineSpend(own, [
    { id: 'member', parentId: 'root', label: null, name: null, view: spendView({ cost: 0.2, tokens: { total: 20 }, calls: 1 }) },
  ])
  assert.equal(combined.view.turns, 1)
  assert.equal(combined.view.steps, 1)
  assert.equal(combined.view.toolCalls, 2)
  assert.equal(combined.view.currencySymbol, '$')
  assert.equal(combined.view.decimals, 4)
  assert.equal(combined.view.schedule, own.schedule)
})

test('member views are read, never mutated by the merge', () => {
  const member = spendView({
    cost: 0.2,
    tokens: { total: 20 },
    calls: 1,
    models: [modelRow('demo/flash', { cost: 0.2, tokens: 20 })],
  })
  const before = structuredClone(member)
  team.combineSpend(spendView({ cost: 0.1, tokens: { total: 10 }, calls: 1, models: [modelRow('demo/flash', { cost: 0.1, tokens: 10 })] }), [
    { id: 'member', parentId: 'root', label: null, name: null, view: member },
  ])
  assert.deepEqual(member, before)
})

test('the merged model table keeps its total and caps the rows', () => {
  const rows = []
  for (let index = 0; index < team.MAX_AGENT_ROWS + 4; index += 1) {
    rows.push(modelRow(`demo/model-${index}`, { cost: index + 1, tokens: index + 1 }))
  }
  const combined = team.combineSpend(spendView({ cost: 1, tokens: { total: 1 }, calls: 1 }), [
    { id: 'member', parentId: 'root', label: null, name: null, view: spendView({ cost: 1, tokens: { total: 1 }, calls: 1, models: rows, modelsTotal: rows.length }) },
  ])
  assert.equal(combined.view.models.length, team.MAX_AGENT_ROWS)
  assert.equal(combined.view.modelsTotal, rows.length)
  assert.equal(combined.view.models[0].route, `demo/model-${rows.length - 1}`)
})

test('the model total counts each route once across the team', () => {
  const own = spendView({ cost: 0.1, tokens: { total: 10 }, calls: 1, models: [modelRow('demo/flash', { cost: 0.1, tokens: 10 })] })
  const combined = team.combineSpend(own, [
    { id: 'a', parentId: 'root', label: null, name: null, view: spendView({ cost: 0.2, tokens: { total: 20 }, calls: 1, models: [modelRow('demo/flash', { cost: 0.2, tokens: 20 })] }) },
    { id: 'b', parentId: 'root', label: null, name: null, view: spendView({ cost: 0.3, tokens: { total: 30 }, calls: 1, models: [modelRow('demo/pro', { cost: 0.3, tokens: 30 })] }) },
  ])
  assert.equal(combined.view.modelsTotal, 2)
  assert.deepEqual(combined.view.models.map(row => row.route), ['demo/flash', 'demo/pro'])
})

test('the model total keeps routes a capped view hides out of its row list', () => {
  const own = spendView({ cost: 0.1, tokens: { total: 10 }, calls: 1, models: [modelRow('demo/shared', { cost: 0.1, tokens: 10 })] })
  const rows = []
  for (let index = 0; index < team.MAX_AGENT_ROWS; index += 1) {
    rows.push(modelRow(`demo/model-${index}`, { cost: index + 1, tokens: index + 1 }))
  }
  const combined = team.combineSpend(own, [
    { id: 'member', parentId: 'root', label: null, name: null, view: spendView({ cost: 1, tokens: { total: 1 }, calls: 1, models: rows, modelsTotal: rows.length + 2 }) },
  ])
  // One own route plus the member's listed routes plus its two hidden routes.
  assert.equal(combined.view.modelsTotal, rows.length + 3)
  assert.equal(combined.view.models.length, team.MAX_AGENT_ROWS)
})

test('the member label prefers the catalog label, then the agent name, then the title', () => {
  const list = { byId: { child: { displayTitle: 'Session title' } } }
  assert.equal(team.memberLabelOf({ id: 'child', label: 'Creation label', name: 'reviewer' }, list), 'Creation label')
  assert.equal(team.memberLabelOf({ id: 'child', label: null, name: 'reviewer' }, list), 'reviewer')
  assert.equal(team.memberLabelOf({ id: 'child', label: null, name: null }, list), 'Session title')
  assert.equal(team.memberLabelOf({ id: 'child', label: null, name: null }, undefined), 'child')
})
