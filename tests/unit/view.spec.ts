// view.js の単体テスト（node:test）。設計書 §7.2、§7.3、§12.3-11 に対応する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTree } from '../../hooks/tree.js'
import { selectRows, layout, SYMBOLS } from '../../hooks/view.js'

const TREE = [
  '- R1 <!--r11111-->',
  '    - __done__ a <!--aaaaaa-->',
  '        - a1 <!--a11111-->',
  '        - __important__ a2 <!--a22222-->',
  '    - P <!--pppppp-->',
  '        - __here__ H <!--hhhhhh-->',
  '            - h1 <!--h11111-->',
  '            - __done__ h2 <!--h22222-->',
  '                - h2x <!--h2x2x2-->',
  '        - sib <!--ssssss-->',
  '            - s1 <!--s11111-->',
  '            - __important__ s2 <!--s22222-->',
  '                - s2x <!--s2x2x2-->',
  '- R2 <!--r22222-->',
  '    - r2a <!--r2a2a2-->',
  '',
].join('\n')

const FULL = [
  '· R1',
  '│ ✓ a (+1)',
  '│ │ ★ a2',
  '│ · P',
  '│ │ ▶ H',
  '│ │ │ · h1',
  '│ │ │ ✓ h2 (+1)',
  '│ │ · sib (+2)',
  '│ │ │ ★ s2',
  '· R2 (+1)',
]

const texts = (r) => r.lines.map((l) => l.guide + l.text)

test('記号: here ▶、done ✓、abandoned ✗、important ★、印なし ·', () => {
  assert.deepEqual(SYMBOLS, { here: '▶', done: '✓', abandoned: '✗', important: '★', none: '·' })
})

test('selectRows: 根から here までの経路・兄弟・here の子を選び、done はたたむ', () => {
  const rows = selectRows(parseTree(TREE))
  assert.deepEqual(rows.map((r) => [r.id, r.role]), [
    ['r11111', 'path'],
    ['aaaaaa', 'sibling'],
    ['a22222', 'important'],
    ['pppppp', 'path'],
    ['hhhhhh', 'here'],
    ['h11111', 'here-child'],
    ['h22222', 'here-child'],
    ['ssssss', 'sibling'],
    ['s22222', 'important'],
    ['r22222', 'sibling'],
  ])
})

test('selectRows: たたみ線の (+N) は表示しなかった子孫の数（important は数えない）', () => {
  const rows = selectRows(parseTree(TREE))
  const hidden = Object.fromEntries(rows.map((r) => [r.id, r.hidden]))
  assert.equal(hidden.aaaaaa, 1) // a1 だけ。a2 は important として表示
  assert.equal(hidden.h22222, 1) // h2x
  assert.equal(hidden.ssssss, 2) // s1, s2x
  assert.equal(hidden.r22222, 1)
  assert.equal(hidden.h11111, 0)
})

test('layout: 全部収まるときの行', () => {
  const r = layout(parseTree(TREE), { bodyColumns: 80, bodyRows: 20 })
  assert.deepEqual(texts(r), FULL)
  assert.equal(r.omitted, 0)
})

test('layout: 字下げの縦線は 1 段 2 列の guide に分け、text には含めない', () => {
  const r = layout(parseTree(TREE), { bodyColumns: 80, bodyRows: 20 })
  const by = Object.fromEntries(r.lines.map((l) => [l.id, l]))
  assert.equal(by.r11111.guide, '')
  assert.equal(by.hhhhhh.guide, '│ │ ')
  assert.equal(by.hhhhhh.text, '▶ H')
})

test('layout: 幅は切り詰めない（Text の truncate-end に任せる）', () => {
  const doc = parseTree('- __here__ ' + 'あ'.repeat(100) + ' <!--aaaaaa-->\n')
  const r = layout(doc, { bodyColumns: 30, bodyRows: 5 })
  assert.equal(r.lines[0].text, '▶ ' + 'あ'.repeat(100))
})

test('layout: 行の装飾（here は bold green、done は dim、important は yellow）', () => {
  const r = layout(parseTree(TREE), { bodyColumns: 80, bodyRows: 20 })
  const by = Object.fromEntries(r.lines.map((l) => [l.id, l.style]))
  assert.deepEqual(by.hhhhhh, { bold: true, color: 'green' })
  assert.deepEqual(by.aaaaaa, { dimColor: true })
  assert.deepEqual(by.a22222, { color: 'yellow' })
  assert.deepEqual(by.pppppp, {})
})

test('layout: here なしなら最上位を並べる（子孫は (+N) に）', () => {
  const r = layout(parseTree('- A <!--aaaaaa-->\n    - a1 <!--a11111-->\n- B <!--bbbbbb-->\n'), { bodyColumns: 80, bodyRows: 20 })
  assert.deepEqual(texts(r), ['· A (+1)', '· B'])
  assert.equal(r.hereId, null)
})

test('layout: 空のツリー', () => {
  const r = layout(parseTree(''), { bodyColumns: 80, bodyRows: 20 })
  assert.deepEqual(r.lines, [])
  assert.equal(r.omitted, 0)
})

