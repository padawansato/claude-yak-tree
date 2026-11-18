// views.js の単体テスト（node:test）。表示モード e / c / a の描き方。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTree } from '../../hooks/tree.js'
import { renderView, formatElapsed, parseModeArg, headingText, resolveMode, sampleTree, sampleMarkdown, summarize, summaryText, SAMPLE_TIMES } from '../../hooks/views.js'

// このテスト用の時刻（サンプルとは別の id）
const TIMES = { k3f9a2: '09:12', p0w1xd: '09:13', m8t2qa: '09:15', z51hhc: '09:20', '4tcq2p': '09:25', j4qaq2: '09:40', b6xav2: '10:02', dddd44: '09:50', ffff66: '09:22' }

const DOC = parseTree(
  [
    '- __done__ Gather requirements <!--k3f9a2-->',
    '    - __done__ Interview users <!--p0w1xd-->',
    '    - __important__ Must work offline <!--m8t2qa-->',
    '- Build the feature <!--z51hhc-->',
    '    - __done__ Set up the project <!--4tcq2p-->',
    '    - __here__ Write the parser <!--j4qaq2-->',
    '        - Handle tabs and spaces <!--b6xav2-->',
    '    - __abandoned__ Try a regex-only approach (too fragile) <!--dddd44-->',
    '- Ship it <!--ffff66-->',
    '',
  ].join('\n'),
)

// Box / Text の代わり。要素を { box, props, children } にして、あとで 1 行の文字列へ直す
const ui = {
  Box: (p: any) => ({ box: true, props: p, children: p.children ?? [] }),
  Text: (p: any) => ({ box: false, props: p, children: p.children ?? [] }),
}

/** 要素 1 つを文字列にする。flexGrow の子があれば width まで空白で埋め、右の子を右端に寄せる。 */
function dump(el: any, width: number): string[] {
  if (typeof el === 'string') return [el]
  if (!el.box) return [el.children.map((ch: any) => (typeof ch === 'string' ? ch : dump(ch, width).join(''))).join('')]
  if (el.props.flexDirection === 'column') {
    const inner = el.props.borderStyle ? width - 4 : width
    const lines = el.children.flatMap((c: any) => dump(c, inner))
    if (!el.props.borderStyle) return lines
    return ['╭' + '─'.repeat(width - 2) + '╮', ...lines.map((l: string) => '│ ' + l.padEnd(inner) + ' │'), '╰' + '─'.repeat(width - 2) + '╯']
  }
  const parts = el.children.map((c: any) => dump(c, width)[0])
  if (el.props.justifyContent === 'space-between' && parts.length === 2) {
    const gap = Math.max(1, width - parts[0].length - parts[1].length)
    return [parts[0] + ' '.repeat(gap) + parts[1]]
  }
  return [parts.join('')]
}

function render(mode: string, width = 60, lang = 'en') {
  return renderLines(DOC, mode, width, lang)
}

function renderLines(doc: any, mode: string, width = 60, lang = 'en', bodyRows?: number, times: any = TIMES) {
  const { elements } = renderView(mode, ui, doc, { bodyColumns: width, bodyRows, hereElapsedMs: 47 * 60_000, lang, times })
  return elements.flatMap((e: any) => dump(e, width))
}

test('formatElapsed は 47m と 1h05m の形', () => {
  assert.equal(formatElapsed(47 * 60_000), '47m')
  assert.equal(formatElapsed(65 * 60_000), '1h05m')
  assert.equal(formatElapsed(-5), '0m')
})

test('parseModeArg と見出し', () => {
  assert.equal(parseModeArg('a'), 'a')
  assert.equal(parseModeArg(' A '), 'a')
  assert.equal(parseModeArg('c'), null)
  assert.equal(parseModeArg(''), null)
  assert.equal(parseModeArg('x'), null)
  assert.equal(headingText('en', 'sample tree', 'e'), 'sample tree  mode: e  (/tree e|a)')
  assert.equal(headingText('ja', 'サンプル', 'a'), 'サンプル  表示: a  (/tree e|a)')
  // /yak-tree に逃がしたときは、その名前で案内する
  assert.equal(headingText('en', 'sample tree', 'e', undefined, 0, 'yak-tree'), 'sample tree  mode: e  (/yak-tree e|a)')
})

