// tree.js の単体テスト（node:test）。設計書 §4、§6、§12.3-1〜3 に対応する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTree,
  serializeTree,
  repairText,
  addNode,
  setHere,
  markNode,
  editNode,
  moveHereAfterClose,
  TreeError,
} from '../../hooks/tree.js'

const shape = (doc) => doc.nodes.map((n) => [n.text, n.depth])
const ID6 = /^[0-9a-z]{6}$/

// ---- 字下げ（H1） ----

const EXPECTED_SHAPE = [
  ['A', 0],
  ['B', 1],
  ['C', 2],
  ['D', 1],
  ['E', 0],
]

for (const [name, unit] of [
  ['2 スペース', '  '],
  ['3 スペース', '   '],
  ['4 スペース', '    '],
  ['タブ', '\t'],
]) {
  test(`字下げ: ${name}で同じ木になる`, () => {
    const src = ['- A', `${unit}- B`, `${unit}${unit}- C`, `${unit}- D`, '- E'].join('\n') + '\n'
    assert.deepEqual(shape(parseTree(src)), EXPECTED_SHAPE)
  })
}

test('字下げ: 混在（2 スペース、タブ、タブ+スペース）でも祖先との比較で木になる', () => {
  const src = ['- A', '  - B', '\t - C', '  - D', '- E'].join('\n') + '\n'
  // B: col2、C: タブで 4 → 5（B の子）、D: col2（B の兄弟）
  assert.deepEqual(shape(parseTree(src)), EXPECTED_SHAPE)
})

test('字下げ: 祖先より 2 段以上深くても子になり、indent-jump は報告しない', () => {
  const doc = parseTree('- A\n            - B\n')
  assert.deepEqual(shape(doc), [['A', 0], ['B', 1]])
  assert.equal(doc.issues.some((i) => i.kind === 'indent-jump'), false)
})

test('字下げ: どの祖先の列とも合わない浅い行は、列が自分より浅い最も近い祖先の子になる', () => {
  const doc = parseTree('- A\n    - B\n  - C\n')
  assert.deepEqual(shape(doc), [['A', 0], ['B', 1], ['C', 1]])
})

test('字下げ: 先頭のノードが字下げされていても深さ 0', () => {
  const doc = parseTree('    - A\n    - B\n        - C\n')
  assert.deepEqual(shape(doc), [['A', 0], ['B', 0], ['C', 1]])
})

test('parent は直近の浅いノードの id', () => {
  const doc = parseTree('- A <!--aaaaaa-->\n  - B <!--bbbbbb-->\n    - C <!--cccccc-->\n  - D <!--dddddd-->\n')
  assert.deepEqual(doc.nodes.map((n) => n.parent), [null, 'aaaaaa', 'bbbbbb', 'aaaaaa'])
})

// ---- 箇条書き記号・印 ----

test('* と + の箇条書きも - に正規化される', () => {
  const doc = parseTree('* A <!--aaaaaa-->\n+ B <!--bbbbbb-->\n')
  assert.equal(serializeTree(doc), '- A <!--aaaaaa-->\n- B <!--bbbbbb-->\n')
})

test('印は行頭の __印__ だけ。本文中の印は本文のまま', () => {
  const doc = parseTree('- __done__ X __important__ y <!--aaaaaa-->\n- plain __here__ <!--bbbbbb-->\n')
  assert.equal(doc.nodes[0].mark, 'done')
  assert.equal(doc.nodes[0].text, 'X __important__ y')
  assert.equal(doc.nodes[1].mark, null)
  assert.equal(doc.nodes[1].text, 'plain __here__')
  assert.equal(doc.here, null)
})

test('印が 2 つ並んでも最初の 1 つだけが印で、2 つ目は本文', () => {
  const doc = parseTree('- __done__ __important__ x <!--aaaaaa-->\n')
  assert.equal(doc.nodes[0].mark, 'done')
  assert.equal(doc.nodes[0].text, '__important__ x')
})

