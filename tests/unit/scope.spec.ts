// scope.js の単体テスト（node:test）。設計書 §3、§12.3-5 に対応する。
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import {
  isValidName,
  assertValidName,
  issueFromBranch,
  repoNameFromRoot,
  defaultBranchFromSymbolicRef,
  isDefaultBranch,
  encodeBranchName,
  decodeBranchName,
  decideScope,
  scopePath,
  resolveScope,
} from '../../hooks/scope.js'

const BASE = '/home/u/.claude/yak-tree'
const JIRA = '^([A-Z][A-Z0-9]*-[0-9]+)(/|$)'

// ---- 名前 ----

for (const ok of ['PAD-193', 'my_tree', 'v1.2', 'a', 'A-b_c.d', 'x'.repeat(100)]) {
  test(`isValidName: ${ok.slice(0, 20)} は使える`, () => assert.equal(isValidName(ok), true))
}

for (const bad of ['', '.', '..', 'a/b', 'a\\b', '../x', 'a..b', '.hidden', '-x', 'a b', '日本語', 'x'.repeat(101), null, undefined, 5]) {
  test(`isValidName: ${JSON.stringify(bad)} は使えない`, () => {
    assert.equal(isValidName(bad), false)
    assert.throws(() => assertValidName(bad), { code: 'E_BAD_INPUT' })
  })
}

// ---- issueKeyPattern ----

test('issueFromBranch: パターン未設定なら常に null（既定値に特定の形を持たない）', () => {
  for (const p of [undefined, null, '']) assert.equal(issueFromBranch('PAD-193/design', p), null)
})

test('issueFromBranch: キャプチャがあれば 1 番目、無ければ一致全体', () => {
  assert.equal(issueFromBranch('PAD-193/design', JIRA), 'PAD-193')
  assert.equal(issueFromBranch('PAD-193', JIRA), 'PAD-193')
  assert.equal(issueFromBranch('feat/GH-12-fix', '(?<=/)GH-[0-9]+'), 'GH-12')
  assert.equal(issueFromBranch('ABC-9/x', '^[A-Z]+-[0-9]+'), 'ABC-9')
})

test('issueFromBranch: 一致しなければ null', () => {
  assert.equal(issueFromBranch('main', JIRA), null)
  assert.equal(issueFromBranch('feature/PAD-1', JIRA), null)
  assert.equal(issueFromBranch('', JIRA), null)
})

test('issueFromBranch: 不正な正規表現は未設定として扱う', () => {
  assert.equal(issueFromBranch('PAD-1', '([unclosed'), null)
})

test('issueFromBranch: 取り出した値がファイル名に使えなければ null', () => {
  assert.equal(issueFromBranch('a/b', '^(.*)$'), null)
  assert.equal(issueFromBranch('x', '^(.*)$'), 'x')
})

// ---- 既定ブランチ ----

test('defaultBranchFromSymbolicRef: origin/ を外す。取れなければ null', () => {
  assert.equal(defaultBranchFromSymbolicRef('origin/main\n'), 'main')
  assert.equal(defaultBranchFromSymbolicRef('origin/release/1.x'), 'release/1.x')
  assert.equal(defaultBranchFromSymbolicRef(''), null)
  assert.equal(defaultBranchFromSymbolicRef(undefined), null)
  assert.equal(defaultBranchFromSymbolicRef('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref'), null)
})

test('isDefaultBranch: origin/HEAD があればそれだけ、無ければ main と master', () => {
  assert.equal(isDefaultBranch('develop', 'develop'), true)
  assert.equal(isDefaultBranch('main', 'develop'), false)
  assert.equal(isDefaultBranch('main', null), true)
  assert.equal(isDefaultBranch('master', null), true)
  assert.equal(isDefaultBranch('develop', null), false)
})

// ---- ブランチ名のファイル名化 ----

test('encodeBranchName: / や _ を衝突しない形に置き換える', () => {
  assert.equal(encodeBranchName('feature/login'), 'feature_2flogin')
  assert.notEqual(encodeBranchName('a/b'), encodeBranchName('a__b'))
  assert.notEqual(encodeBranchName('a/b'), encodeBranchName('a_b'))
  assert.equal(encodeBranchName('release-1.2'), 'release-1.2')
})

test('encodeBranchName: 結果はファイル名に安全で、decode で戻り、（長さの上限内で）単射', () => {
  const names = ['a/b', 'a_2fb', 'a__b', 'a_b', '日本語/x', '.hidden', 'a b', 'x:y', 'a\\b', 'feature/PAD-1/x', 'UPPER', 'upper']
  const seen = new Set()
  for (const n of names) {
    const e = encodeBranchName(n)
    assert.match(e, /^[A-Za-z0-9._-]+$/, n)
    assert.equal(e.startsWith('.'), false, n)
    assert.equal(decodeBranchName(e), n)
    assert.equal(seen.has(e), false)
    seen.add(e)
  }
})

// ---- repo ----

