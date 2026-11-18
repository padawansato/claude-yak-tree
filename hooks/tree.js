// yak-tree の木の純関数（設計書 §4、§6）。`$` は受け取らない。
// 文書モデル: { prelude: string[], nodes: Node[], issues: Issue[], here: string | null }
// Node: { id, text, mark: 'done'|'here'|'important'|'abandoned'|null, depth, parent: id|null, trailing: string[] }
// nodes は文書順の平坦な配列。操作は入力を変更せず、新しい doc を返す。

import { t } from './i18n.js'

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
// 行末の隠し ID。空白なし 6 文字固定（§4.1）
const ID_RE = /<!--([0-9a-z]{6})-->$/
const BULLET_RE = /^([ \t]*)[-*+][ \t]+(.*)$/
const MARK_RE = /^__(done|here|important|abandoned)__(?:\s+|$)/
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/
const FENCE_CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/
const SETTABLE_MARKS = ['done', 'important', 'abandoned', 'none']

/**
 * code は機械可読（E_BAD_INPUT など）。人に見える文は i18n.js のキー（key）と params から作る。
 * message は英語。表示言語に合わせるときは `t(lang, e.key, e.params)` で作り直す。
 */
export class TreeError extends Error {
  constructor(code, key, params = {}) {
    super(`${code}: ${t('en', key, params)}`)
    this.name = 'TreeError'
    this.code = code
    this.key = key
    this.params = params
  }
}

/** 6 文字の ID を作る。taken にあるものは引き直す。 */
export function newId(taken = new Set()) {
  for (;;) {
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    let s = ''
    let ok = true
    for (const b of bytes) {
      if (b >= 252) { ok = false; break } // 36 の倍数で切って偏りをなくす
      s += ID_ALPHABET[b % 36]
    }
    if (ok && !taken.has(s)) return s
  }
}

/** 行頭の空白を列数に直す。タブは次の 4 の倍数へ。 */
function indentColumns(ws) {
  let col = 0
  for (const ch of ws) col = ch === '\t' ? col + (4 - (col % 4)) : col + 1
  return col
}

/**
 * @param {string} text
 * @param {{ newId?: (taken: Set<string>) => string }} [opts]
 */
export function parseTree(text, opts = {}) {
  const gen = opts.newId ?? newId
  // CRLF のファイルも読めるように行末の \r を落とす（書き出しは LF）
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  if (lines.at(-1) === '') lines.pop()

  const prelude = []
  const nodes = []
  const issues = []
  const taken = new Set()
  const stack = [] // { col, node }
  let fence = null // { ch, len }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const prev = nodes.at(-1)
    const asProse = () => (prev ? prev.trailing : prelude).push(raw)

    if (fence) {
      const c = FENCE_CLOSE_RE.exec(raw)
      if (c && c[1][0] === fence.ch && c[1].length >= fence.len) fence = null
      asProse()
      continue
    }
    const f = FENCE_OPEN_RE.exec(raw)
    if (f) {
      fence = { ch: f[1][0], len: f[1].length }
      asProse()
      continue
    }
    const m = BULLET_RE.exec(raw)
    if (!m) {
      asProse()
      continue
    }

    const col = indentColumns(m[1])
    let body = m[2].trimEnd()

    let id = null
    const idm = ID_RE.exec(body)
    if (idm) {
      id = idm[1]
      body = body.slice(0, idm.index).trimEnd()
    }

    let mark = null
    const mm = MARK_RE.exec(body)
    if (mm) {
      mark = mm[1]
      body = body.slice(mm[0].length)
    }

    while (stack.length && stack.at(-1).col >= col) stack.pop()

    if (id && taken.has(id)) {
      id = null
      issues.push({ kind: 'dup-id', line: i + 1 })
    } else if (!id) {
      issues.push({ kind: 'no-id', line: i + 1 })
    }
    if (!id) id = gen(taken)
    taken.add(id)

    const node = { id, text: body, mark, depth: stack.length, parent: stack.length ? stack.at(-1).node.id : null, trailing: [] }
    nodes.push(node)
    stack.push({ col, node })
  }

  const heres = nodes.filter((n) => n.mark === 'here')
  if (heres.length > 1) {
    issues.push({ kind: 'multi-here', ids: heres.map((n) => n.id) })
    for (const n of heres.slice(0, -1)) n.mark = null
  }
  return { prelude, nodes, issues, here: heres.at(-1)?.id ?? null }
}