test('印だけで本文が空の行', () => {
  const doc = parseTree('- __here__ <!--aaaaaa-->\n')
  assert.equal(doc.nodes[0].mark, 'here')
  assert.equal(doc.nodes[0].text, '')
  const out = serializeTree(doc)
  assert.equal(serializeTree(parseTree(out)), out)
})

// ---- ID ----

test('ID: 空白なし 6 文字の既存 ID は保持され、issues なし', () => {
  const doc = parseTree('- A <!--k3f9a2-->\n')
  assert.equal(doc.nodes[0].id, 'k3f9a2')
  assert.deepEqual(doc.issues, [])
})

test('ID: 無い行には 6 文字の ID を採番し no-id を報告', () => {
  const doc = parseTree('- A\n- B <!--k3f9a2-->\n')
  assert.match(doc.nodes[0].id, ID6)
  assert.deepEqual(doc.issues.map((i) => [i.kind, i.line]), [['no-id', 1]])
})

for (const bad of ['<!-- k3f9a2 -->', '<!--k3f9a-->', '<!--k3f9a22-->', '<!--K3F9A2-->', '<!--k3f9a2 x-->']) {
  test(`ID: 形に合わないコメント ${bad} は本文の一部、新 ID を採番`, () => {
    const doc = parseTree(`- A ${bad}\n`)
    assert.equal(doc.nodes[0].text, `A ${bad}`)
    assert.match(doc.nodes[0].id, ID6)
    assert.equal(doc.issues[0].kind, 'no-id')
    // 書き出し後は ID が行末に付き、本文のコメントは残る
    const out = serializeTree(doc)
    assert.ok(out.startsWith(`- A ${bad} <!--`))
    assert.deepEqual(parseTree(out).issues, [])
  })
}

test('ID: 本文中の <!-- は行末の ID と混同されない', () => {
  const doc = parseTree('- 説明 <!-- メモ --> 続き <!--k3f9a2-->\n')
  assert.equal(doc.nodes[0].text, '説明 <!-- メモ --> 続き')
  assert.equal(doc.nodes[0].id, 'k3f9a2')
})

test('ID: 重複は後の行に新 ID、dup-id のみ報告（no-id と二重にしない）', () => {
  const doc = parseTree('- A <!--aaaaaa-->\n- B <!--aaaaaa-->\n')
  assert.equal(doc.nodes[0].id, 'aaaaaa')
  assert.match(doc.nodes[1].id, ID6)
  assert.notEqual(doc.nodes[1].id, 'aaaaaa')
  assert.deepEqual(doc.issues.map((i) => [i.kind, i.line]), [['dup-id', 2]])
})

test('ID: 採番した ID は互いに、既存 ID とも重複しない', () => {
  const lines = []
  for (let i = 0; i < 300; i++) lines.push('- x')
  lines.push('- y <!--aaaaaa-->')
  const doc = parseTree(lines.join('\n') + '\n')
  const ids = doc.nodes.map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, ID6)
})

test('ID: 乱数源を差し替えられる（衝突時は引き直す）', () => {
  const seq = ['aaaaaa', 'aaaaaa', 'bbbbbb']
  const doc = parseTree('- A <!--aaaaaa-->\n- B\n', { newId: (taken) => {
    for (;;) { const s = seq.shift(); if (!taken.has(s)) return s }
  } })
  assert.equal(doc.nodes[1].id, 'bbbbbb')
})

// ---- here ----

test('here: 複数あれば文書順で最後を採用、他は印なし、multi-here を報告', () => {
  const doc = parseTree('- __here__ A <!--aaaaaa-->\n- __here__ B <!--bbbbbb-->\n- __here__ C <!--cccccc-->\n')
  assert.equal(doc.here, 'cccccc')
  assert.deepEqual(doc.nodes.map((n) => n.mark), [null, null, 'here'])
  assert.deepEqual(doc.issues.map((i) => i.kind), ['multi-here'])
})

test('here: 無ければ null でエラーにしない', () => {
  const doc = parseTree('- A <!--aaaaaa-->\n')
  assert.equal(doc.here, null)
  assert.deepEqual(doc.issues, [])
})