test('repoNameFromRoot: basename（末尾スラッシュ可）', () => {
  assert.equal(repoNameFromRoot('/w/my-repo'), 'my-repo')
  assert.equal(repoNameFromRoot('/w/my-repo/'), 'my-repo')
})

// ---- スコープの決定順 ----

const ctx = (o) => ({
  branch: '',
  defaultBranch: null,
  issueKeyPattern: undefined,
  promoted: null,
  sessionId: 'S1',
  repoRoot: '/w/my-repo',
  cwd: '/w/my-repo',
  ...o,
})

test('1. issueKeyPattern が設定され、ブランチから取れたら issue', () => {
  const s = decideScope(ctx({ branch: 'PAD-193/design', issueKeyPattern: JIRA }))
  assert.equal(s.kind, 'issue')
  assert.equal(s.name, 'PAD-193')
})

test('1 が 2 に勝つ: ブランチから取れれば promoted より優先', () => {
  const s = decideScope(ctx({ branch: 'PAD-200/x', issueKeyPattern: JIRA, promoted: 'my-notes' }))
  assert.equal(s.kind, 'issue')
  assert.equal(s.name, 'PAD-200')
})

test('パターン未設定なら PAD-193/design でも issue にならずブランチツリー', () => {
  const s = decideScope(ctx({ branch: 'PAD-193/design' }))
  assert.equal(s.kind, 'branch')
  assert.equal(s.branch, 'PAD-193/design')
})

test('パターンが設定されていてもブランチから取れなければ次へ（main → session）', () => {
  assert.equal(decideScope(ctx({ branch: 'main', issueKeyPattern: JIRA })).kind, 'session')
  assert.equal(decideScope(ctx({ branch: 'topic', issueKeyPattern: JIRA })).kind, 'branch')
})

test('2. promote の記録があれば名前付きツリー（既定ブランチでも、他のブランチでも）', () => {
  assert.deepEqual(
    [decideScope(ctx({ branch: 'main', promoted: 'my-notes' })).kind, decideScope(ctx({ branch: 'topic', promoted: 'my-notes' })).kind],
    ['named', 'named'],
  )
  assert.equal(decideScope(ctx({ branch: 'main', promoted: 'my-notes' })).name, 'my-notes')
})

test('不正な promoted の記録は無視する', () => {
  assert.equal(decideScope(ctx({ branch: 'main', promoted: '../evil' })).kind, 'session')
  assert.equal(decideScope(ctx({ branch: 'topic', promoted: 'a/b' })).kind, 'branch')
})

test('3. 既定ブランチ以外のブランチならブランチツリー', () => {
  const s = decideScope(ctx({ branch: 'feature/login' }))
  assert.equal(s.kind, 'branch')
  assert.equal(s.branch, 'feature/login')
})

test('既定ブランチは origin/HEAD を優先、無ければ main / master', () => {
  assert.equal(decideScope(ctx({ branch: 'develop', defaultBranch: 'develop' })).kind, 'session')
  assert.equal(decideScope(ctx({ branch: 'main', defaultBranch: 'develop' })).kind, 'branch')
  assert.equal(decideScope(ctx({ branch: 'main' })).kind, 'session')
  assert.equal(decideScope(ctx({ branch: 'master' })).kind, 'session')
})

test('4. detached HEAD（ブランチ空）→ session', () => {
  assert.equal(decideScope(ctx({ branch: '' })).kind, 'session')
})

test('4. git 外（repo が null）→ session', () => {
  const s = decideScope(ctx({ repoRoot: null, cwd: '/tmp/x', branch: 'topic' }))
  assert.equal(s.kind, 'session')
  assert.equal(s.repo, null)
})

// ---- 保存パス ----

const p = (o) => scopePath(BASE, decideScope(ctx(o)))

test('scopePath: issue と名前付きは <repo>/<name>.md', () => {
  assert.equal(p({ branch: 'PAD-193/x', issueKeyPattern: JIRA }), `${BASE}/my-repo/PAD-193.md`)
  assert.equal(p({ branch: 'main', promoted: 'my-notes' }), `${BASE}/my-repo/my-notes.md`)
})

test('scopePath: ブランチツリーは <repo>/branches/<エンコード済み>.md', () => {
  assert.equal(p({ branch: 'feature/login' }), `${BASE}/my-repo/branches/feature_2flogin.md`)
})

test('scopePath: 異なるブランチは異なるパス', () => {
  assert.notEqual(p({ branch: 'a/b' }), p({ branch: 'a__b' }))
})

test('scopePath: session', () => {
  assert.equal(p({ branch: 'main' }), `${BASE}/my-repo/sessions/S1.md`)
})

test('scopePath: git 外の session は _nogit/<basename(cwd)>/sessions', () => {
  assert.equal(p({ repoRoot: null, cwd: '/tmp/work/' }), `${BASE}/_nogit/work/sessions/S1.md`)
})

test('scopePath: git 外の名前付きは _nogit/<name>.md', () => {
  assert.equal(p({ repoRoot: null, cwd: '/tmp/x', promoted: 'PAD-1' }), `${BASE}/_nogit/PAD-1.md`)
})

