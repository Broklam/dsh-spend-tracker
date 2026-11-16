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
      'pill.tokensTitle': 'Session tokens: {tokens}; no price is configured for the models it used',
      'pill.tokens': '{tokens} tokens',
      'dialog.title': 'Session spend',
      'status.peak': 'Peak hours · off-peak starts in {remaining}',
      'status.offPeak': 'Off-peak hours · {percent}% off · peak starts in {remaining}',
      'status.peakNoBoundary': 'Peak hours',
      'status.offPeakNoBoundary': 'Off-peak hours · {percent}% off',
      'duration.minutes': '{minutes}m',
      'duration.hours': '{hours}h',
      'duration.hoursMinutes': '{hours}h {minutes}m',
      'duration.days': '{days}d',
      'duration.daysHours': '{days}d {hours}h',
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
      'note.unpriced': 'Unpriced model usage — calls: {calls}, tokens: {tokens}. Add that model\'s rates under pricing in cordis.patch.yml.',
      'note.models': 'Showing {shown} of {total} models.',
      'note.estimate': 'Estimated from DeepSeek\'s prices, not a billed amount.',
      'note.offPeakSaved': 'Off-peak rates lowered this estimate by about {amount}.',
      'note.rates': 'Rate table refreshed from the pricing page {when}.',
      'note.ratesBundled': 'Bundled DeepSeek prices (the live refresh is off or has not succeeded).',
      'time.justNow': 'just now',
      'time.minutesAgo': '{minutes} min ago',
      'time.hoursAgo': '{hours}h ago',
      'time.daysAgo': '{days}d ago',
    }

    /** Simplified Chinese dictionary of the same keys. */
    const ZH = {
      'pill.spendTitle': '本次会话花费（估算）：{cost}',
      'pill.tokensTitle': '本次会话 {tokens} tokens；所用模型未配置价格',
      'pill.tokens': '{tokens} tokens',
      'dialog.title': '会话花费',
      'status.peak': '高峰时段 · {remaining}后转非高峰',
      'status.offPeak': '非高峰时段 · 优惠 {percent}% · {remaining}后转高峰',
      'status.peakNoBoundary': '高峰时段',
      'status.offPeakNoBoundary': '非高峰时段 · 优惠 {percent}%',
      'duration.minutes': '{minutes}分钟',
      'duration.hours': '{hours}小时',
      'duration.hoursMinutes': '{hours}小时{minutes}分',
      'duration.days': '{days}天',
      'duration.daysHours': '{days}天{hours}小时',
      'section.spend': '估算花费',
      'section.tokens': 'Token 数',
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
      'note.unpriced': '未定价的模型用量 — 调用：{calls} 次，Token：{tokens} 个。可在 cordis.patch.yml 的 pricing 中为该模型补充价格。',
      'note.models': '仅显示 {total} 个模型中的前 {shown} 个。',
      'note.estimate': '按 DeepSeek 价格估算，并非实际账单金额。',
      'note.offPeakSaved': '非高峰费率使本次估算减少约 {amount}。',
      'note.rates': '价格表已从定价页更新：{when}。',
      'note.ratesBundled': '使用内置 DeepSeek 价格（实时刷新已关闭或尚未成功）。',
      'time.justNow': '刚刚',
      'time.minutesAgo': '{minutes} 分钟前',
      'time.hoursAgo': '{hours} 小时前',
      'time.daysAgo': '{days} 天前',
    }

    /**
     * Pill and dialog skin; theme tokens only, host tokens with graceful
     * fallbacks. The panel is measured and pinned in JavaScript, so it never
     * relies on CSS anchor positioning and never moves when its content
     * updates: its box stays exactly where it opened, and a growing list
     * scrolls inside it.
     */
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
        max-width: min(440px, calc(100vw - 24px));
        max-height: calc(100dvh - 24px);
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
        display: flex;
        flex-direction: column;
        --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
        --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
      }
      .dsh-spend-panel-head {
        position: sticky;
        top: 0;
        z-index: 1;
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, Canvas));
      }
      .dsh-spend-panel-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        scrollbar-gutter: stable;
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
      .dsh-spend-status {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, CanvasText));
        font-variant-numeric: tabular-nums;
      }
      .dsh-spend-status-dot {
        width: 6px;
        height: 6px;
        flex: none;
        border-radius: 50%;
        background: var(--dsw-alias-state-warn-primary, currentColor);
      }
      .dsh-spend-status[data-tier='offPeak'] .dsh-spend-status-dot {
        background: var(--dsw-alias-state-success-primary, currentColor);
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

    // ---------------------------------------------------------------- rate status

    /** UTC calendar day of an instant, matching the Host's holiday keys. */
    function utcDay(epochMs) {
      return new Date(epochMs).toISOString().slice(0, 10)
    }

    /**
     * Whether an instant bills at peak rates. Mirrors `pricing.js` on the Host:
     * the windows are half-open UTC-minute ranges, a holiday is off-peak in
     * full, and `null` means off-peak pricing is not in effect.
     * @param schedule - wire schedule from the Host view.
     * @param epochMs - instant to classify.
     * @returns `'peak'`, `'offPeak'`, or null when no schedule applies.
     */
    function tierAt(schedule, epochMs) {
      if (!schedule || schedule.enabled !== true || !Array.isArray(schedule.windows) || schedule.windows.length === 0) return null
      const time = new Date(epochMs)
      const day = time.getUTCDay()
      const minutes = time.getUTCHours() * 60 + time.getUTCMinutes()
      if (Array.isArray(schedule.holidays) && schedule.holidays.includes(utcDay(epochMs))) return 'offPeak'
      const peak = schedule.windows.some(window => window.days.includes(day) && minutes >= window.start && minutes < window.end)
      return peak ? 'peak' : 'offPeak'
    }

    /**
     * Milliseconds until the next tier change, or null when no boundary falls
     * within a fortnight. Checks the boundary instants directly (midnight,
     * window starts and ends) rather than walking the clock minute by minute.
     */
    function msUntilTierChange(schedule, epochMs) {
      const current = tierAt(schedule, epochMs)
      if (current === null) return null
      const dayStart = Math.floor(epochMs / 86400000) * 86400000
      const candidates = []
      for (let offset = 0; offset <= 15; offset += 1) {
        const midnight = dayStart + offset * 86400000
        candidates.push(midnight)
        const day = new Date(midnight).getUTCDay()
        for (const window of schedule.windows) {
          if (!window.days.includes(day)) continue
          candidates.push(midnight + window.start * 60000, midnight + window.end * 60000)
        }
      }
      candidates.sort((left, right) => left - right)
      for (const candidate of candidates) {
        if (candidate > epochMs && tierAt(schedule, candidate) !== current) return candidate - epochMs
      }
      return null
    }

    /** Tier, discount percentage, and countdown text for one instant. */
    function describeStatus(schedule, epochMs, t) {
      const tier = tierAt(schedule, epochMs)
      if (tier === null) return null
      const percentOff = Math.round(schedule.discount * 100)
      const remaining = msUntilTierChange(schedule, epochMs)
      const text = tier === 'peak'
        ? (remaining === null ? t('status.peakNoBoundary') : t('status.peak', { remaining: formatRemaining(remaining, t) }))
        : (remaining === null
          ? t('status.offPeakNoBoundary', { percent: percentOff })
          : t('status.offPeak', { percent: percentOff, remaining: formatRemaining(remaining, t) }))
      return { tier, text, percentOff, remaining }
    }

    /** Short remaining-time text: 48m / 2h 14m / 1d / 1d 3h. */
    function formatRemaining(ms, t) {
      const totalMinutes = Math.max(1, Math.ceil(ms / 60000))
      if (totalMinutes < 60) return t('duration.minutes', { minutes: totalMinutes })
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      if (hours < 24) return minutes === 0 ? t('duration.hours', { hours }) : t('duration.hoursMinutes', { hours, minutes })
      const days = Math.floor(hours / 24)
      return hours % 24 === 0 ? t('duration.days', { days }) : t('duration.daysHours', { days, hours: hours % 24 })
    }

    /** Relative age of the live rate table: just now / 12 min ago / 3h ago / 2d ago. */
    function formatAge(updatedAt, now, t) {
      const age = Math.max(0, now - updatedAt)
      if (age < 60000) return t('time.justNow')
      if (age < 3600000) return t('time.minutesAgo', { minutes: Math.round(age / 60000) })
      if (age < 86400000) return t('time.hoursAgo', { hours: Math.round(age / 3600000) })
      return t('time.daysAgo', { days: Math.round(age / 86400000) })
    }

    // ---------------------------------------------------------------- placement

    /** Gap between the pill and its panel, and the panel's viewport inset. */
    const PANEL_GAP = 8
    const PANEL_INSET = 12
    /** Preferred panel width bounds. */
    const PANEL_MIN_WIDTH = 300
    const PANEL_MAX_WIDTH = 440

    /** Host-defined top overlay inset, so the pinned panel stays below window chrome. */
    function overlayTopInset() {
      try {
        const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-overlay-top')
        const value = Number.parseFloat(raw)
        return Number.isFinite(value) && value > PANEL_INSET ? value : PANEL_INSET
      } catch {
        return PANEL_INSET
      }
    }

    /**
     * Pin one panel geometry above (preferred) or below its trigger. The
     * result is a complete fixed box: once applied, the panel never moves when
     * its content grows, so a live-updating reading cannot drag it upward.
     * @param trigger - pill rect in viewport coordinates.
     * @param panel - panel's natural size.
     * @param viewport - current viewport size.
     * @param topInset - host chrome to stay below, in pixels.
     * @returns fixed top/left/width/height in pixels.
     */
    function computePanelPlacement(trigger, panel, viewport, topInset = PANEL_INSET) {
      const headroom = Math.max(PANEL_INSET, topInset)
      const maxWidth = Math.min(PANEL_MAX_WIDTH, Math.max(0, viewport.width - PANEL_INSET * 2))
      const width = Math.min(Math.max(panel.width, Math.min(PANEL_MIN_WIDTH, maxWidth)), maxWidth)
      const naturalHeight = Math.min(panel.height, Math.max(0, viewport.height - headroom - PANEL_INSET))
      const spaceAbove = Math.max(0, trigger.top - PANEL_GAP - headroom)
      const spaceBelow = Math.max(0, viewport.height - PANEL_INSET - trigger.bottom - PANEL_GAP)
      let above = naturalHeight <= spaceAbove || (naturalHeight > spaceBelow && spaceAbove >= spaceBelow)
      let height = Math.min(naturalHeight, above ? spaceAbove : spaceBelow)
      if (height <= 0) {
        above = spaceAbove >= spaceBelow
        height = Math.min(naturalHeight, Math.max(0, Math.max(spaceAbove, spaceBelow)))
      }
      const top = above
        ? Math.max(headroom, trigger.top - PANEL_GAP - height)
        : Math.min(viewport.height - PANEL_INSET - height, trigger.bottom + PANEL_GAP)
      const left = Math.max(PANEL_INSET, Math.min(trigger.left, viewport.width - PANEL_INSET - width))
      return { top, left, width, height }
    }

    /** Viewport size; kept in one place so tests read the same shape. */
    function viewportSize() {
      return { width: window.innerWidth, height: window.innerHeight }
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
      const [geometry, setGeometry] = React.useState(null)
      const [now, setNow] = React.useState(() => Date.now())
      const pillRef = React.useRef(null)
      const panelRef = React.useRef(null)

      React.useEffect(() => {
        if (!open) return undefined
        const outside = target => pillRef.current?.contains(target) !== true && panelRef.current?.contains(target) !== true
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

      // The tier boundary is a wall-clock fact, not a projection update, so the
      // status line ticks on its own while the panel is open. Opening sets the
      // clock before the first paint; the interval keeps it current afterwards.
      React.useEffect(() => {
        if (!open) return undefined
        setNow(Date.now())
        const timer = setInterval(() => { setNow(Date.now()) }, 30000)
        return () => { clearInterval(timer) }
      }, [open])

      // Move focus into the dialog while it is open, and give it back to the
      // pill afterwards, so keyboard users are not left behind the portal.
      React.useEffect(() => {
        if (!open) return undefined
        const panel = panelRef.current
        const previous = document.activeElement
        panel?.focus?.()
        return () => {
          // Only take focus back if the closing panel still owns it; a click
          // that opened another control must not be undone here.
          const active = document.activeElement
          const panelOwned = active === null || active === panel || active === document.body
          if (panelOwned && previous !== null && typeof previous.focus === 'function') previous.focus()
        }
      }, [open])

      // Measure once per opening and pin the box. Content updates after this
      // point only scroll inside the pinned box; they never move it.
      React.useLayoutEffect(() => {
        if (!open) return
        const pill = pillRef.current
        const panel = panelRef.current
        if (!pill || !panel) return
        const trigger = pill.getBoundingClientRect()
        const natural = panel.getBoundingClientRect()
        const viewport = viewportSize()
        const maxWidth = Math.min(PANEL_MAX_WIDTH, Math.max(0, viewport.width - PANEL_INSET * 2))
        const width = Math.min(Math.max(natural.width, Math.min(PANEL_MIN_WIDTH, maxWidth)), maxWidth)
        if (Math.abs(width - natural.width) > 0.5) panel.style.width = `${width}px`
        const naturalWidth = width
        const naturalHeight = panel.getBoundingClientRect().height
        const placement = computePanelPlacement(trigger, { width: naturalWidth, height: naturalHeight }, viewport, overlayTopInset())
        setGeometry({ ...placement, naturalWidth, naturalHeight })
      }, [open])

      // A viewport resize re-derives the anchored position from the stored
      // natural size; value updates alone never trigger this.
      React.useEffect(() => {
        if (!open) return undefined
        const onResize = () => {
          const pill = pillRef.current
          setGeometry(current => {
            if (current === null || pill === null) return current
            const placement = computePanelPlacement(
              pill.getBoundingClientRect(),
              { width: current.naturalWidth, height: current.naturalHeight },
              viewportSize(),
              overlayTopInset(),
            )
            return { ...placement, naturalWidth: current.naturalWidth, naturalHeight: current.naturalHeight }
          })
        }
        window.addEventListener('resize', onResize)
        return () => { window.removeEventListener('resize', onResize) }
      }, [open])

      // A Session without billed usage shows no pill at all: there is nothing to price.
      if (spend === undefined || spend === null || spend.tokens.total === 0) return null

      const priced = spend.pricedCalls > 0
      const cost = formatCost(spend.cost, spend.currencySymbol, spend.decimals)
      const totalTokens = formatExactTokens(spend.tokens.total)
      const moneyTokens = (money, tokens) => t('value.moneyTokens', { cost: money, tokens })
      const tokensOnly = tokens => t('value.tokensOnly', { tokens })
      const cacheHit = formatCacheHit(spend.tokens.cacheRead, spend.tokens.input + spend.tokens.cacheRead + spend.tokens.cacheWrite)

      const rateStatus = describeStatus(spend.schedule, now, t)
      const status = rateStatus === null ? null : h('div', { className: 'dsh-spend-status', 'data-tier': rateStatus.tier },
        h('span', { className: 'dsh-spend-status-dot', 'aria-hidden': true }),
        h('span', null, rateStatus.text),
      )

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
      if (priced) {
        notes.push(h('div', { className: 'dsh-spend-note', key: 'estimate' }, t('note.estimate')))
      }
      if (priced && spend.saved > 0 && spend.schedule?.enabled) {
        const savedText = formatCost(spend.saved, spend.currencySymbol, spend.decimals)
        if (!savedText.startsWith('<')) {
          notes.push(h('div', { className: 'dsh-spend-note', key: 'offPeakSaved' }, t('note.offPeakSaved', { amount: savedText })))
        }
      }
      if (priced) {
        const rates = spend.rates ?? null
        if (rates !== null && rates.source === 'deepseek' && rates.updatedAt !== null) {
          notes.push(h('div', { className: 'dsh-spend-note', key: 'rates' }, t('note.rates', { when: formatAge(rates.updatedAt, now, t) })))
        } else {
          notes.push(h('div', { className: 'dsh-spend-note', key: 'ratesBundled' }, t('note.ratesBundled')))
        }
      }

      // The tilde marks an estimate on the resting reading; the dialog explains
      // the same figure in its note, so its rows and title stay plain.
      const estimateCost = cost.startsWith('<') ? cost : `${ESTIMATE_PREFIX}${cost}`
      const headline = priced ? estimateCost : t('pill.tokens', { tokens: formatCompactTokens(spend.tokens.total) })
      const dialogValue = priced ? cost : t('pill.tokens', { tokens: formatCompactTokens(spend.tokens.total) })
      const accessible = priced
        ? t('pill.spendTitle', { cost })
        : t('pill.tokensTitle', { tokens: formatExactTokens(spend.tokens.total) })

      const panelStyle = geometry === null
        ? { visibility: 'hidden', top: 0, left: 0 }
        : {
          visibility: 'visible',
          top: geometry.top,
          left: geometry.left,
          width: geometry.width,
          height: geometry.height,
        }

      return h('span', { className: 'dsh-spend-anchor' },
        h('button', {
          ref: pillRef,
          type: 'button',
          className: 'dsh-spend-pill',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': accessible,
          title: accessible,
          onClick: () => {
            setGeometry(null)
            setNow(Date.now())
            setOpen(!open)
          },
        },
          h(SpendGlyph),
          h('span', { className: 'dsh-spend-label' }, headline),
        ),
        open ? ReactDOM.createPortal(
          h('div', {
            ref: panelRef,
            className: 'dsh-spend-panel',
            role: 'dialog',
            tabIndex: -1,
            'aria-label': t('dialog.title'),
            style: panelStyle,
          },
            h('div', { className: 'dsh-spend-panel-body' },
              h('div', { className: 'dsh-spend-panel-head' },
                h('div', { className: 'dsh-spend-title' },
                  h('span', { className: 'dsh-spend-title-label' }, h(SpendGlyph), t('dialog.title')),
                  h('span', { className: 'dsh-spend-title-value' }, dialogValue),
                ),
                status,
              ),
              h('div', { className: 'dsh-spend-rule' }),
              h(Section, { title: priced ? t('section.spend') : t('section.tokens') }, spendRows),
              h(Section, { title: t('section.activity') }, rows(activityPairs)),
              modelRows === null ? null : h(Section, { title: t('section.models') }, modelRows),
              notes,
            ),
          ),
          document.body,
        ) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      // Pure helpers exposed for the repository's tests only; the DSH loader
      // ignores fields other than the plugin face.
      __test: {
        tierAt,
        msUntilTierChange,
        describeStatus,
        formatRemaining,
        formatAge,
        formatCost,
        computePanelPlacement,
        dictionaries: { EN, ZH },
      },
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