// ---- 往復不変 ----

const CANONICAL = [
  '# PAD-193 yak-tree',
  '',
  'メモ。散文の行。   末尾の空白も保つ  ',
  '<!-- 先頭の HTML コメント -->',
  '- __done__ 要件の裏取り <!--k3f9a2-->',
  '    - __important__ サブエージェントから隠す手段は無い <!--m8t2qa-->',
  '',
  '  人間が書いたメモ（字下げ付きの散文）',
  '    <!-- ノード直後のコメント -->',
  '- 設計書を書く <!--z51hhc-->',
  '    ```js',
  '    - これはノードではない',
  '    * これも違う',
  '    ```',
  '    - __here__ Pane の描画規則 <!--j4qaq2-->',
  '~~~',
  '- チルダのフェンス内',
  '```',
  '- バッククォートではチルダのフェンスは閉じない',
  '~~~',
  '- git commit <!--ffff66-->',
  '最後の散文',
  '',
].join('\n')

test('往復: 散文・フェンス・HTML コメント・空行が 1 バイトも変わらない', () => {
  const doc = parseTree(CANONICAL)
  assert.deepEqual(doc.issues, [])
  assert.equal(serializeTree(doc), CANONICAL)
})

test('往復: フェンス内の - 行はノードにならない', () => {
  const doc = parseTree(CANONICAL)
  assert.deepEqual(doc.nodes.map((n) => n.text), [
    '要件の裏取り',
    'サブエージェントから隠す手段は無い',
    '設計書を書く',
    'Pane の描画規則',
    'git commit',
  ])
})

test('往復: 閉じられないフェンスは末尾まで散文', () => {
  const src = '- A <!--aaaaaa-->\n```\n- B\n- C\n'
  const doc = parseTree(src)
  assert.equal(doc.nodes.length, 1)
  assert.equal(serializeTree(doc), src)
})

test('往復: 先頭ノードより前の行は prelude に保持される', () => {
  const doc = parseTree('# 見出し\n\n- A <!--aaaaaa-->\n')
  assert.deepEqual(doc.prelude, ['# 見出し', ''])
})

test('往復: 付随行は直前ノードの trailing に位置ごと保持される', () => {
  const doc = parseTree('- A <!--aaaaaa-->\nメモ\n<!-- c -->\n- B <!--bbbbbb-->\n')
  assert.deepEqual(doc.nodes[0].trailing, ['メモ', '<!-- c -->'])
  assert.deepEqual(doc.nodes[1].trailing, [])
})

test('書き出し: 本文末尾の空白は落ち、末尾は改行 1 つ', () => {
  const out = serializeTree(parseTree('- A   \t <!--aaaaaa-->'))
  assert.equal(out, '- A <!--aaaaaa-->\n')
})

test('書き出し: 空のツリーは空文字', () => {
  assert.equal(serializeTree(parseTree('')), '')
})

test('書き出し: 字下げは 4 スペース／段に正規化される', () => {
  const out = serializeTree(parseTree('- A <!--aaaaaa-->\n\t- B <!--bbbbbb-->\n\t\t- C <!--cccccc-->\n'))
  assert.equal(out, '- A <!--aaaaaa-->\n    - B <!--bbbbbb-->\n        - C <!--cccccc-->\n')
})

// ---- 冪等性・修復 ----

const MESSY = [
  '# memo',
  '- A',
  '  - __here__ B <!--aaaaaa-->',
  '   - C <!--aaaaaa-->',
  '\t- __here__ D',
  '* E <!-- bad -->',
  '```',
  '- fenced',
  '```',
  '+ F <!--zzzzzz-->',
  '',
].join('\n')

test('冪等: serialize(parse(serialize(parse(x)))) === serialize(parse(x))', () => {
  const once = serializeTree(parseTree(MESSY))
  const twice = serializeTree(parseTree(once))
  assert.equal(twice, once)
})

