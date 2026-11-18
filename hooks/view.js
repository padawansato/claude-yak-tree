// 表示モデルの純関数（設計書 §7.2、§7.3）。`$` は受け取らない。
// Pane の見出し行と Text 要素の組み立ては register.js 側。

export const SYMBOLS = { here: '▶', done: '✓', abandoned: '✗', important: '★', none: '·' }

const STYLES = {
  here: { bold: true, color: 'green' },
  done: { dimColor: true },
  abandoned: { dimColor: true },
  important: { color: 'yellow' },
  none: {},
}

/**
 * path 上のノード（here とその祖先）は done / abandoned でもたたまない（たたむと here が隠れる。§7.2 手順 4）。
 */
function foldsPathNode(_node) {
  return false
}

/**
 * 表示する行を選ぶ。
 * role: 'path'（here の祖先）| 'here' | 'here-child' | 'sibling' | 'important'
 * hidden: たたんだ行の「表示しなかった子孫の数」。important 行の owner はそれをたたんだ行の id。
 */
export function selectRows(doc) {
  const nodes = doc.nodes
  const byId = new Map(nodes.map((n, i) => [n.id, { n, i }]))
  const hereId = doc.here

  const pathIds = new Set()
  for (let cur = hereId; cur; cur = byId.get(cur).n.parent) pathIds.add(cur)

  const descendants = (i) => {
    const d = nodes[i].depth
    const out = []
    for (let j = i + 1; j < nodes.length && nodes[j].depth > d; j++) out.push(j)
    return out
  }

  const rows = []
  const emitted = new Set()
  nodes.forEach((n, i) => {
    if (emitted.has(i)) return
    let role = null
    if (n.id === hereId) role = 'here'
    else if (pathIds.has(n.id)) role = 'path'
    else if (n.parent === null || pathIds.has(n.parent)) role = hereId && n.parent === hereId ? 'here-child' : 'sibling'
    if (!role) return

    const onPath = role === 'path' || role === 'here'
    // path 外（兄弟と here の子）は子孫を隠す。here の子は done でなくても同じ（§7.2、§14.4）
    const folded = onPath ? foldsPathNode(n) : true
    emitted.add(i)
    const row = { id: n.id, depth: n.depth, mark: n.mark, text: n.text, role, hidden: 0, owner: null, index: i }
    rows.push(row)
    if (!folded) return

    const desc = descendants(i)
    const keep = desc.filter((j) => nodes[j].mark === 'important')
    row.hidden = desc.length - keep.length
    for (const j of keep) {
      emitted.add(j)
      const m = nodes[j]
      rows.push({ id: m.id, depth: m.depth, mark: m.mark, text: m.text, role: 'important', hidden: 0, owner: n.id, ownerRole: role, index: j })
    }
    // 子孫は他の分岐では選ばれないが、important 以外は表示しないので飛ばす
    for (const j of desc) emitted.add(j)
  })
  return rows
}

// 字下げの縦線（エディタの字下げ線と同じく、段ごとに先頭の列へ引く）。register.js が dim で描く
export const GUIDE = '│ '

function toLine(r) {
  const key = r.mark ?? 'none'
  const suffix = r.hidden > 0 ? ` (+${r.hidden})` : ''
  return { id: r.id, role: r.role, guide: GUIDE.repeat(r.depth), text: `${SYMBOLS[key]} ${r.text}${suffix}`, style: { ...STYLES[key] } }
}

/**
 * @param {object} doc
 * @param {{ bodyColumns?: number, bodyRows?: number }} opts
 *   bodyRows は見出し 1 行を含む行数。幅は切り詰めない（Text の wrap: 'truncate-end' に任せる）。
 * @returns {{ lines: {id, role, guide, text, style}[], omitted: number, hereId: string | null }}
 *   guide は字下げの縦線（深さ × GUIDE）。text は記号から後ろ。
 */
export function layout(doc, { bodyRows = Infinity } = {}) {
  const all = selectRows(doc)
  const avail = Math.max(bodyRows - 1, 0)
  const dropped = new Set()
  const remaining = () => all.length - dropped.size

  const hereIndex = doc.nodes.findIndex((n) => n.id === doc.here) // なければ -1
  const drop = (r) => dropped.add(r)

  // 1. 兄弟（here から遠い順、同距離なら文書順で後ろ）。下の important 行も一緒に
  const siblings = all.filter((r) => r.role === 'sibling')
  siblings.sort((a, b) => Math.abs(b.index - hereIndex) - Math.abs(a.index - hereIndex) || b.index - a.index)
  for (const s of siblings) {
    if (remaining() <= avail) break
    drop(s)
    for (const r of all) if (r.owner === s.id) drop(r)
  }
  // 2. here の子の下の important（文書順で後ろから）
  for (const r of [...all].reverse()) {
    if (remaining() <= avail) break
    if (r.role === 'important' && !dropped.has(r)) drop(r)
  }
  // 3. here の子（末尾から）
  for (const r of [...all].reverse()) {
    if (remaining() <= avail) break
    if (r.role === 'here-child' && !dropped.has(r)) drop(r)
  }

  const kept = all.filter((r) => !dropped.has(r))
  return { lines: kept.map(toLine), omitted: dropped.size, hereId: doc.here }
}