test('resolveMode: 保存値 → userConfig の view → e の順。c は e に落ちる', () => {
  assert.equal(resolveMode('a', 'e'), 'a')
  assert.equal(resolveMode(undefined, 'a'), 'a')
  assert.equal(resolveMode('x', 'a'), 'a')
  assert.equal(resolveMode('c', 'a'), 'a')
  assert.equal(resolveMode('c', 'c'), 'e')
  assert.equal(resolveMode(3, undefined), 'e')
  assert.equal(resolveMode(undefined, undefined), 'e')
})

test('a を日本語で描いても ◀ here は here のまま', () => {
  assert.ok(render('a', 60, 'ja').some((l) => /◀ here 47m/.test(l)))
})

test('e: here 行にアクセントと時刻と経過、path にも ▎', () => {
  const lines = render('e')
  const here = lines.find((l) => l.includes('▶ Write the parser'))!
  assert.match(here, /^▎ │ ▶ Write the parser\s+\(47m\) 09:40$/)
  assert.match(lines.find((l) => l.includes('Build the feature'))!, /^▎ · Build/)
  assert.match(lines.find((l) => l.includes('Gather'))!, /\(\+1\) 09:12$/)
})

test('a: ● here、◀ here 47m、枝のつなぎ方', () => {
  const lines = render('a')
  assert.match(lines.find((l) => l.includes('Write the parser'))!, /^ ├─● Write the parser\s+◀ here 47m\s+09:40$/)
  assert.match(lines.find((l) => l.includes('Gather'))!, /^ ◉ Gather requirements \(\+1\)/)
  assert.match(lines.find((l) => l.includes('Must work'))!, /^ └─★ Must work offline/)
  assert.match(lines.find((l) => l.includes('Build the feature'))!, /^ ◎ Build/)
  assert.match(lines.find((l) => l.includes('Handle tabs'))!, /^ │ └─○ Handle tabs and spaces\s+10:02$/)
  assert.match(lines.find((l) => l.includes('regex-only'))!, /^ └─✗ Try/)
  assert.match(lines.find((l) => l.includes('Set up'))!, /^ ├─◉ Set up/)
  assert.match(lines.find((l) => l.includes('Ship it'))!, /^ ○ Ship it/)
})

test('SAMPLE_TIMES の時刻は hh:mm', () => {
  for (const v of Object.values(SAMPLE_TIMES)) assert.match(v, /^\d\d:\d\d$/)
})

test('a: 落とした兄弟がいても、後ろに兄弟があった行は ├─ のまま', () => {
  const lines = renderLines(DOC, 'a', 60, 'en', 5)
  assert.ok(!lines.some((l) => l.includes('regex-only')))
  assert.match(lines.find((l) => l.includes('Write the parser'))!, /^ ├─● Write/)
  assert.match(lines.find((l) => l.includes('Handle tabs'))!, /^ │ └─○ Handle/)
})

test('a: たたんだ行の下の important は、所有者の行から出る枝として描く', () => {
  const doc = parseTree(
    ['- Root <!--r00001-->', '    - __here__ Here <!--h00001-->', '- Side <!--s00001-->', '    - Mid <!--m00001-->', '        - __important__ Deep star <!--i00001-->', '- Last <!--l00001-->', ''].join('\n'),
  )
  const lines = renderLines(doc, 'a')
  assert.match(lines.find((l) => l.includes('Deep star'))!, /^ └─★ Deep star/)
  assert.match(lines.find((l) => l.includes('Side'))!, /^ ○ Side/)
})

test('P0 のサンプル: 11 ノードすべてに時刻があり、here は本筋の枝の途中', () => {
  for (const lang of ['en', 'ja']) {
    const doc = sampleTree(lang)
    assert.equal(doc.nodes.length, 11)
    for (const n of doc.nodes) assert.ok(SAMPLE_TIMES[n.id as keyof typeof SAMPLE_TIMES], n.id)
    assert.equal(doc.nodes.find((n) => n.id === doc.here)!.depth, 1)
  }
})

test('P0 のサンプル: ja は日本語、en は英語', () => {
  assert.match(sampleMarkdown('ja'), /- __here__ かばんの中身を全部出して調べる/)
  assert.match(sampleMarkdown('en'), /- __here__ Empty the bag and go through everything/)
  assert.match(sampleMarkdown(undefined as any), /Find the house key/)
})