test('layout: bodyRows は見出し 1 行を含む。収まらなければ兄弟（here から遠い順）から落とす', () => {
  const r = layout(parseTree(TREE), { bodyColumns: 80, bodyRows: 8 })
  assert.equal(r.lines.length, 7)
  assert.equal(r.omitted, 3)
  const ids = r.lines.map((l) => l.id)
  for (const must of ['r11111', 'pppppp', 'hhhhhh', 'h11111', 'h22222']) assert.ok(ids.includes(must), must)
  assert.equal(ids.includes('r22222'), false) // 最も遠い兄弟
})

test('layout: 兄弟を落とすときは、その下の important 行も一緒に落とす', () => {
  const r = layout(parseTree(TREE), { bodyColumns: 80, bodyRows: 6 })
  const ids = r.lines.map((l) => l.id)
  assert.equal(ids.includes('aaaaaa') === ids.includes('a22222'), true)
  assert.equal(ids.includes('ssssss') === ids.includes('s22222'), true)
})

test('layout: 兄弟を全部落としても足りなければ here の子を末尾から落とす', () => {
  const r = layout(parseTree(TREE), { bodyColumns: 80, bodyRows: 5 })
  assert.deepEqual(texts(r), ['· R1', '│ · P', '│ │ ▶ H', '│ │ │ · h1'])
  assert.equal(r.omitted, 6)
})

test('layout: here の子の下の important は、here の子本体より先に落とす', () => {
  const doc = parseTree(
    [
      '- __here__ H <!--hhhhhh-->',
      '    - __done__ c1 <!--c11111-->',
      '        - __important__ c1x <!--c1x1x1-->',
      '    - c2 <!--c22222-->',
      '',
    ].join('\n'),
  )
  assert.deepEqual(texts(layout(doc, { bodyColumns: 80, bodyRows: 5 })), ['▶ H', '│ ✓ c1', '│ │ ★ c1x', '│ · c2'])
  assert.deepEqual(texts(layout(doc, { bodyColumns: 80, bodyRows: 4 })), ['▶ H', '│ ✓ c1', '│ · c2'])
})

test('layout: path と here は bodyRows が小さくても必ず残る', () => {
  const r = layout(parseTree(TREE), { bodyColumns: 80, bodyRows: 1 })
  assert.deepEqual(texts(r), ['· R1', '│ · P', '│ │ ▶ H'])
  assert.equal(r.omitted, 7)
})

test('layout: ノードを入力から変更しない', () => {
  const doc = parseTree(TREE)
  const snap = JSON.stringify(doc)
  layout(doc, { bodyColumns: 80, bodyRows: 3 })
  assert.equal(JSON.stringify(doc), snap)
})

test('path 上の done / abandoned の祖先はたたまず、here まで見える', () => {
  const doc = parseTree(
    [
      '- __done__ R <!--r11111-->',
      '    - __abandoned__ P <!--pppppp-->',
      '        - __here__ H <!--hhhhhh-->',
      '        - __done__ s <!--ssssss-->',
      '            - s1 <!--s11111-->',
      '',
    ].join('\n'),
  )
  assert.deepEqual(texts(layout(doc, { bodyColumns: 80, bodyRows: 20 })), ['✓ R', '│ ✗ P', '│ │ ▶ H', '│ │ ✓ s (+1)'])
})

test('here の子が done でなくても、子孫は隠して (+N) を出す', () => {
  const doc = parseTree(
    [
      '- __here__ H <!--hhhhhh-->',
      '    - c <!--c11111-->',
      '        - c1 <!--c1c1c1-->',
      '            - c1x <!--c1x1x1-->',
      '',
    ].join('\n'),
  )
  assert.deepEqual(texts(layout(doc, { bodyColumns: 80, bodyRows: 20 })), ['▶ H', '│ · c (+2)'])
})

test('here の子の下の important は、子の印にかかわらず常に表示（(+N) は残りの数）', () => {
  const doc = parseTree(
    [
      '- __here__ H <!--hhhhhh-->',
      '    - c <!--c11111-->',
      '        - c1 <!--c1c1c1-->',
      '            - __important__ c1x <!--c1x1x1-->',
      '',
    ].join('\n'),
  )
  assert.deepEqual(texts(layout(doc, { bodyColumns: 80, bodyRows: 20 })), ['▶ H', '│ · c (+1)', '│ │ │ ★ c1x'])
})

test('here の子の下の important は、here の子本体より先に落とす（未 done の子でも）', () => {
  const doc = parseTree(
    [
      '- __here__ H <!--hhhhhh-->',
      '    - c <!--c11111-->',
      '        - __important__ cx <!--cxcxcx-->',
      '    - d <!--d11111-->',
      '',
    ].join('\n'),
  )
  assert.deepEqual(texts(layout(doc, { bodyColumns: 80, bodyRows: 4 })), ['▶ H', '│ · c', '│ · d'])
})