test('scopePath: 引き継いだ sessionPath があれば session はそのパス、他の種類では無視', () => {
  const sp = `${BASE}/my-repo/sessions/OLD.md`
  assert.equal(p({ branch: 'main', sessionId: 'S2', sessionPath: sp }), sp)
  assert.equal(p({ branch: 'topic', sessionPath: sp }), `${BASE}/my-repo/branches/topic.md`)
})

test('scopePath: base の末尾スラッシュは吸収する', () => {
  assert.equal(scopePath(BASE + '/', decideScope(ctx({ branch: 'main', promoted: 'n' }))), `${BASE}/my-repo/n.md`)
})

for (const bad of ['', '..', '.', 'a/b']) {
  test(`scopePath: パスに使えないセッション ID ${JSON.stringify(bad)} は拒否`, () => {
    assert.throws(() => p({ branch: 'main', sessionId: bad }), { code: 'E_BAD_INPUT' })
  })
}

// ---- resolveScope（純関数） ----

test('resolveScope: 入力だけから scope と path を返す（§11 の writeThrough 冒頭で呼ぶ）', () => {
  const r = resolveScope({ base: BASE, ...ctx({ branch: 'PAD-193/x', issueKeyPattern: JIRA }) })
  assert.equal(r.kind, 'issue')
  assert.equal(r.path, `${BASE}/my-repo/PAD-193.md`)
})

test('resolveScope: promote 直後（promoted が入った）は新パスになる', () => {
  const before = resolveScope({ base: BASE, ...ctx({ branch: 'main' }) })
  const after = resolveScope({ base: BASE, ...ctx({ branch: 'main', promoted: 'PAD-5' }) })
  assert.equal(before.path, `${BASE}/my-repo/sessions/S1.md`)
  assert.equal(after.path, `${BASE}/my-repo/PAD-5.md`)
})

test('resolveScope: 入力を変更しない', () => {
  const input = { base: BASE, ...ctx({ branch: 'main' }) }
  const snap = JSON.stringify(input)
  resolveScope(input)
  assert.equal(JSON.stringify(input), snap)
})

// ---- 長いブランチ名（200 バイトの上限） ----

const sha16 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)
const HASHED = /_h[0-9a-f]{16}$/

for (const n of [1, 199, 200]) {
  test(`encodeBranchName: 変換後 ${n} バイトはそのまま`, () => {
    const b = 'a'.repeat(n)
    assert.equal(encodeBranchName(b), b)
  })
}

for (const n of [201, 202, 500]) {
  test(`encodeBranchName: 変換後 ${n} バイトは先頭を切り詰め、元の名前の sha256 先頭 16 桁を付けて 200 バイトにする`, () => {
    const b = 'a'.repeat(n)
    const e = encodeBranchName(b)
    assert.equal(e.length, 200)
    assert.equal(e, 'a'.repeat(182) + '_h' + sha16(b))
  })
}

test('encodeBranchName: 変換後 200 バイトちょうどになる、エスケープを含む名前の境界', () => {
  // 'a' * 197 + '/'（_2f で 3 バイト）= 200
  assert.equal(encodeBranchName('a'.repeat(197) + '/').length, 200)
  assert.doesNotMatch(encodeBranchName('a'.repeat(197) + '/'), HASHED)
  // 'a' * 198 + '/' = 201
  assert.match(encodeBranchName('a'.repeat(198) + '/'), HASHED)
  assert.equal(encodeBranchName('a'.repeat(198) + '/').length, 200)
})

test('encodeBranchName: ASCII 以外の長い名前も 200 バイト以内で、安全な文字だけ', () => {
  const b = '日本語のブランチ名'.repeat(30)
  const e = encodeBranchName(b)
  assert.ok(e.length <= 200)
  assert.match(e, /^[A-Za-z0-9._-]+$/)
  assert.match(e, HASHED)
})

test('encodeBranchName: 先頭が同じ長い名前でもハッシュで区別される', () => {
  const base = 'feature/' + 'x'.repeat(300)
  assert.notEqual(encodeBranchName(base + '1'), encodeBranchName(base + '2'))
})

test('encodeBranchName: 切り詰めた結果は、切り詰めない名前の結果と衝突しない（_h の後ろは 16 進でない）', () => {
  // 切り詰め形は `_h` で終わる。エスケープは `_` + 16 進 2 桁なので、通常の変換結果に `_h` は現れない
  for (const b of ['a_h0123456789abcdef', '_h', 'x_hx', 'a'.repeat(150) + '_h0123456789abcdef']) {
    assert.doesNotMatch(encodeBranchName(b), /_h/)
  }
})

test('scopePath: 長いブランチ名でもファイル名は 255 バイト未満', () => {
  const s = decideScope(ctx({ branch: 'feature/' + 'あ'.repeat(200) }))
  const name = scopePath(BASE, s).split('/').at(-1)
  assert.ok(Buffer.byteLength(name) < 255)
})
