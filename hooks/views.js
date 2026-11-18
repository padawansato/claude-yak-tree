// 表示モード（e: アウトライナー風、a: git のグラフ風）と、見出しの要約の作り方。`$` は受け取らない。
// Box / Text は register.js が `$.ui.resolve(e)` で得たものを引数で渡す。
// 表示する行の選び方は view.js の selectRows / layout をそのまま使う。

import { selectRows, layout, SYMBOLS } from './view.js'
import { VIEW_MODES, DEFAULT_VIEW } from './config.js'
import { t } from './i18n.js'
import { parseTree } from './tree.js'

export const MODES = VIEW_MODES
export const DEFAULT_MODE = DEFAULT_VIEW

/**
 * 各行の「追加した時刻」。仮の値（id → hh:mm）。ファイル形式に時刻が入ったら差し替える。
 */
export const SAMPLE_TIMES = {
  k1h0a1: '08:00',
  k2h1b2: '08:01',
  k3c2c3: '08:03',
  k4r3d4: '08:04',
  k5b4e5: '08:06',
  k6o5f6: '08:07',
  k7i6g7: '08:08',
  k8q7h8: '08:09',
  k9s8i9: '08:05',
  k0c9j0: '08:05',
  k1a0k1: '08:02',
}

// P0 のサンプルツリーの構造。本文は i18n.js の `sample.<番号>`（番号は行の順）。
// 家の鍵を探す例：試した場所（done）、いま調べている所（here）とその下の疑問、次の候補、別案、
// 見つけた場所の下の important、やめた案（abandoned）。
const SAMPLE_ROWS = [
  [0, '', 'k1h0a1'],
  [1, 'done', 'k2h1b2'],
  [1, 'done', 'k3c2c3'],
  [2, 'important', 'k4r3d4'],
  [1, 'here', 'k5b4e5'],
  [2, 'done', 'k6o5f6'],
  [2, '', 'k7i6g7'],
  [2, '', 'k8q7h8'],
  [1, '', 'k9s8i9'],
  [1, 'abandoned', 'k0c9j0'],
  [0, '', 'k1a0k1'],
]

/** 言語ごとのサンプルツリー（parseTree できる Markdown）。 */
export function sampleMarkdown(lang) {
  return (
    SAMPLE_ROWS.map(([depth, mark, id], i) => '    '.repeat(depth) + '- ' + (mark ? `__${mark}__ ` : '') + t(lang, `sample.${i + 1}`) + ` <!--${id}-->`).join('\n') + '\n'
  )
}