test('サンプル e: here 行、path の ▎、(+N)、important', () => {
  const lines = renderLines(sampleTree('ja'), 'e', 80, 'ja', undefined, SAMPLE_TIMES)
  assert.match(lines.find((l) => l.includes('▶ かばん'))!, /^▎ │ ▶ かばんの中身を全部出して調べる\s+\(47m\) 08:06$/)
  assert.match(lines.find((l) => l.includes('★ 先週'))!, /^  │ │ ★ 先週のレシート/)
  assert.ok(lines.some((l) => l.includes('▎ · 家の鍵を探す')))
})

test('サンプル a（ja）: path は ◎、here は ●、脇の枝', () => {
  const lines = renderLines(sampleTree('ja'), 'a', 80, 'ja', undefined, SAMPLE_TIMES)
  assert.match(lines.find((l) => l.includes('家の鍵を探す'))!, /^ ◎ 家の鍵/)
  assert.match(lines.find((l) => l.includes('かばんの中身'))!, /^ ├─● かばん.*◀ here 47m\s+08:06$/)
  assert.match(lines.find((l) => l.includes('内ポケット'))!, /^ │ ├─○ 内ポケット/)
  assert.match(lines.find((l) => l.includes('そもそも'))!, /^ │ └─○ そもそも/)
  assert.match(lines.find((l) => l.includes('車の中'))!, /^ └─✗ 車の中/)
})


test('summarize: ★ は important の数（ツリー全体）、open は印のないノードから here とその祖先を除いた数', () => {
  // DOC: important 1（Must work offline）。印なし: Build the feature（here の祖先）、Handle tabs、Ship it。祖先を除いて 2
  assert.deepEqual(summarize(DOC), { important: 1, open: 2 })
  assert.deepEqual(summarize(sampleTree('en')), { important: 1, open: 4 })
})

test('summarize: here がないときは印のないノードをすべて数える。何もなければ 0', () => {
  const noHere = parseTree(['- A <!--aaaaa1-->', '    - __important__ B <!--bbbbb2-->', '    - __done__ C <!--ccccc3-->', ''].join('\n'))
  assert.deepEqual(summarize(noHere), { important: 1, open: 1 })
  assert.deepEqual(summarize(parseTree('')), { important: 0, open: 0 })
})

test('summaryText: 0 は出さない。en と ja', () => {
  assert.equal(summaryText('en', { important: 1, open: 4 }), '★1 · open 4')
  assert.equal(summaryText('ja', { important: 1, open: 4 }), '★1 · 未着手 4')
  assert.equal(summaryText('en', { important: 0, open: 4 }), 'open 4')
  assert.equal(summaryText('en', { important: 2, open: 0 }), '★2')
  assert.equal(summaryText('en', { important: 0, open: 0 }), '')
})

test('見出し: 名前、要約、省略行数、モードの順', () => {
  assert.equal(headingText('en', 'sample tree', 'e', { important: 1, open: 4 }, 3), 'sample tree  ★1 · open 4 (+3 rows omitted)  mode: e  (/tree e|a)')
  assert.equal(headingText('ja', 'サンプル', 'a', { important: 0, open: 2 }, 0), 'サンプル  未着手 2  表示: a  (/tree e|a)')
})

test('実ファイルのツリー: times が空で hereElapsedMs が無ければ、時刻も経過時間も出ない（e）', () => {
  const { elements } = renderView('e', ui, DOC, { bodyColumns: 60, lang: 'en', times: {} })
  const lines = elements.flatMap((e: any) => dump(e, 60)).map((l: string) => l.replace(/\s+$/, ''))
  const here = lines.find((l: string) => l.includes('Write the parser'))!
  assert.match(here, /Write the parser$/)
  assert.ok(!lines.some((l: string) => /\d\d:\d\d|\(\d+m\)/.test(l)))
})

test('実ファイルのツリー: a は ◀ here だけで、経過時間も時刻も出ない', () => {
  const { elements } = renderView('a', ui, DOC, { bodyColumns: 60, lang: 'en', times: {} })
  const lines = elements.flatMap((e: any) => dump(e, 60)).map((l: string) => l.replace(/\s+$/, ''))
  assert.match(lines.find((l: string) => l.includes('Write the parser'))!, /Write the parser +◀ here$/)
  assert.ok(!lines.some((l: string) => /\d\d:\d\d|\d+m\b/.test(l)))
})

test('実ファイルのツリー: e の here 行にも経過時間が出ない', () => {
  const { elements } = renderView('e', ui, DOC, { bodyColumns: 60, lang: 'en', times: {} })
  const lines = elements.flatMap((e: any) => dump(e, 60))
  assert.ok(!lines.some((l: string) => /\(\d+m\)/.test(l)))
})