export function serializeTree(doc) {
  const out = [...doc.prelude]
  for (const n of doc.nodes) {
    out.push('    '.repeat(n.depth) + '- ' + (n.mark ? `__${n.mark}__ ` : '') + n.text.trimEnd() + ` <!--${n.id}-->`)
    out.push(...n.trailing)
  }
  return out.length ? out.join('\n') + '\n' : ''
}

/** 本文を parse → serialize した結果と、書き戻すべきかどうか。読み取り時の ID 補正用（§4.4）。 */
export function repairText(text, opts) {
  const doc = parseTree(text, opts)
  const out = serializeTree(doc)
  return { text: out, issues: doc.issues, changed: out !== text }
}

// ---- 操作 ----

function clone(doc) {
  return { prelude: [...doc.prelude], nodes: doc.nodes.map((n) => ({ ...n, trailing: [...n.trailing] })), issues: [...doc.issues], here: doc.here }
}

function indexOf(doc, id) {
  const i = doc.nodes.findIndex((n) => n.id === id)
  if (i < 0) throw new TreeError('E_NOT_FOUND', 'err.notFound', { id })
  return i
}

const LEADING_MARK_RE = /^__(done|here|important|abandoned)__(?:\s|$)/
const COMMENT_RE = /<!--[\s\S]*?-->/

// 本文は 1 行で、印の記法や HTML コメントを含まない（再 parse で印や ID に解釈されるため。§14.4）
function checkText(text) {
  if (typeof text !== 'string') throw new TreeError('E_BAD_INPUT', 'err.textNotString')
  if (text.trim() === '') throw new TreeError('E_BAD_INPUT', 'err.emptyText')
  // U+2028 / U+2029 も行の区切りとして扱われ、次の parse でノードでなくなる
  if (/[\r\n\u2028\u2029]/.test(text)) throw new TreeError('E_BAD_INPUT', 'err.singleLine')
  const body = text.trim()
  if (LEADING_MARK_RE.test(body)) throw new TreeError('E_BAD_INPUT', 'err.startsWithMark')
  if (COMMENT_RE.test(body)) throw new TreeError('E_BAD_INPUT', 'err.containsComment')
  return body
}

function hereOf(doc) {
  return doc.nodes.find((n) => n.mark === 'here')?.id ?? null
}

/** 親の部分木の末尾の次の添字（親省略なら nodes.length） */
function endOfSubtree(doc, i) {
  const d = doc.nodes[i].depth
  let j = i + 1
  while (j < doc.nodes.length && doc.nodes[j].depth > d) j++
  return j
}

/** @returns {{ doc, id: string }} */
export function addNode(doc, { parentId, text, here = false, id }) {
  const body = checkText(text)
  const next = clone(doc)
  let at = next.nodes.length
  let depth = 0
  let parent = null
  if (parentId !== undefined && parentId !== null) {
    const pi = indexOf(next, parentId)
    at = endOfSubtree(next, pi)
    depth = next.nodes[pi].depth + 1
    parent = parentId
  }
  const newNodeId = id ?? newId(new Set(next.nodes.map((n) => n.id)))
  if (here) for (const n of next.nodes) if (n.mark === 'here') n.mark = null
  next.nodes.splice(at, 0, { id: newNodeId, text: body, mark: here ? 'here' : null, depth, parent, trailing: [] })
  next.here = hereOf(next)
  return { doc: next, id: newNodeId }
}