/** 経過ミリ秒 → `47m` / `1h05m`（負は 0 に丸める） */
export function formatElapsed(ms) {
  const min = Math.max(0, Math.floor(ms / 60000))
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}m`
}

export function sampleTree(lang) {
  return parseTree(sampleMarkdown(lang))
}

export function isMode(s) {
  return MODES.includes(s)
}

/** `/tree e` の引数文字列からモードを取り出す。モードでなければ null。 */
export function parseModeArg(args) {
  const a = String(args ?? '').trim().toLowerCase()
  return isMode(a) ? a : null
}

/** 起動時に使うモード。優先順位は $.store の保存値 → userConfig の view → e。 */
export function resolveMode(stored, configView) {
  if (isMode(stored)) return stored
  return isMode(configView) ? configView : DEFAULT_MODE
}

/**
 * 見出しの要約。important は印の付いたノード数（ツリー全体）、open は印のないノードのうち here とその祖先を除いた数
 * （まだ手を付けていない戻り先・候補）。
 * 拡張点: 将来 ask / question の印が入ったら、ここに数を足す。
 */
export function summarize(doc) {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const onPath = new Set()
  for (let cur = doc.here; cur; cur = byId.get(cur)?.parent) onPath.add(cur)
  let important = 0
  let open = 0
  for (const n of doc.nodes) {
    if (n.mark === 'important') important++
    else if (!n.mark && !onPath.has(n.id)) open++
  }
  return { important, open }
}

/** `★1 · open 4`。0 の項目は出さない。 */
export function summaryText(lang, { important, open }) {
  const parts = []
  if (important > 0) parts.push(t(lang, 'pane.important', { n: important }))
  if (open > 0) parts.push(t(lang, 'pane.open', { n: open }))
  return parts.join(' · ')
}

/** 見出し行：`{名前}  {要約} {省略行数}  {モード}`。幅が足りないときは末尾（モード）から切れる。 */
// command は登録できたコマンド名（/yak-tree に逃がしたときは 'yak-tree'）
export function headingText(lang, base, mode, summary, omitted = 0, command = 'tree') {
  const sum = summary ? summaryText(lang, summary) : ''
  const om = omitted > 0 ? t(lang, 'pane.omitted', { n: omitted }) : ''
  return `${base}${sum ? '  ' + sum : ''}${om}  ${t(lang, 'pane.mode', { mode, command })}`
}

const STYLES = {
  here: { bold: true, color: 'green' },
  done: { dimColor: true },
  abandoned: { dimColor: true, strikethrough: true },
  important: { color: 'yellow' },
  none: {},
}

/** view.js の layout が残した行だけを、selectRows の情報（depth、mark、hidden）付きで返す。 */
export function visibleRows(doc, bodyRows) {
  const kept = new Set(layout(doc, { bodyRows }).lines.map((l) => l.id))
  return selectRows(doc).filter((r) => kept.has(r.id))
}

const suffixOf = (r) => (r.hidden > 0 ? ` (+${r.hidden})` : '')
const markKey = (r) => r.mark ?? 'none'

/**
 * @param {{Box: Function, Text: Function}} ui
 * @param {object} doc
 * @param {{ bodyColumns: number, bodyRows?: number, times?: object, hereElapsedMs?: number | null, lang?: string }} ctx
 * times と hereElapsedMs は仮の値（ファイル形式に時刻が入ったら差し替える）。実ファイルのツリーは times: {} で、hereElapsedMs を渡さない（null）と時刻も経過時間も出さない
 * @returns {{ elements: object[], omitted: number }} 見出しの下に並べる要素と、高さに収めるため落とした行数
 */
export function renderView(mode, ui, doc, ctx) {
  const c = { times: SAMPLE_TIMES, hereElapsedMs: null, lang: 'en', ...ctx }
  const omitted = layout(doc, { bodyRows: c.bodyRows }).omitted
  return { elements: mode === 'a' ? renderGraph(ui, doc, c) : renderOutliner(ui, doc, c), omitted }
}

// ---- e. アウトライナー風 ----
function renderOutliner({ Box, Text }, doc, c) {
  const rows = visibleRows(doc, c.bodyRows)
  return rows.map((r) => {
    const key = markKey(r)
    const accent = r.role === 'here' || r.role === 'path'
    const time = c.times[r.id] ?? ''
    // 時刻を右端の列にそろえるため、(+N) と here の経過は時刻の前に括弧で置く
    const right = (r.hidden > 0 ? `(+${r.hidden}) ` : '') + (r.role === 'here' && c.hereElapsedMs != null ? `(${formatElapsed(c.hereElapsedMs)}) ` : '') + time
    return Box({
      key: 'n-' + r.id,
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: c.bodyColumns,
      children: [
        Box({
          flexDirection: 'row',
          flexGrow: 1,
          flexShrink: 1,
          children: [
            Box({ flexShrink: 0, children: [Text({ color: 'green', children: [accent ? '▎ ' : '  '] })] }),
            Box({ flexShrink: 0, children: [Text({ dimColor: true, children: ['│ '.repeat(r.depth)] })] }),
            Text({ wrap: 'truncate-end', ...STYLES[key], children: [`${SYMBOLS[key]} ${r.text}`] }),
          ],
        }),
        Box({ flexShrink: 0, marginLeft: 1, children: [Text({ dimColor: true, children: [right] })] }),
      ],
    })
  })
}

// ---- a. git log --graph 風 ----

/** 行 i の枝の接頭辞。スロット j は深さ j+1 の祖先（または自分）に対応し、後ろに同じ深さの兄弟があれば ├─ / │。 */
export function graphPrefix(rows, i) {
  const d = rows[i].depth
  const hasLater = (level) => {
    for (let k = i + 1; k < rows.length; k++) {
      if (rows[k].depth <= level) return rows[k].depth === level
    }
    return false
  }
  let s = ' '
  for (let j = 0; j < d; j++) {
    const later = hasLater(j + 1)
    s += j === d - 1 ? (later ? '├─' : '└─') : later ? '│ ' : '  '
  }
  return s
}

const GRAPH_SYMBOL = { done: '◉', here: '●', none: '○', abandoned: '✗', important: '★' }

function renderGraph({ Box, Text }, doc, c) {
  // 枝は行を落とす前の全行で決める（後ろに兄弟があったかを、落とした行も含めて判定する）。
  // たたみ線の下の important は、表示されない親ではなく所有者の行から出る枝にするため、深さを所有者の 1 つ下とする
  const full = selectRows(doc)
  const depthOf = new Map(full.map((r) => [r.id, r.depth]))
  const eff = full.map((r) => ({ ...r, depth: r.owner ? depthOf.get(r.owner) + 1 : r.depth }))
  const prefixOf = new Map(eff.map((r, i) => [r.id, graphPrefix(eff, i)]))
  const rows = visibleRows(doc, c.bodyRows)
  return rows.map((r) => {
    const key = markKey(r)
    const sym = r.role === 'path' ? '◎' : GRAPH_SYMBOL[key]
    const isHere = r.role === 'here'
    const children = [
      Box({ flexShrink: 0, children: [Text({ dimColor: true, children: [prefixOf.get(r.id)] })] }),
      Box({ flexShrink: 0, children: [Text({ ...STYLES[key], children: [sym] })] }),
      Text({ wrap: 'truncate-end', ...STYLES[key], children: [` ${r.text}${suffixOf(r)}`] }),
    ]
    if (isHere) children.push(Box({ flexShrink: 0, children: [Text({ bold: true, color: 'green', children: [`  ◀ ${t(c.lang, 'view.here')}${c.hereElapsedMs != null ? ' ' + formatElapsed(c.hereElapsedMs) : ''}`] })] }))
    return Box({
      key: 'n-' + r.id,
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: c.bodyColumns,
      children: [
        Box({ flexDirection: 'row', flexGrow: 1, flexShrink: 1, children }),
        Box({ flexShrink: 0, marginLeft: 1, children: [Text({ dimColor: true, children: [c.times[r.id] ?? ''] })] }),
      ],
    })
  })
}