test('修復: ID 欠落・重複・here 複数を直した後は issues が空で ID も安定', () => {
  const doc = parseTree(MESSY)
  const kinds = new Set(doc.issues.map((i) => i.kind))
  assert.ok(kinds.has('no-id') && kinds.has('dup-id') && kinds.has('multi-here'))
  const fixed = serializeTree(doc)
  const doc2 = parseTree(fixed)
  assert.deepEqual(doc2.issues, [])
  assert.deepEqual(doc2.nodes.map((n) => n.id), doc.nodes.map((n) => n.id))
  assert.equal(doc2.nodes.filter((n) => n.mark === 'here').length, 1)
  const ids = doc2.nodes.map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('repairText: 補正済み本文と issues、変更の有無を返す', () => {
  const r = repairText(MESSY)
  assert.equal(r.changed, true)
  assert.ok(r.issues.length > 0)
  assert.deepEqual(parseTree(r.text).issues, [])
  const r2 = repairText(r.text)
  assert.equal(r2.changed, false)
  assert.equal(r2.text, r.text)
})

test('repairText: 正規形の入力は changed: false で同一', () => {
  const r = repairText(CANONICAL)
  assert.equal(r.changed, false)
  assert.equal(r.text, CANONICAL)
})

// ---- 操作 ----

const BASE = [
  '# t',
  '- A <!--aaaaaa-->',
  '    - __done__ A1 <!--a1a1a1-->',
  '    - __here__ A2 <!--a2a2a2-->',
  '        - A2x <!--a2x2x2-->',
  'メモ（A2x の付随行）',
  '- B <!--bbbbbb-->',
  '',
].join('\n')

test('add: parent 省略は最上位の末尾（最後のノードの付随行の後ろ）', () => {
  const { doc, id } = addNode(parseTree(BASE), { text: 'C' })
  assert.match(id, ID6)
  assert.equal(serializeTree(doc), BASE + `- C <!--${id}-->\n`)
})

test('add: parent の子の末尾（最後の子孫の後ろ）に入る', () => {
  const { doc, id } = addNode(parseTree(BASE), { parentId: 'aaaaaa', text: 'A3' })
  assert.equal(
    serializeTree(doc),
    [
      '# t',
      '- A <!--aaaaaa-->',
      '    - __done__ A1 <!--a1a1a1-->',
      '    - __here__ A2 <!--a2a2a2-->',
      '        - A2x <!--a2x2x2-->',
      'メモ（A2x の付随行）',
      `    - A3 <!--${id}-->`,
      '- B <!--bbbbbb-->',
      '',
    ].join('\n'),
  )
})

test('add: here: true で here が新ノードに移り、旧 here の印は外れる', () => {
  const { doc, id } = addNode(parseTree(BASE), { parentId: 'a2a2a2', text: 'new', here: true })
  assert.equal(doc.here, id)
  assert.equal(doc.nodes.filter((n) => n.mark === 'here').length, 1)
  assert.equal(doc.nodes.find((n) => n.id === 'a2a2a2').mark, null)
})

test('add: ツリーが空でも prelude の後ろに入る', () => {
  const { doc, id } = addNode(parseTree('# t\n'), { text: 'X' })
  assert.equal(serializeTree(doc), `# t\n- X <!--${id}-->\n`)
})

test('add: 存在しない parent は E_NOT_FOUND', () => {
  assert.throws(() => addNode(parseTree(BASE), { parentId: 'nope00', text: 'x' }), { code: 'E_NOT_FOUND' })
})

for (const bad of ['', '   ', 'a\nb']) {
  test(`add: 不正な本文 ${JSON.stringify(bad)} は E_BAD_INPUT`, () => {
    assert.throws(() => addNode(parseTree(BASE), { text: bad }), { code: 'E_BAD_INPUT' })
  })
}

test('操作は入力の doc を変更しない', () => {
  const doc = parseTree(BASE)
  const before = serializeTree(doc)
  addNode(doc, { text: 'x', here: true })
  setHere(doc, 'bbbbbb')
  markNode(doc, 'bbbbbb', 'done')
  editNode(doc, 'bbbbbb', 'y')
  assert.equal(serializeTree(doc), before)
})

test('here 付け替え: 旧 here は印なし、新 here が 1 つ', () => {
  const { doc, previous } = setHere(parseTree(BASE), 'bbbbbb')
  assert.equal(previous, 'a2a2a2')
  assert.equal(doc.here, 'bbbbbb')
  assert.equal(doc.nodes.find((n) => n.id === 'a2a2a2').mark, null)
  assert.equal(doc.nodes.filter((n) => n.mark === 'here').length, 1)
})

test('here 付け替え: 存在しない id は E_NOT_FOUND', () => {
  assert.throws(() => setHere(parseTree(BASE), 'nope00'), { code: 'E_NOT_FOUND' })
})

test('mark: done / important / abandoned を置き換え、none で外す', () => {
  let doc = parseTree(BASE)
  doc = markNode(doc, 'bbbbbb', 'important').doc
  assert.equal(doc.nodes.find((n) => n.id === 'bbbbbb').mark, 'important')
  doc = markNode(doc, 'bbbbbb', 'abandoned').doc
  assert.equal(doc.nodes.find((n) => n.id === 'bbbbbb').mark, 'abandoned')
  doc = markNode(doc, 'a1a1a1', 'none').doc
  assert.equal(doc.nodes.find((n) => n.id === 'a1a1a1').mark, null)
})

test('mark: here のノードに important は E_BAD_INPUT', () => {
  assert.throws(() => markNode(parseTree(BASE), 'a2a2a2', 'important'), { code: 'E_BAD_INPUT' })
})

test('mark: here のノードに none は here を外すだけ（here なし）', () => {
  const { doc } = markNode(parseTree(BASE), 'a2a2a2', 'none')
  assert.equal(doc.here, null)
  assert.equal(doc.nodes.find((n) => n.id === 'a2a2a2').mark, null)
})

test('mark: 規定外の印は E_BAD_INPUT、here は指定できない', () => {
  assert.throws(() => markNode(parseTree(BASE), 'bbbbbb', 'here'), { code: 'E_BAD_INPUT' })
  assert.throws(() => markNode(parseTree(BASE), 'bbbbbb', 'x'), { code: 'E_BAD_INPUT' })
})

test('mark: 存在しない id は E_NOT_FOUND', () => {
  assert.throws(() => markNode(parseTree(BASE), 'nope00', 'done'), { code: 'E_NOT_FOUND' })
})

test('edit: 本文だけ置換し、印と ID は保持', () => {
  const { doc } = editNode(parseTree(BASE), 'a2a2a2', '書き換え')
  const n = doc.nodes.find((x) => x.id === 'a2a2a2')
  assert.equal(n.text, '書き換え')
  assert.equal(n.mark, 'here')
  assert.equal(doc.here, 'a2a2a2')
})

test('edit: 空・改行入りは E_BAD_INPUT、存在しない id は E_NOT_FOUND', () => {
  assert.throws(() => editNode(parseTree(BASE), 'a2a2a2', ''), { code: 'E_BAD_INPUT' })
  assert.throws(() => editNode(parseTree(BASE), 'a2a2a2', 'a\nb'), { code: 'E_BAD_INPUT' })
  assert.throws(() => editNode(parseTree(BASE), 'nope00', 'x'), { code: 'E_NOT_FOUND' })
})

test('ID の持続: 補正して書き出した後の ID でそのまま操作が通る（§12.3-4）', () => {
  const fixed = repairText('- A\n- B\n').text
  const doc = parseTree(fixed)
  const id = doc.nodes[1].id
  assert.doesNotThrow(() => setHere(doc, id))
})

// ---- here の自動移動（§6） ----

const T = (lines) => parseTree(lines.join('\n') + '\n')
const markOf = (doc, id) => doc.nodes.find((n) => n.id === id).mark

test('here を done にすると、印のない親へ here が移る', () => {
  const r = markNode(parseTree(BASE), 'a2a2a2', 'done')
  assert.equal(markOf(r.doc, 'a2a2a2'), 'done')
  assert.equal(r.doc.here, 'aaaaaa')
  assert.equal(markOf(r.doc, 'aaaaaa'), 'here')
  assert.equal(r.movedTo, 'aaaaaa')
  assert.equal(r.doc.nodes.filter((n) => n.mark === 'here').length, 1)
})

test('here を abandoned にしても同様に親へ移る', () => {
  const r = markNode(parseTree(BASE), 'a2a2a2', 'abandoned')
  assert.equal(markOf(r.doc, 'a2a2a2'), 'abandoned')
  assert.equal(r.doc.here, 'aaaaaa')
})

test('親が印付きなら、後ろの印なしの兄弟のうち最初のものへ（印付きの兄弟は飛ばす）', () => {
  const doc = T([
    '- __done__ P <!--pppppp-->',
    '    - before <!--bbbbbb-->',
    '    - __here__ x <!--xxxxxx-->',
    '    - __done__ y <!--yyyyyy-->',
    '    - z <!--zzzzzz-->',
    '    - w <!--wwwwww-->',
  ])
  const r = markNode(doc, 'xxxxxx', 'done')
  assert.equal(r.doc.here, 'zzzzzz')
  assert.equal(markOf(r.doc, 'pppppp'), 'done') // 親の印は消えない
  assert.equal(markOf(r.doc, 'yyyyyy'), 'done')
})

test('親が important でも here を置かない（印が消えるため）', () => {
  const doc = T([
    '- __important__ P <!--pppppp-->',
    '    - __here__ x <!--xxxxxx-->',
    '    - y <!--yyyyyy-->',
  ])
  const r = markNode(doc, 'xxxxxx', 'done')
  assert.equal(r.doc.here, 'yyyyyy')
  assert.equal(markOf(r.doc, 'pppppp'), 'important')
})

test('親も後続の兄弟も使えなければ、さらに上の最も近い印なしの祖先へ', () => {
  const doc = T([
    '- G <!--gggggg-->',
    '    - __done__ P <!--pppppp-->',
    '        - __here__ x <!--xxxxxx-->',
  ])
  assert.equal(markNode(doc, 'xxxxxx', 'done').doc.here, 'gggggg')
  const doc2 = T([
    '- G <!--gggggg-->',
    '    - __done__ M <!--mmmmmm-->',
    '        - __done__ P <!--pppppp-->',
    '            - __here__ x <!--xxxxxx-->',
  ])
  assert.equal(markNode(doc2, 'xxxxxx', 'done').doc.here, 'gggggg')
  const doc3 = T([
    '- G <!--gggggg-->',
    '    - M <!--mmmmmm-->',
    '        - __done__ P <!--pppppp-->',
    '            - __here__ x <!--xxxxxx-->',
  ])
  assert.equal(markNode(doc3, 'xxxxxx', 'done').doc.here, 'mmmmmm')
})

test('前の兄弟は候補にならない', () => {
  const doc = T([
    '- __done__ P <!--pppppp-->',
    '    - before <!--bbbbbb-->',
    '    - __here__ x <!--xxxxxx-->',
  ])
  const r = markNode(doc, 'xxxxxx', 'done')
  assert.equal(r.doc.here, null)
})

test('最上位の here は後ろの印なしの最上位へ。無ければ here なし', () => {
  const doc = T(['- __here__ R1 <!--r11111-->', '- __done__ R2 <!--r22222-->', '- R3 <!--r33333-->'])
  assert.equal(markNode(doc, 'r11111', 'done').doc.here, 'r33333')
  const doc2 = T(['- R0 <!--r00000-->', '- __here__ R1 <!--r11111-->', '- __abandoned__ R2 <!--r22222-->'])
  const r = markNode(doc2, 'r11111', 'done')
  assert.equal(r.doc.here, null)
  assert.equal(r.movedTo, null)
  assert.equal(r.doc.nodes.filter((n) => n.mark === 'here').length, 0)
})

test('moveHereAfterClose は here 以外のノードには E_BAD_INPUT', () => {
  assert.throws(() => moveHereAfterClose(parseTree(BASE), 'bbbbbb', 'done'), { code: 'E_BAD_INPUT' })
  assert.throws(() => moveHereAfterClose(parseTree(BASE), 'a2a2a2', 'important'), { code: 'E_BAD_INPUT' })
})

test('here の祖先を done/abandoned にしても here は動かず、注意を 1 行返す', () => {
  for (const mark of ['done', 'abandoned']) {
    const r = markNode(parseTree(BASE), 'aaaaaa', mark)
    assert.equal(markOf(r.doc, 'aaaaaa'), mark)
    assert.equal(r.doc.here, 'a2a2a2')
    assert.equal(r.movedTo, undefined)
    assert.deepEqual(r.note, { key: 'note.ancestorOfHere', params: { id: 'aaaaaa', here: 'a2a2a2' } })
  }
})

test('here と無関係のノードを done にしても note も移動もない', () => {
  const r = markNode(parseTree(BASE), 'bbbbbb', 'done')
  assert.equal(r.note, undefined)
  assert.equal(r.movedTo, undefined)
  assert.equal(r.doc.here, 'a2a2a2')
})

test('tree_here で印付きノードを指すと E_BAD_INPUT', () => {
  const doc = parseTree('- __done__ A <!--aaaaaa-->\n- __important__ B <!--bbbbbb-->\n- __abandoned__ C <!--cccccc-->\n')
  for (const id of ['aaaaaa', 'bbbbbb', 'cccccc']) {
    assert.throws(() => setHere(doc, id), (e) => e.code === 'E_BAD_INPUT' && /tree_mark/.test(e.message))
  }
})

// ---- 本文の検証（記法と衝突する本文は拒否） ----

for (const bad of [
  '__done__ x',
  '__here__ x',
  '__important__ x',
  '__abandoned__',
  '  __done__ x',
  'x <!--k3f9a2-->',
  'x <!-- メモ --> y',
  'a\r\nb',
]) {
  test(`本文 ${JSON.stringify(bad)} は add / edit とも E_BAD_INPUT`, () => {
    assert.throws(() => addNode(parseTree(BASE), { text: bad }), { code: 'E_BAD_INPUT' })
    assert.throws(() => editNode(parseTree(BASE), 'bbbbbb', bad), { code: 'E_BAD_INPUT' })
  })
}

test('`-->` を伴わない単独の <!-- は本文として受ける', () => {
  assert.doesNotThrow(() => addNode(parseTree(BASE), { text: 'x <!-- y' }))
})

test('本文中の印の語（先頭以外）は受け入れ、往復しても変わらない', () => {
  const { doc } = addNode(parseTree(BASE), { text: '説明 __done__ のこと' })
  const out = serializeTree(doc)
  assert.equal(serializeTree(parseTree(out)), out)
  assert.equal(parseTree(out).nodes.at(-1).mark, null)
})

test('TreeError は code・key・params を持つ Error。message は英語', () => {
  const e = new TreeError('E_NOT_FOUND', 'err.notFound', { id: 'abc123' })
  assert.ok(e instanceof Error)
  assert.equal(e.code, 'E_NOT_FOUND')
  assert.equal(e.key, 'err.notFound')
  assert.match(e.message, /^E_NOT_FOUND: id abc123 is not in the tree/)
})

test('parseTree: CRLF の行末でも同じ木になる', () => {
  const lf = '- __done__ A <!--aaaaa1-->\n    - __here__ B <!--bbbbb2-->\n'
  const a = parseTree(lf)
  const b = parseTree(lf.replaceAll('\n', '\r\n'))
  assert.deepEqual(b.nodes, a.nodes)
  assert.equal(b.issues.length, 0)
})

test('addNode: U+2028 / U+2029 を含む本文と、文字列でない本文は E_BAD_INPUT', () => {
  const doc = parseTree('')
  for (const text of ['a\u2028b', 'a\u2029b', 123, null]) {
    assert.throws(() => addNode(doc, { text }), (e) => e.code === 'E_BAD_INPUT')
  }
})
