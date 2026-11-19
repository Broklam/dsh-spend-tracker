/**
 * Rendering checks for the browser half's agent-team reading. The client file
 * is a browser module, so the test stands in for the module loader and for
 * React's hook runtime, calls the registered component directly, and reads the
 * element tree it returns.
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
  addEventListener() {},
  removeEventListener() {},
}
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  activeElement: null,
  body: { appendChild() {} },
  head: { appendChild() {} },
  createElement: () => ({ style: {}, setAttribute() {}, textContent: '', remove() {} }),
}
await import('../client.js')
assert.ok(registration.spec !== null, 'client.js must register a module factory')

/**
 * Minimal React replacement with a real hook runtime: state cells, refs, memo
 * cells, and effects that run once per render and are collected for cleanup.
 * The first boolean state (the panel's open flag) starts open so the panel body
 * is rendered; every other state keeps its initial value.
 */
function createReact() {
  const cells = []
  let cursor = 0
  let cleanups = []
  let openAvailable = true
  const sameDeps = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  const runEffect = effect => {
    if (typeof effect !== 'function') return
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  return {
    reset() {
      cells.length = 0
      cursor = 0
      cleanups = []
      openAvailable = true
    },
    dispose() {
      for (const cleanup of cleanups) cleanup()
      cleanups = []
    },
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    createPortal(node) { return node },
    useState(initial) {
      const index = cursor++
      if (!(index in cells)) cells[index] = openAvailable ? true : (typeof initial === 'function' ? initial() : initial)
      if (openAvailable) openAvailable = false
      const set = next => { cells[index] = typeof next === 'function' ? next(cells[index]) : next }
      return [cells[index], set]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in cells)) cells[index] = { current: initial ?? null }
      return cells[index]
    },
    useMemo(factory, deps) {
      const index = cursor++
      const cell = cells[index]
      if (cell === undefined || cell.deps === undefined || !sameDeps(cell.deps, deps)) {
        cells[index] = { deps, value: factory() }
      }
      return cells[index].value
    },
    useEffect(effect) { cursor += 1; runEffect(effect) },
    useLayoutEffect(effect) { cursor += 1; runEffect(effect) },
    useId() { return ':r0:' },
  }
}

const react = createReact()
const plugin = registration.spec.factory(name => (name === 'react' ? react : name === 'react-dom' ? { createPortal: node => node } : {}))
assert.ok(plugin !== undefined, 'client.js must expose the plugin face')
const copy = plugin.__test.dictionaries.EN

/** Interpolate one English copy string. */
function translate(key, values) {
  const text = copy[key]
  assert.ok(typeof text === 'string', `missing dictionary key ${key}`)
  return text.replace(/\{([a-zA-Z]+)\}/g, (_, name) => String(values?.[name] ?? ''))
}

/** Collect every text node, including those rendered by function components. */
function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'function') return textOf(node({}))
  if (typeof node === 'object' && 'type' in node) {
    const type = node.type
    const children = node.children.length === 1 ? node.children[0] : node.children
    if (typeof type === 'function') return textOf(type({ ...node.props, children }))
    return textOf(children)
  }
  return ''
}

/** First attribute value in document order; the pill carries its label before the dialog. */
function attributeOf(node, name) {
  if (node === null || node === undefined || typeof node !== 'object') return ''
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = attributeOf(child, name)
      if (found !== '') return found
    }
    return ''
  }
  const own = node.props?.[name]
  if (typeof own === 'string' && own !== '') return own
  for (const child of node.children ?? []) {
    const found = attributeOf(child, name)
    if (found !== '') return found
  }
  return ''
}

const ZERO_TOKENS = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 }

/** One complete `sessionSpend` wire value. */
function spendView({ cost = 0, tokens = {} } = {}) {
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
    calls: 1,
    turns: 1,
    steps: 1,
    toolCalls: 2,
    toolErrors: 0,
    retries: 0,
    compactions: 0,
    pricedCalls: 1,
    unpricedCalls: 0,
    unpricedTokens: 0,
    schedule: { enabled: false, discount: 0.5, offPeakPercent: null, windows: [], holidays: [] },
    rates: { source: 'shipped', updatedAt: null, url: 'https://example.test/pricing' },
    modelsTotal: 0,
    models: [],
  }
}

/** Session list state as the standard `useSessions` hook reads it. */
function listState(projections, byId = {}) {
  return { ids: Object.keys(byId), byId, phase: 'ready', projectionsBySession: projections }
}