/** @returns {{ doc, previous: string | null }} */
export function setHere(doc, id) {
  const next = clone(doc)
  const node = next.nodes[indexOf(next, id)]
  if (node.mark !== null && node.mark !== 'here') {
    throw new TreeError('E_BAD_INPUT', 'err.markedNode', { id, mark: node.mark })
  }
  const previous = next.here
  for (const n of next.nodes) if (n.mark === 'here') n.mark = null
  node.mark = 'here'
  next.here = id
  return { doc: next, previous }
}

/**
 * @returns {{ doc, movedTo?: string | null, note?: { key: string, params: object } }}
 *   movedTo: here が自動で移った先（here なしなら null）。移っていなければ undefined。
 *   note: here の祖先を done / abandoned にしたときの注意（here は動かさない。§6）。文は i18n.js の key（`t(lang, note.key, note.params)`）。
 */
export function markNode(doc, id, mark) {
  if (!SETTABLE_MARKS.includes(mark)) throw new TreeError('E_BAD_INPUT', 'err.badMark', { marks: SETTABLE_MARKS.join(', ') })
  const i = indexOf(doc, id)
  if (doc.nodes[i].mark === 'here') {
    if (mark === 'important') throw new TreeError('E_BAD_INPUT', 'err.importantHere')
    if (mark === 'done' || mark === 'abandoned') return moveHereAfterClose(doc, id, mark)
  }
  const next = clone(doc)
  next.nodes[i].mark = mark === 'none' ? null : mark
  next.here = hereOf(next)
  const result = { doc: next }
  if ((mark === 'done' || mark === 'abandoned') && doc.here && isAncestor(doc, id, doc.here)) {
    result.note = { key: 'note.ancestorOfHere', params: { id, here: doc.here } }
  }
  return result
}

function isAncestor(doc, ancestorId, nodeId) {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  for (let cur = byId.get(nodeId)?.parent; cur; cur = byId.get(cur)?.parent) if (cur === ancestorId) return true
  return false
}

/**
 * here のノードを done / abandoned にして here を移す（§6）。
 * 候補は印のないノードだけ: 印のない親 → 後続の最初の印のない兄弟 → さらに上の最も近い印のない祖先。無ければ here なし。
 * @returns {{ doc, movedTo: string | null }}
 */
export function moveHereAfterClose(doc, id, mark) {
  if (mark !== 'done' && mark !== 'abandoned') throw new TreeError('E_BAD_INPUT', 'err.badCloseMark')
  const i = indexOf(doc, id)
  if (doc.nodes[i].mark !== 'here') throw new TreeError('E_BAD_INPUT', 'err.notHere', { id })
  const next = clone(doc)
  const node = next.nodes[i]
  node.mark = mark
  const byId = new Map(next.nodes.map((n) => [n.id, n]))

  let target = null
  const parent = node.parent ? byId.get(node.parent) : null
  if (parent && parent.mark === null) target = parent
  if (!target) {
    for (let j = endOfSubtree(next, i); j < next.nodes.length && next.nodes[j].depth >= node.depth; j++) {
      const m = next.nodes[j]
      if (m.depth === node.depth && m.parent === node.parent && m.mark === null) { target = m; break }
    }
  }
  if (!target && parent) {
    for (let cur = parent.parent ? byId.get(parent.parent) : null; cur; cur = cur.parent ? byId.get(cur.parent) : null) {
      if (cur.mark === null) { target = cur; break }
    }
  }
  if (target) target.mark = 'here'
  next.here = hereOf(next)
  return { doc: next, movedTo: target ? target.id : null }
}

/** 本文だけ置換。印と ID は保持。 */
export function editNode(doc, id, text) {
  const body = checkText(text)
  const next = clone(doc)
  next.nodes[indexOf(next, id)].text = body
  return { doc: next }
}
