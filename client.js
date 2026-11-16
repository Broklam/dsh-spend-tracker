window.__ModuleLoader__.load({
  id: 'dsh-spend-tracker',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Locale namespace this bundle owns. */
    const NS = 'dsh-spend-tracker'

    /** Marks a money figure as an estimate; a math symbol, so it needs no translation. */
    const ESTIMATE_PREFIX = '≈'

    /** English dictionary; keys are flat and placeholders use `{name}`. */
    const EN = {
      'pill.spendTitle': 'Session spend (estimated): {cost}',
      'pill.tokensTitle': '{tokens} tokens this session; no price is configured for its model',
      'pill.tokens': '{tokens} tok',
      'dialog.title': 'Session spend',
      'section.spend': 'Estimated spend',
      'section.tokens': 'Tokens',
      'section.activity': 'Activity',
      'section.models': 'By model',
      'row.total': 'Total',
      'row.input': 'Input',
      'row.cacheRead': 'Cache read',
      'row.cacheWrite': 'Cache write',
      'row.output': 'Output',
      'row.reasoning': 'Reasoning',
      'row.cacheHit': 'Cache hit',
      'row.turns': 'Turns',
      'row.steps': 'Steps',
      'row.toolCalls': 'Tool calls',
      'row.toolErrors': 'Tool errors',
      'row.retries': 'Retries',
      'row.compactions': 'Compactions',
      'value.moneyTokens': '{cost} · {tokens}',
      'value.tokensOnly': '{tokens}',
      'note.unpriced': '{calls} calls used a model with no configured price ({tokens} tokens unpriced).',
      'note.models': 'Top {shown} of {total} models shown.',
      'note.estimate': 'Estimated from the configured price table, not a billed amount.',
      'note.peak': 'Shipped rates are DeepSeek peak rates; off-peak usage bills about half.',
    }

    /** Simplified Chinese dictionary of the same keys. */
    const ZH = {
      'pill.spendTitle': '本次会话花费（估算）：{cost}',
      'pill.tokensTitle': '本次会话 {tokens} tokens；该模型未配置价格',
      'pill.tokens': '{tokens} tokens',
      'dialog.title': '会话花费',
      'section.spend': '估算花费',
      'section.tokens': 'Tokens',
      'section.activity': '活动',
      'section.models': '按模型',
      'row.total': '合计',
      'row.input': '输入',
      'row.cacheRead': '缓存读取',
      'row.cacheWrite': '缓存写入',
      'row.output': '输出',
      'row.reasoning': '推理',
      'row.cacheHit': '缓存命中',
      'row.turns': '轮次',
      'row.steps': '步骤',
      'row.toolCalls': '工具调用',
      'row.toolErrors': '工具错误',
      'row.retries': '重试',
      'row.compactions': '上下文压缩',
      'value.moneyTokens': '{cost} · {tokens}',
      'value.tokensOnly': '{tokens}',
      'note.unpriced': '有 {calls} 次调用使用了未配置价格的模型（{tokens} tokens 未计价）。',
      'note.models': '仅显示 {total} 个模型中的前 {shown} 个。',
      'note.estimate': '按已配置的价格表估算，并非实际账单金额。',
      'note.peak': '内置价格为 DeepSeek 高峰时段价格；非高峰时段约按半价计费。',
    }

    /** Pill and dialog skin; theme tokens only, host tokens with graceful fallbacks. */
    const CSS = `
      .dsh-spend-anchor {
        display: inline-flex;
        min-width: 0;
        font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
        line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
      }
      .dsh-spend-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        box-sizing: border-box;
        max-width: 100%;
        padding: 1px 8px;
        border: none;
        border-radius: var(--dsw-radius-sm, 4px);
        background: transparent;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, CanvasText));
        font: inherit;
        font-variant-numeric: tabular-nums;
        line-height: inherit;
        white-space: nowrap;
        cursor: pointer;
      }
      .dsh-spend-pill svg {
        width: 14px;
        height: 14px;
        flex: none;
      }
      .dsh-spend-pill[aria-expanded='true'] {
        background: var(--dsw-alias-interactive-bg-hover, transparent);
        color: var(--dsw-alias-label-secondary, CanvasText);
      }
      @media (hover: hover) {
        .dsh-spend-pill:hover {
          background: var(--dsw-alias-interactive-bg-hover, transparent);
          color: var(--dsw-alias-label-secondary, CanvasText);
        }
      }
      .dsh-spend-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dsh-spend-panel {
        position: fixed;
        z-index: 1100;
        box-sizing: border-box;
        width: max-content;
        min-width: min(300px, calc(100vw - 24px));
        max-width: min(440px, calc(100vw - 24px));
        padding: 16px;
        border: 0;
        border-radius: var(--dsw-radius-lg, 10px);
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, Canvas));
        backdrop-filter: var(--dsw-menu-backdrop-filter);
        --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
        box-shadow: var(--dsw-elevation-prominent, none);
        color: var(--dsw-alias-label-secondary, CanvasText);
        font-size: 12px;
        line-height: 18px;
        cursor: default;
        max-height: calc(100dvh - 12px - max(12px, var(--dsh-frame-overlay-top, 12px)));
        overflow-x: hidden;
        overflow-y: auto;
        --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
        --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
        position-area: none;
        top: max(12px, var(--dsh-frame-overlay-top, 12px));
        bottom: max(12px, calc(anchor(top) + 8px));
        left: max(12px, anchor(left));
        right: 12px;
        height: fit-content;
        min-height: 0;
        margin: 0;
        align-self: end;
        justify-self: start;
        position-try-fallbacks: --dsh-spend-window, --dsh-spend-opposite, --dsh-spend-wide-opposite, --dsh-spend-tall, --dsh-spend-viewport;
      }
      @position-try --dsh-spend-window {
        position-area: none;
        top: max(12px, var(--dsh-frame-overlay-top, 12px));
        bottom: max(12px, calc(anchor(top) + 8px));
        left: 12px;
        right: 12px;
        margin: 0;
        align-self: safe end;
        justify-self: safe end;
      }
      @position-try --dsh-spend-opposite {
        top: max(12px, calc(anchor(bottom) + 8px));
        bottom: 12px;
        align-self: start;
      }
      @position-try --dsh-spend-wide-opposite {
        top: max(12px, calc(anchor(bottom) + 8px));
        bottom: 12px;
        left: 12px;
        right: 12px;
        align-self: start;
        justify-self: safe end;
      }
      @position-try --dsh-spend-tall {
        position-area: none;
        top: max(12px, var(--dsh-frame-overlay-top, 12px));
        bottom: 12px;
        left: max(12px, anchor(left));
        right: 12px;
        margin: 0;
        align-self: safe start;
        justify-self: start;
      }
      @position-try --dsh-spend-viewport {
        position-area: none;
        inset: max(12px, var(--dsh-frame-overlay-top, 12px)) 12px 12px;
        margin: 0;
        align-self: safe start;
        justify-self: safe end;
      }
      .dsh-spend-title {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 8px;
        color: var(--dsw-alias-label-primary, CanvasText);
        font-weight: 500;
      }
      .dsh-spend-title-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .dsh-spend-title-label svg {
        width: 14px;
        height: 14px;
        flex: none;
      }
      .dsh-spend-title-value {
        font-variant-numeric: tabular-nums;
      }
      .dsh-spend-rule {
        margin-bottom: 10px;
        border-top: 0.5px solid var(--dsw-alias-border-l2);
      }
      .dsh-spend-section + .dsh-spend-section {
        margin-top: 12px;
      }
      .dsh-spend-section-title {
        margin-bottom: 6px;
        color: var(--dsw-alias-label-primary, CanvasText);
        font-weight: 500;
      }
      .dsh-spend-details {
        display: grid;
        grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
        gap: 6px 16px;
        margin: 0;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, CanvasText));
      }
      .dsh-spend-details dt,
      .dsh-spend-details dd {
        min-width: 0;
        margin: 0;
      }
      .dsh-spend-details dd {
        color: var(--dsw-alias-label-secondary, CanvasText);
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .dsh-spend-route {
        overflow-wrap: anywhere;
      }
      .dsh-spend-note {
        margin-top: 10px;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, CanvasText));
      }
    `

    // ---------------------------------------------------------------- formatting

    /** Compact token count: 517 / 12.3K / 1.2M, promoting across a unit boundary. */
    function formatCompactTokens(value) {
      if (!(value > 0)) return '0'
      if (value < 1000) return String(Math.round(value))
      const scaled = candidate => {
        const rounded = Math.round(candidate * 10) / 10
        return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
      }
      if (value < 1000000 && Math.round((value / 1000) * 10) / 10 < 1000) return `${scaled(value / 1000)}K`
      return `${scaled(value / 1000000)}M`
    }

    /** Exact token count with the reader's digit grouping. */
    function formatExactTokens(value) {
      return Math.round(value).toLocaleString()
    }

    /** Money text keeps at least two fraction digits (as configured) and drops noise beyond them. */
    function trimCost(text, decimals) {
      if (!text.includes('.')) return text
      const trimmed = text.replace(/0+$/, '').replace(/\.$/, '')
      const [whole, fraction = ''] = trimmed.split('.')
      return `${whole}.${fraction.padEnd(Math.min(2, decimals), '0')}`
    }

    /**
     * Currency amount sized to its magnitude, never showing a misleading zero.
     * @param value - non-negative amount.
     * @param symbol - currency symbol from the Host configuration.
     * @param decimals - configured maximum fraction digits.
     * @returns display text, prefixed with `<` when the amount is below the
     * smallest representable display unit.
     */
    function formatCost(value, symbol, decimals) {
      if (!(value > 0)) return `${symbol}0`
      const precise = value >= 1
        ? 2
        : value >= 0.1
          ? 3
          : value >= 0.001
            ? 4
            : 6
      const precision = Math.max(0, Math.min(decimals, precise))
      const text = value.toFixed(precision)
      if (Number(text) === 0) {
        const unit = precision === 0 ? '1' : (10 ** -precision).toFixed(precision)
        return `<${symbol}${unit}`
      }
      return `${symbol}${trimCost(text, decimals)}`
    }

    /** Cache-read share of prompt-side tokens, never rounding a partial hit to 100%. */
    function formatCacheHit(read, billed) {
      if (!(billed > 0)) return null
      if (read >= billed) return '100%'
      const rounded = Math.round((read / billed) * 1000) / 10
      return `${rounded >= 100 ? '99.9' : String(rounded)}%`
    }

    // ---------------------------------------------------------------- components

    /** Money-like glyph: a note with its centre mark. */
    function SpendGlyph() {
      return h('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        'aria-hidden': true,
      },
        h('rect', { x: 2.8, y: 6.4, width: 18.4, height: 11.2, rx: 2.4 }),
        h('circle', { cx: 12, cy: 12, r: 2.6 }),
        h('path', { d: 'M6.3 9.6v4.8M17.7 9.6v4.8' }),
      )
    }

    /** One labelled section of dialog rows. */
    function Section({ title, children }) {
      return h('div', { className: 'dsh-spend-section' },
        h('div', { className: 'dsh-spend-section-title' }, title),
        h('dl', { className: 'dsh-spend-details' }, children),
      )
    }

    /** Flatten `[label, value]` pairs into keyed `dt`/`dd` children. */
    function rows(pairs) {
      const children = []
      for (const pair of pairs) {
        if (pair === null) continue
        children.push(h('dt', { key: `label-${children.length}` }, pair[0]))
        children.push(h('dd', { key: `value-${children.length}` }, pair[1]))
      }
      return children
    }

    /** The composer-dock spend pill and its click-open breakdown. */
    function SpendPill(props) {
      const useProjection = props.useProjection
      const t = props.t
      const spend = typeof useProjection === 'function' ? useProjection('sessionSpend') : undefined
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const anchorName = `--dsh-spend-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

      React.useEffect(() => {
        if (!open) return undefined
        const outside = target => rootRef.current?.contains(target) !== true && panelRef.current?.contains(target) !== true
        const closeOnPointer = event => {
          if (outside(event.target)) setOpen(false)
        }
        // Keyboard activation of a sibling trigger fires click without pointerdown,
        // so the capture-phase click closes this dialog before the sibling opens.
        const closeOnClick = event => {
          if (outside(event.target)) setOpen(false)
        }
        const closeOnKey = event => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          setOpen(false)
        }
        document.addEventListener('pointerdown', closeOnPointer, true)
        document.addEventListener('click', closeOnClick, true)
        document.addEventListener('keydown', closeOnKey)
        return () => {
          document.removeEventListener('pointerdown', closeOnPointer, true)
          document.removeEventListener('click', closeOnClick, true)
          document.removeEventListener('keydown', closeOnKey)
        }
      }, [open])

      // A Session without billed usage shows no pill at all: there is nothing to price.
      if (spend === undefined || spend === null || spend.tokens.total === 0) return null

      const priced = spend.pricedCalls > 0
      const cost = formatCost(spend.cost, spend.currencySymbol, spend.decimals)
      const totalTokens = formatExactTokens(spend.tokens.total)
      const moneyTokens = (money, tokens) => t('value.moneyTokens', { cost: money, tokens })
      const tokensOnly = tokens => t('value.tokensOnly', { tokens })
      const cacheHit = formatCacheHit(spend.tokens.cacheRead, spend.tokens.input + spend.tokens.cacheRead + spend.tokens.cacheWrite)

      const spendRows = priced
        ? rows([
          [t('row.total'), moneyTokens(cost, totalTokens)],
          spend.tokens.input > 0
            ? [t('row.input'), moneyTokens(formatCost(spend.costInput, spend.currencySymbol, spend.decimals), formatExactTokens(spend.tokens.input))]
            : null,
          spend.tokens.cacheRead > 0
            ? [t('row.cacheRead'), moneyTokens(formatCost(spend.costCacheRead, spend.currencySymbol, spend.decimals), formatExactTokens(spend.tokens.cacheRead))]
            : null,
          spend.tokens.cacheWrite > 0
            ? [t('row.cacheWrite'), moneyTokens(formatCost(spend.costCacheWrite, spend.currencySymbol, spend.decimals), formatExactTokens(spend.tokens.cacheWrite))]
            : null,
          spend.tokens.output > 0
            ? [t('row.output'), moneyTokens(formatCost(spend.costOutput, spend.currencySymbol, spend.decimals), formatExactTokens(spend.tokens.output))]
            : null,
          spend.tokens.reasoning > 0 ? [t('row.reasoning'), tokensOnly(formatExactTokens(spend.tokens.reasoning))] : null,
          cacheHit !== null ? [t('row.cacheHit'), cacheHit] : null,
        ])
        : rows([
          [t('row.total'), tokensOnly(totalTokens)],
          spend.tokens.input > 0 ? [t('row.input'), tokensOnly(formatExactTokens(spend.tokens.input))] : null,
          spend.tokens.cacheRead > 0 ? [t('row.cacheRead'), tokensOnly(formatExactTokens(spend.tokens.cacheRead))] : null,
          spend.tokens.cacheWrite > 0 ? [t('row.cacheWrite'), tokensOnly(formatExactTokens(spend.tokens.cacheWrite))] : null,
          spend.tokens.output > 0 ? [t('row.output'), tokensOnly(formatExactTokens(spend.tokens.output))] : null,
          spend.tokens.reasoning > 0 ? [t('row.reasoning'), tokensOnly(formatExactTokens(spend.tokens.reasoning))] : null,
          cacheHit !== null ? [t('row.cacheHit'), cacheHit] : null,
        ])

      const activityPairs = [
        [t('row.turns'), formatExactTokens(spend.turns)],
        [t('row.steps'), formatExactTokens(spend.steps)],
        [t('row.toolCalls'), formatExactTokens(spend.toolCalls)],
      ]
      if (spend.toolErrors > 0) activityPairs.push([t('row.toolErrors'), formatExactTokens(spend.toolErrors)])
      if (spend.retries > 0) activityPairs.push([t('row.retries'), formatExactTokens(spend.retries)])
      if (spend.compactions > 0) activityPairs.push([t('row.compactions'), formatExactTokens(spend.compactions)])

      const modelRows = spend.models.length > 1
        ? rows(spend.models.map(model => [
          h('span', { className: 'dsh-spend-route' }, model.route),
          model.priced
            ? moneyTokens(formatCost(model.cost, spend.currencySymbol, spend.decimals), formatExactTokens(model.tokens.total))
            : tokensOnly(formatExactTokens(model.tokens.total)),
        ]))
        : null

      const notes = []
      if (spend.unpricedCalls > 0) {
        notes.push(h('div', { className: 'dsh-spend-note', key: 'unpriced' }, t('note.unpriced', {
          calls: spend.unpricedCalls,
          tokens: formatExactTokens(spend.unpricedTokens),
        })))
      }
      if (spend.modelsTotal > spend.models.length) {
        notes.push(h('div', { className: 'dsh-spend-note', key: 'models' }, t('note.models', {
          shown: spend.models.length,
          total: spend.modelsTotal,
        })))
      }
      if (priced) notes.push(h('div', { className: 'dsh-spend-note', key: 'estimate' }, t('note.estimate')))
      if (priced && spend.peakRates) notes.push(h('div', { className: 'dsh-spend-note', key: 'peak' }, t('note.peak')))

      // The tilde marks an estimate on the resting reading; the dialog explains
      // the same figure in its note, so its rows and title stay plain.
      const estimateCost = cost.startsWith('<') ? cost : `${ESTIMATE_PREFIX}${cost}`
      const headline = priced ? estimateCost : t('pill.tokens', { tokens: formatCompactTokens(spend.tokens.total) })
      const dialogValue = priced ? cost : t('pill.tokens', { tokens: formatCompactTokens(spend.tokens.total) })
      const accessible = priced
        ? t('pill.spendTitle', { cost })
        : t('pill.tokensTitle', { tokens: formatExactTokens(spend.tokens.total) })

      return h('span', { ref: rootRef, className: 'dsh-spend-anchor', style: { anchorName } },
        h('button', {
          type: 'button',
          className: 'dsh-spend-pill',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': accessible,
          title: accessible,
          onClick: () => { setOpen(!open) },
        },
          h(SpendGlyph),
          h('span', { className: 'dsh-spend-label' }, headline),
        ),
        open ? ReactDOM.createPortal(
          h('div', {
            ref: panelRef,
            className: 'dsh-spend-panel',
            role: 'dialog',
            'aria-label': t('dialog.title'),
            style: { positionAnchor: anchorName },
          },
            h('div', { className: 'dsh-spend-title' },
              h('span', { className: 'dsh-spend-title-label' }, h(SpendGlyph), t('dialog.title')),
              h('span', { className: 'dsh-spend-title-value' }, dialogValue),
            ),
            h('div', { className: 'dsh-spend-rule' }),
            h(Section, { title: priced ? t('section.spend') : t('section.tokens') }, spendRows),
            h(Section, { title: t('section.activity') }, rows(activityPairs)),
            modelRows === null ? null : h(Section, { title: t('section.models') }, modelRows),
            notes,
          ),
          document.body,
        ) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-spend-tracker', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'spend-tracker.styles')
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'spend-tracker.locale.en')
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'spend-tracker.locale.zh')
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'spend',
          order: 2,
          locale: NS,
        }, SpendPill))
      },
    }
  },
})