/** Render the registered component once and read its tree. */
function renderPill({ spend, projections = {}, byId = {}, sessionId = 'root', loadSubagents = () => {} }) {
  react.reset()
  const captured = { component: null, registration: null }
  const ctx = {
    effect(callback) { callback() },
    get(name) { return name === 'sessions' ? { refreshProjections() {} } : undefined },
    locale: { register: () => () => {} },
    slots: {
      inject(owner, callback) { captured.registration = callback() },
      register(options, component) {
        captured.registration = { options, component }
        captured.component = component
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  const component = captured.component
  assert.ok(typeof component === 'function', 'the dock entry must register a component')
  // The panel's rate-status clock is a real interval; the test drives none of it.
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  globalThis.setInterval = () => ({ unref() {} })
  globalThis.clearInterval = () => {}
  try {
    const element = component({
      useProjection: key => (key === 'sessionSpend' ? spend : undefined),
      useSessions: selector => selector(listState(projections, byId)),
      t: translate,
      sessionId,
      loadSubagents,
    })
    const text = textOf(element)
    react.dispose()
    return { element, text, label: attributeOf(element, 'aria-label') }
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
  }
}

test('a chat without subagents renders the single Total row it always had', () => {
  const { text, label } = renderPill({ spend: spendView({ cost: 0.5, tokens: { input: 900, total: 1000 } }) })
  assert.equal(label, translate('pill.spendTitle', { cost: '$0.50' }))
  assert.match(text, /Total/)
  assert.doesNotMatch(text, /This session/)
  assert.doesNotMatch(text, /By subagent/)
})

test('the reading and the panel count every subagent conversation', () => {
  const projections = {
    root: { values: { subagentCatalog: [
      { id: 'child-a', createdAt: 1, mode: 'continuable', label: 'Review the diff', name: 'reviewer' },
      { id: 'child-b', createdAt: 2, mode: 'one-shot', label: 'Check the tests' },
    ] }, state: 'ready', error: null },
    'child-a': { values: { sessionSpend: spendView({ cost: 0.3, tokens: { input: 700, total: 800 } }), subagentCatalog: [] }, state: 'ready', error: null },
    'child-b': { values: { sessionSpend: spendView({ cost: 0.2, tokens: { input: 400, total: 500 } }), subagentCatalog: [] }, state: 'ready', error: null },
  }
  const { text, label } = renderPill({ spend: spendView({ cost: 0.5, tokens: { input: 900, total: 1000 } }), projections })
  assert.equal(label, translate('pill.spendTeamTitle', { cost: '$1.00', count: 2 }))
  assert.match(text, /This session/)
  assert.match(text, /Subagents \(2\)/)
  assert.match(text, /Total/)
  assert.match(text, /By subagent/)
  assert.match(text, /Review the diff/)
  assert.match(text, /Check the tests/)
  assert.match(text, /The estimate includes 2 subagent conversations/)
})

test('a member whose projections are not loaded is requested once', () => {
  const requested = []
  const projections = {
    root: { values: { subagentCatalog: [
      { id: 'child-a', createdAt: 1, mode: 'continuable', label: 'Review the diff' },
      { id: 'child-b', createdAt: 2, mode: 'one-shot', label: 'Check the tests' },
    ] }, state: 'ready', error: null },
    'child-a': { values: { sessionSpend: spendView({ cost: 0.3, tokens: { total: 800 } }) }, state: 'ready', error: null },
  }
  const { text } = renderPill({
    spend: spendView({ cost: 0.5, tokens: { total: 1000 } }),
    projections,
    loadSubagents: ids => requested.push(...ids),
  })
  assert.deepEqual(requested, ['child-b'])
  // The loaded member still counts while the other read is in flight.
  assert.match(text, /Subagents \(1\)/)
  assert.match(text, /Review the diff/)
})

test('an external task adds no row and no team section', () => {
  const projections = {
    root: { values: { subagentCatalog: [
      { id: 'remote', createdAt: 1, mode: 'external', label: 'Remote SDK' },
    ] }, state: 'ready', error: null },
  }
  const { text } = renderPill({ spend: spendView({ cost: 0.5, tokens: { total: 1000 } }), projections })
  assert.doesNotMatch(text, /By subagent/)
  assert.doesNotMatch(text, /Remote SDK/)
})
