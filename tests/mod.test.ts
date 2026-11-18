// フック経由のテスト（`claude plugin test` で実行する。node では走らない）。
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'yak-tree', component: 'Pane', requestId: 'yak-tree',
  viewport: { columns: 100, rows: 30 },
  props: { title: 'yak-tree', isFocused: false, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

test('session.start registers /tree', async ($, on) => {
  const registered: string[] = []
  mock.store(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => { registered.push(e.name); return { value: undefined } })
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['tree'])
})

test('session.start falls back to /yak-tree when /tree is refused', async ($, on) => {
  const registered: string[] = []
  mock.store(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    if (e.name === 'tree') return { deny: 'a built-in has that name' }
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['tree', 'yak-tree'])
})

test('after falling back to /yak-tree, /tree is left to whoever owns it', async ($, on) => {
  const calls: string[] = []
  mock.store(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => (e.name === 'tree' ? { deny: 'another mod has that name' } : { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => { calls.push('open:' + e.id); return { value: { isPlaced: true } } })
  // /tree を持つ他の Mod の代わり。yak-tree が next に渡せばここに届く
  on('command.run', ($, e) => { calls.push('other:' + e.command); return {} })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'tree', args: '' } as any)
  expect(calls).toEqual(['other:tree'])
  await $.command.run({ command: 'yak-tree', args: '' } as any)
  expect(calls).toEqual(['other:tree', 'open:yak-tree'])
})

test('after falling back to /yak-tree, the toast for a bad argument names /yak-tree', async ($, on) => {
  const toasts: string[] = []
  mock.store(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => (e.name === 'tree' ? { deny: 'another mod has that name' } : { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'yak-tree', args: 'x' } as any)
  expect(toasts).toEqual(["unknown view 'x'; use /yak-tree e or /yak-tree a"])
})

test('a debug log that fails does not push /tree over to /yak-tree', async ($, on) => {
  const registered: string[] = []
  const calls: string[] = []
  mock.store(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => { registered.push(e.name); return { value: undefined } })
  on('ui.log', () => ({ deny: 'log is unavailable' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => { calls.push('open:' + e.id); return { value: { isPlaced: true } } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['tree'])
  await $.command.run({ command: 'tree', args: '' } as any)
  expect(calls).toEqual(['open:yak-tree'])
})

test('/tree opens the pane when it is not open', async ($, on) => {
  const calls: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => { calls.push('open:' + e.id); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { calls.push('close:' + e.id); return { value: undefined } })
  await $.command.run({ command: 'tree', args: '' } as any)
  expect(calls).toEqual(['open:yak-tree'])
})

test('/tree closes the pane when it is open', async ($, on) => {
  const calls: string[] = []
  on('ui.panes', () => ({ value: [{ id: 'yak-tree' }] }))
  on('ui.open', ($, e) => { calls.push('open:' + e.id); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { calls.push('close:' + e.id); return { value: undefined } })
  await $.command.run({ command: 'tree', args: '' } as any)
  expect(calls).toEqual(['close:yak-tree'])
})

test('the pane draws the sample tree with the design symbols and an English heading', async ($) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /sample tree/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ Empty the bag and go through everything/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ The usual hook/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /★ Found last week's receipt/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✗ Check the car/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^│ │ $/ })).toBeDefined()
  await ui.unmount()
})

test('the pane omits rows that do not fit and says so in the heading', async ($) => {
  const small = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 5 } } }
  const ui = await $.ui.mount({ ...small, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /▶ Empty the bag and go through everything/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /rows omitted/ })).toBeDefined()
  await ui.unmount()
})

test('/tree a changes the mode of an open pane and redraws; /tree with no args still toggles', async ($, on) => {
  const calls: string[] = []
  mock.store(on)
  on('ui.panes', () => ({ value: [{ id: 'yak-tree' }] }))
  on('ui.open', ($, e) => { calls.push('open:' + e.id); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { calls.push('close:' + e.id); return { value: undefined } })
  await $.command.run({ command: 'tree', args: 'a' } as any)
  expect(calls).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /mode: a/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◀ here/ })).toBeDefined()
  await ui.unmount()
})

test('/tree a saves the mode to $.store', async ($, on) => {
  const saved: Array<[string, unknown]> = []
  on('ui.panes', () => ({ value: [{ id: 'yak-tree' }] }))
  on('store.set', ($, e) => { saved.push([e.key, e.value]); return { value: undefined } })
  await $.command.run({ command: 'tree', args: 'a' } as any)
  expect(saved).toEqual([['view', 'a']])
})

test('/tree a still opens the pane when $.store.set throws', async ($, on) => {
  const calls: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('store.set', () => { throw new Error('store full') })
  on('ui.open', ($, e) => { calls.push('open:' + e.id); return { value: { isPlaced: true } } })
  await $.command.run({ command: 'tree', args: 'a' } as any)
  expect(calls).toEqual(['open:yak-tree'])
})

test('the mode saved in $.store is used after the next session.start', async ($, on) => {
  mock.store(on, { view: 'a' })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /mode: a/ })).toBeDefined()
  await ui.unmount()
})

test('a saved mode that is not e or a (including c) is ignored and the view default (e) is used', async ($, on) => {
  mock.store(on, { view: 'c' })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /mode: e/ })).toBeDefined()
  await ui.unmount()
})

test('/tree x shows a toast and changes nothing', async ($, on) => {
  const calls: string[] = []
  const toasts: string[] = []
  on('ui.panes', () => ({ value: [{ id: 'yak-tree' }] }))
  on('ui.open', ($, e) => { calls.push('open'); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { calls.push('close'); return { value: undefined } })
  on('store.set', () => { calls.push('store.set'); return { value: undefined } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  await $.command.run({ command: 'tree', args: 'x' } as any)
  expect(calls).toEqual([])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/unknown view/)
})

test('session.start still registers the clock and calls next when $.store.get throws', async ($, on) => {
  const registered: string[] = []
  on('store.get', () => { throw new Error('store broken') })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => { registered.push(e.name); return { value: undefined } })
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['tree'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /mode: e/ })).toBeDefined()
  await ui.unmount()
})


test('/tree c is treated like an invalid argument: a toast and nothing else', async ($, on) => {
  const calls: string[] = []
  const toasts: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => { calls.push('open'); return { value: { isPlaced: true } } })
  on('store.set', () => { calls.push('store.set'); return { value: undefined } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  await $.command.run({ command: 'tree', args: 'c' } as any)
  expect(calls).toEqual([])
  expect(toasts.length).toBe(1)
})

test('the heading shows the summary: important count and open count', async ($) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /★1 · open 4/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(\/tree e\|a\)/ })).toBeDefined()
  await ui.unmount()
})

// ---- P1: 実ファイルの定期確認（poll）と描画 ----

const HOME = '/home/u'
const BASE = `${HOME}/.claude/yak-tree`
const SESSION_FILE = `${BASE}/my-repo/sessions/sess-1.md`
const TREE_TEXT = ['- __done__ Read the spec <!--aaaaa1-->', '- __here__ Write the poll <!--bbbbb2-->', '    - Check mtime <!--ccccc3-->', ''].join('\n')

type World = {
  files: Map<string, { text: string; mtimeMs: number }>
  branch: string
  defaultBranch: string | null // origin/HEAD の指す先。null なら symbolic-ref が失敗する
  gitFails: boolean
  noRepo: boolean
  sessionFails: boolean
  statError: string | null // 入れると fs.stat がその理由で失敗する
  registered: string[]
  tools: string[] // tool.register で登録された名前
  counts: { stat: number; read: number; write: number; invalidate: number; git: number }
  logs: string[]
  now: number // fs.write が付ける mtimeMs（書くたびに進む）
  onRead: ((path: string) => void) | null // fs.read が答えた直後に呼ぶ（読んだ後の外部変更を作る）
  mvFails: boolean
  toolsRefused: boolean
  linked: string | null // このパスの stat が isLink: true を返す
  readGate: Promise<void> | null // 入れると fs.read がこれを待ってから答える（読んでいる最中を作る）
  onGated: (() => void) | null // fs.read が門で止まったときに呼ぶ
  hugeFile: string | null // このパスの stat が 4 MiB 超を返す
}

// poll に必要な $ の下の層（セッション、git、fs、時計）をメモリ上で用意する。スタブは最初の $ 呼び出しの前に登録する
// （userConfig の issueKeyPattern はテストから渡せないので、issue スコープの判定は scope.spec.ts で確かめる）
function setup(on: any, init: Partial<World> = {}, store: Record<string, unknown> = {}) {
  const w: World = { files: new Map(), branch: 'main', defaultBranch: 'main', gitFails: false, noRepo: false, sessionFails: false, statError: null, registered: [], tools: [], counts: { stat: 0, read: 0, write: 0, invalidate: 0, git: 0 }, logs: [], now: 5000, onRead: null, mvFails: false, toolsRefused: false, linked: null, readGate: null, onGated: null, hugeFile: null, ...init }
  mock.store(on, store)
  mock.env(on, { HOME })
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/w/my-repo' }))
  on('command.register', (_$: any, e: any) => { w.registered.push(e.name); return { value: undefined } })
  on('tool.register', (_$: any, e: any) => { if (w.toolsRefused) return { deny: 'tools are off' }; w.tools.push(e.name); return { value: undefined } })
  on('ui.log', (_$: any, e: any) => { w.logs.push(JSON.stringify(e)); return { value: undefined } })
  on('ui.invalidate', () => { w.counts.invalidate++; return { value: undefined } })
  on('session.id', () => { return w.sessionFails ? { deny: 'no session' } : { value: 'sess-1' } })
  on('session.cwd', () => ({ value: '/w/my-repo' }))
  on('session.repo', () => ({ value: w.noRepo ? null : { root: '/w/my-repo', remote: null, internal: false, name: null } }))
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv
    if (argv[0] === 'mv') {
      // mv -f <src> <dst>。メモリ上で移す
      if (w.mvFails) return { value: { exitCode: 1, stdout: '', stderr: 'mv: permission denied' } }
      const f = w.files.get(argv[2])
      if (!f) return { value: { exitCode: 1, stdout: '', stderr: 'mv: no such file' } }
      w.files.delete(argv[2])
      w.files.set(argv[3], f)
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    }
    if (argv[0] === 'rm') {
      w.files.delete(argv[2])
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    }
    w.counts.git++
    if (w.gitFails) return { deny: 'git is not available' }
    if (argv[1] === 'branch') return { value: { exitCode: 0, stdout: w.branch + '\n', stderr: '' } }
    if (argv[1] === 'symbolic-ref') {
      return w.defaultBranch === null
        ? { value: { exitCode: 128, stdout: '', stderr: 'fatal: no origin/HEAD' } }
        : { value: { exitCode: 0, stdout: `origin/${w.defaultBranch}\n`, stderr: '' } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })
  on('fs.stat', (_$: any, e: any) => {
    w.counts.stat++
    if (w.statError) return { deny: w.statError }
    if (w.hugeFile === e.path) return { value: { kind: 'file', size: 4 * 1024 * 1024 + 1, mtimeMs: 1, isLink: false } }
    const f = w.files.get(e.path)
    if (!f) return { deny: 'ENOENT' }
    return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: w.linked === e.path } }
  })
  on('fs.read', async (_$: any, e: any) => {
    w.counts.read++
    const f = w.files.get(e.path)
    if (w.readGate) { const g = w.readGate; w.readGate = null; w.onGated?.(); await g }
    const answer = f ? { value: f.text } : { deny: 'ENOENT' }
    w.onRead?.(e.path)
    return answer
  })
  on('fs.write', (_$: any, e: any) => {
    w.counts.write++
    w.files.set(e.path, { text: e.text, mtimeMs: ++w.now })
    return { value: undefined }
  })
  const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w/my-repo' })
  return { w, clock, start }
}

const pane = ($: any) => $.ui.mount({ ...PANE, surface: 'terminal' })

test('no tree file: the sample is shown with the sample heading', async ($, on) => {
  const { start } = setup(on)
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /sample tree \(no tree file yet\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ Empty the bag/ })).toBeDefined()
  await ui.unmount()
})

test('tree file present: its nodes are shown, not the sample, and no times appear', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /▶ Write the poll/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ Read the spec/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tree: this session/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /sample/ })).toEqual([])
  expect(await ui.findAll({ type: 'Text', text: /Empty the bag/ })).toEqual([])
  // 実ファイルには時刻がまだない。hh:mm も here の経過時間 (47m) も出さない
  expect(await ui.findAll({ type: 'Text', text: /\d\d:\d\d|\(\d+m\)/ })).toEqual([])
  await ui.unmount()
})

test('tree file present, mode a: the here marker has no elapsed time', async ($, on) => {
  const { w, start } = setup(on, {}, { view: 'a' })
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /^\s*◀ here$/ })).toBeDefined()
  await ui.unmount()
})

test('poll: a changed mtime reads the file once and redraws; the Pane shows the new content', async ($, on) => {
  const { w, clock, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const readsAtStart = w.counts.read
  const invalidatesAtStart = w.counts.invalidate
  w.files.set(SESSION_FILE, { text: TREE_TEXT + '- Edited by hand <!--ddddd4-->\n', mtimeMs: 2000 })
  await clock.advance(2000)
  expect(w.counts.read).toBe(readsAtStart + 1)
  expect(w.counts.invalidate).toBe(invalidatesAtStart + 1)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /· Edited by hand/ })).toBeDefined()
  await ui.unmount()
})

test('poll: an unchanged file is only stat-ed (no read, no write, no redraw)', async ($, on) => {
  const { w, clock, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const before = { ...w.counts }
  await clock.advance(2000)
  await clock.advance(2000)
  expect(w.counts.stat).toBe(before.stat + 2)
  expect(w.counts.read).toBe(before.read)
  expect(w.counts.write).toBe(0)
  expect(w.counts.invalidate).toBe(before.invalidate)
})

test('poll: a file that appears later replaces the sample; one that disappears brings it back', async ($, on) => {
  const { w, clock, start } = setup(on)
  await start($)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await clock.advance(2000)
  let ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /▶ Write the poll/ })).toBeDefined()
  await ui.unmount()
  w.files.delete(SESSION_FILE)
  await clock.advance(2000)
  ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /sample tree/ })).toBeDefined()
  await ui.unmount()
})

test('poll never writes, over many polls and edits', async ($, on) => {
  const { w, clock, start } = setup(on)
  await start($)
  for (let i = 0; i < 12; i++) {
    w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 + i })
    await clock.advance(2000)
  }
  expect(w.counts.write).toBe(0)
})

test('poll: a stat that fails for another reason than ENOENT is logged and keeps the last tree', async ($, on) => {
  const { w, clock, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  w.statError = 'EACCES: permission denied'
  await clock.advance(2000)
  expect(w.logs.some((l) => /EACCES/.test(l))).toBe(true)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /▶ Write the poll/ })).toBeDefined()
  await ui.unmount()
})

test('poll: calling session.start twice does not double the timer', async ($, on) => {
  const { w, clock, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  await start($)
  const before = w.counts.stat
  await clock.advance(2000)
  expect(w.counts.stat).toBe(before + 1)
})

test('scope: the default branch reads sessions/<id>.md', async ($, on) => {
  const { w, start } = setup(on, { branch: 'main' })
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /tree: this session/ })).toBeDefined()
  await ui.unmount()
})

test('scope: a branch that is not the default reads branches/<encoded>.md', async ($, on) => {
  const { w, start } = setup(on, { branch: 'feature/x' })
  w.files.set(`${BASE}/my-repo/branches/feature_2fx.md`, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /tree: feature\/x/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ Write the poll/ })).toBeDefined()
  await ui.unmount()
})

test('scope: origin/HEAD decides the default branch (develop is a session)', async ($, on) => {
  const { w, start } = setup(on, { branch: 'develop', defaultBranch: 'develop' })
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /tree: this session/ })).toBeDefined()
  await ui.unmount()
})

test('scope: without issueKeyPattern an issue-looking branch is a plain branch scope', async ($, on) => {
  const { w, start } = setup(on, { branch: 'PAD-196/read-tree' })
  w.files.set(`${BASE}/my-repo/PAD-196.md`, { text: TREE_TEXT, mtimeMs: 1000 })
  w.files.set(`${BASE}/my-repo/branches/PAD-196_2fread-tree.md`, { text: TREE_TEXT.replace('Write the poll', 'Branch tree'), mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /▶ Branch tree/ })).toBeDefined()
  await ui.unmount()
})

test('scope: a git failure falls back to the session scope', async ($, on) => {
  const { w, start } = setup(on, { gitFails: true })
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /tree: this session/ })).toBeDefined()
  await ui.unmount()
})

test('scope: a promoted name recorded in $.store for this session is read (read only)', async ($, on) => {
  const { w, start } = setup(on, { branch: 'main' }, { 'promoted:sess-1': 'auth-rewrite' })
  w.files.set(`${BASE}/my-repo/auth-rewrite.md`, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /tree: auth-rewrite/ })).toBeDefined()
  await ui.unmount()
})

test('scope: outside a git repository the tree lives under _nogit', async ($, on) => {
  const { w, start } = setup(on, { noRepo: true, gitFails: true })
  w.files.set(`${BASE}/_nogit/my-repo/sessions/sess-1.md`, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /▶ Write the poll/ })).toBeDefined()
  await ui.unmount()
})

test('scope: it is decided again every 5th poll (the branch changes under the Pane)', async ($, on) => {
  const { w, clock, start } = setup(on, { branch: 'main' })
  w.files.set(SESSION_FILE, { text: 'x\n', mtimeMs: 1 })
  w.files.set(`${BASE}/my-repo/branches/feature_2fx.md`, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const gitAtStart = w.counts.git
  w.branch = 'feature/x'
  for (let i = 0; i < 4; i++) await clock.advance(2000)
  expect(w.counts.git).toBe(gitAtStart) // 4 回目までは git を呼ばない
  await clock.advance(2000)
  expect(w.counts.git).toBeGreaterThan(gitAtStart)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /tree: feature\/x/ })).toBeDefined()
  await ui.unmount()
})

test('tree file present: ids that the sample has times for still show no times', async ($, on) => {
  const { w, start } = setup(on)
  // SAMPLE_TIMES のキーと同じ id。実ツリーにサンプルの時刻が漏れないこと
  w.files.set(SESSION_FILE, { text: '- __done__ First <!--k1h0a1-->\n- __here__ Second <!--k1h0a2-->\n', mtimeMs: 1000 })
  await start($)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /▶ Second/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /\d\d:\d\d|\(\d+m\)/ })).toEqual([])
  await ui.unmount()
})

test('scope: after the path changes, a file that cannot be stat-ed does not keep the old tree under the new heading', async ($, on) => {
  const { w, clock, start } = setup(on, { branch: 'main' })
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  w.branch = 'feature/x'
  w.statError = 'EACCES: permission denied'
  for (let i = 0; i < 5; i++) await clock.advance(2000)
  const ui = await pane($)
  expect(await ui.findAll({ type: 'Text', text: /Write the poll/ })).toEqual([])
  expect(await ui.findAll({ type: 'Text', text: /tree: feature\/x/ })).toEqual([])
  await ui.unmount()
})

test('scope: a new file with the same mtime and size as the old one is still read', async ($, on) => {
  const { w, clock, start } = setup(on, { branch: 'main' })
  w.files.set(SESSION_FILE, { text: '- __here__ Old one\n', mtimeMs: 1000 })
  w.files.set(`${BASE}/my-repo/branches/feature_2fx.md`, { text: '- __here__ New one\n', mtimeMs: 1000 })
  await start($)
  w.branch = 'feature/x'
  for (let i = 0; i < 5; i++) await clock.advance(2000)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /▶ New one/ })).toBeDefined()
  await ui.unmount()
})

test('session.start still registers /tree and shows the sample when the session lookups fail', async ($, on) => {
  const { w, start } = setup(on, { sessionFails: true })
  await start($)
  expect(w.registered).toEqual(['tree'])
  expect(w.logs.some((l) => /no session/.test(l))).toBe(true)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /sample tree/ })).toBeDefined()
  await ui.unmount()
})

// ---- P2: 専用ツールでツリーを書く ----

const T = (name: string) => `mcp__yak-tree__${name}`
const call = ($: any, name: string, args: Record<string, unknown> = {}) => $.tool.call({ tool: T(name), ...args } as any)
const fileText = (w: World, path = SESSION_FILE) => w.files.get(path)?.text
const idOf = (result: string) => /^ok \w+ ([0-9a-z]{6})$/m.exec(result)![1]
const tmpFiles = (w: World) => [...w.files.keys()].filter((p) => p.includes('/.tmp/'))

test('session.start registers the five tools', async ($, on) => {
  const { w, start } = setup(on)
  await start($)
  expect(w.tools).toEqual(['tree_add', 'tree_here', 'tree_mark', 'tree_edit', 'tree_read'])
})

test('a tool that cannot be registered does not stop /tree or the poll', async ($, on) => {
  const { w, start } = setup(on, { toolsRefused: true })
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  expect(w.registered).toEqual(['tree'])
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /▶ Write the poll/ })).toBeDefined()
  await ui.unmount()
})

test('tree_add creates the file when there is none, and the Pane shows the node', async ($, on) => {
  const { w, start } = setup(on)
  await start($)
  const r = await call($, 'tree_add', { text: 'Find the bug', here: true })
  const id = idOf(r.result)
  expect(r.result).toContain(`here: ${id}`)
  expect(r.result).toContain(SESSION_FILE)
  expect(fileText(w)).toBe(`- __here__ Find the bug <!--${id}-->\n`)
  expect(tmpFiles(w)).toEqual([])
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /▶ Find the bug/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tree: this session/ })).toBeDefined()
  await ui.unmount()
})

test('tree_add puts a child at the end of its parent and leaves here alone without here: true', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_add', { parent_id: 'bbbbb2', text: 'Compare size' })
  const id = idOf(r.result)
  expect(r.result).toContain('here: bbbbb2')
  expect(fileText(w)).toBe(TREE_TEXT + `    - Compare size <!--${id}-->\n`)
})

test('tree_here moves here and reports the previous one', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_here', { id: 'ccccc3' })
  expect(r.result).toContain('ok here ccccc3')
  expect(r.result).toContain('previous here: bbbbb2')
  expect(fileText(w)).toBe(['- __done__ Read the spec <!--aaaaa1-->', '- Write the poll <!--bbbbb2-->', '    - __here__ Check mtime <!--ccccc3-->', ''].join('\n'))
})

test('tree_here on a done node is refused with E_BAD_INPUT and writes nothing', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_here', { id: 'aaaaa1' })
  expect(r.deny).toMatch(/^E_BAD_INPUT: /)
  expect(w.counts.write).toBe(0)
})

test('tree_mark done on the here node moves here to the unmarked parent', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: ['- Parent <!--ppppp1-->', '    - __here__ Child <!--ccccc1-->', ''].join('\n'), mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_mark', { id: 'ccccc1', mark: 'done' })
  expect(r.result).toContain('ok mark ccccc1')
  expect(r.result).toContain('here moved to ppppp1')
  expect(fileText(w)).toBe(['- __here__ Parent <!--ppppp1-->', '    - __done__ Child <!--ccccc1-->', ''].join('\n'))
})

test('tree_mark done on an ancestor of here keeps here and adds a note', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const r0 = await call($, 'tree_here', { id: 'ccccc3' })
  expect(r0.result).toContain('ok here')
  const r = await call($, 'tree_mark', { id: 'bbbbb2', mark: 'done' })
  expect(r.result).toContain('here: ccccc3')
  expect(r.result).toMatch(/note: bbbbb2 is an ancestor of here/)
})

test('tree_mark with an unknown mark is E_BAD_INPUT; an unknown id is E_NOT_FOUND', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  expect((await call($, 'tree_mark', { id: 'aaaaa1', mark: 'here' })).deny).toMatch(/^E_BAD_INPUT: /)
  expect((await call($, 'tree_mark', { id: 'zzzzz9', mark: 'done' })).deny).toMatch(/^E_NOT_FOUND: .*tree_read/)
  expect((await call($, 'tree_here', {})).deny).toMatch(/^E_BAD_INPUT: /)
  expect(w.counts.write).toBe(0)
})

test('tree_edit replaces the text and keeps the mark and the id', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_edit', { id: 'aaaaa1', text: 'Read the spec twice' })
  expect(r.result).toContain('ok edit aaaaa1')
  expect(fileText(w)).toBe(TREE_TEXT.replace('Read the spec', 'Read the spec twice'))
  expect((await call($, 'tree_edit', { id: 'aaaaa1', text: 'two\nlines' })).deny).toMatch(/^E_BAD_INPUT: /)
})

test('tree_read returns the scope, the path, here and the whole file, and does not write a clean file', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_read')
  expect(r.result).toContain(`path: ${SESSION_FILE}`)
  expect(r.result).toContain('scope: session')
  expect(r.result).toContain('here: bbbbb2')
  expect(r.result).toContain(TREE_TEXT)
  expect(w.counts.write).toBe(0)
})

test('tree_read with no file says so and creates nothing', async ($, on) => {
  const { w, start } = setup(on)
  await start($)
  const r = await call($, 'tree_read')
  expect(r.result).toContain('here: none')
  expect(r.result).toMatch(/no tree file yet/)
  expect(w.counts.write).toBe(0)
  expect(w.files.size).toBe(0)
})

test('tree_read does not rewrite a hand-indented file whose ids are all present', async ($, on) => {
  const { w, start } = setup(on)
  const text = '- Top <!--ttttt1-->\n  - __here__ Two spaces <!--ttttt2-->\n'
  w.files.set(SESSION_FILE, { text, mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_read')
  expect(r.result).toContain(text)
  expect(w.counts.write).toBe(0)
})

test('ids last: tree_read writes the ids it hands out, so the next tree_here finds them', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: '- First line by hand\n- __here__ Second <!--sssss2-->\n', mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_read')
  const id = /- First line by hand <!--([0-9a-z]{6})-->/.exec(r.result)![1]
  expect(r.result).toMatch(/issues: 1/)
  expect(fileText(w)).toBe(`- First line by hand <!--${id}-->\n- __here__ Second <!--sssss2-->\n`)
  const r2 = await call($, 'tree_here', { id })
  expect(r2.result).toContain(`ok here ${id}`)
})

test('subagents: writes are refused with E_SUBAGENT; tree_read works but never writes', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: '- No id here\n', mtimeMs: 1000 })
  await start($)
  for (const [name, args] of [['tree_add', { text: 'x' }], ['tree_here', { id: 'a' }], ['tree_mark', { id: 'a', mark: 'done' }], ['tree_edit', { id: 'a', text: 'x' }]] as const) {
    const r = await call($, name, { ...args, agentId: 'agent-1' })
    expect(r.deny).toMatch(/^E_SUBAGENT: /)
  }
  const r = await call($, 'tree_read', { agentId: 'agent-1' })
  expect(r.result).toContain('No id here')
  expect(w.counts.write).toBe(0)
  expect(fileText(w)).toBe('- No id here\n')
})

test('two tree_add calls at once both land', async ($, on) => {
  const { w, start } = setup(on)
  await start($)
  const [a, b] = await Promise.all([call($, 'tree_add', { text: 'One' }), call($, 'tree_add', { text: 'Two' })])
  expect(fileText(w)).toBe(`- One <!--${idOf(a.result)}-->\n- Two <!--${idOf(b.result)}-->\n`)
  expect(tmpFiles(w)).toEqual([])
})

test('a poll during tree_add never sees a half-written tree, and ends with the new tree', async ($, on) => {
  const { w, clock, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const adding = call($, 'tree_add', { text: 'Added by the tool' })
  await clock.advance(2000)
  const r = await adding
  await clock.advance(2000)
  expect(fileText(w)).toBe(TREE_TEXT + `- Added by the tool <!--${idOf(r.result)}-->\n`)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /· Added by the tool/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ Write the poll/ })).toBeDefined()
  await ui.unmount()
})

test('an edit by hand between the read and the write is kept: the tool reads again', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  let edits = 0
  w.onRead = (path) => {
    if (path !== SESSION_FILE || edits > 0) return
    edits++
    w.files.set(SESSION_FILE, { text: TREE_TEXT + '- By hand <!--hhhhh1-->\n', mtimeMs: 2000 })
  }
  const r = await call($, 'tree_add', { text: 'By tool' })
  expect(fileText(w)).toBe(TREE_TEXT + '- By hand <!--hhhhh1-->\n' + `- By tool <!--${idOf(r.result)}-->\n`)
  expect(tmpFiles(w)).toEqual([])
})

test('a file that changes on every attempt ends in E_CONFLICT and keeps the hand edits', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  let edits = 0
  w.onRead = (path) => {
    if (path !== SESSION_FILE) return
    edits++
    w.files.set(SESSION_FILE, { text: TREE_TEXT + `- By hand ${edits} <!--hhhhh${edits}-->\n`, mtimeMs: 2000 + edits })
  }
  const r = await call($, 'tree_add', { text: 'By tool' })
  expect(r.deny).toMatch(/^E_CONFLICT: .*tree_read/)
  expect(edits).toBe(3)
  expect(fileText(w)).toBe(TREE_TEXT + '- By hand 3 <!--hhhhh3-->\n')
  expect(tmpFiles(w)).toEqual([])
})

test('a failed mv is E_IO with the path, and the tree file is untouched', async ($, on) => {
  const { w, start } = setup(on, { mvFails: true })
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_add', { text: 'x' })
  expect(r.deny).toMatch(/^E_IO: /)
  expect(r.deny).toContain(SESSION_FILE)
  expect(fileText(w)).toBe(TREE_TEXT)
  expect(tmpFiles(w)).toEqual([])
})

test('a tree file over 4 MiB is E_TOO_LARGE and is not read', async ($, on) => {
  const { w, start } = setup(on)
  await start($)
  w.hugeFile = SESSION_FILE
  const reads = w.counts.read
  const r = await call($, 'tree_add', { text: 'x' })
  expect(r.deny).toMatch(/^E_TOO_LARGE: /)
  expect(w.counts.read).toBe(reads)
})

test('the tools write to the branch tree on a branch', async ($, on) => {
  const { w, start } = setup(on, { branch: 'feature/x' })
  await start($)
  const r = await call($, 'tree_add', { text: 'On a branch', here: true })
  const path = `${BASE}/my-repo/branches/feature_2fx.md`
  expect(r.result).toContain(path)
  expect(fileText(w, path)).toBe(`- __here__ On a branch <!--${idOf(r.result)}-->\n`)
})

test('a tool call right after the branch changes writes to the new scope, not the cached one', async ($, on) => {
  const { w, start } = setup(on, { branch: 'main' })
  await start($)
  w.branch = 'feature/x'
  const r = await call($, 'tree_add', { text: 'After checkout' })
  expect(r.result).toContain(`${BASE}/my-repo/branches/feature_2fx.md`)
  expect(w.files.has(SESSION_FILE)).toBe(false)
})

test('text with a line separator (U+2028) is refused, so a node cannot vanish on the next read', async ($, on) => {
  const { w, start } = setup(on)
  await start($)
  expect((await call($, 'tree_add', { text: 'foo\u2028bar' })).deny).toMatch(/^E_BAD_INPUT: /)
  expect((await call($, 'tree_add', { text: 123 })).deny).toMatch(/^E_BAD_INPUT: text must be a string/)
  expect((await call($, 'tree_add', { text: 'a', here: 'true' })).deny).toMatch(/^E_BAD_INPUT: here must be/)
  expect(w.counts.write).toBe(0)
})

test('a CRLF file is read as a tree: ids from tree_read work, and a write keeps every node', async ($, on) => {
  const { w, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT.replaceAll('\n', '\r\n'), mtimeMs: 1000 })
  await start($)
  expect((await call($, 'tree_read')).result).toContain('here: bbbbb2')
  const r = await call($, 'tree_here', { id: 'ccccc3' })
  expect(r.result).toContain('ok here ccccc3')
  expect(fileText(w)).toBe(['- __done__ Read the spec <!--aaaaa1-->', '- Write the poll <!--bbbbb2-->', '    - __here__ Check mtime <!--ccccc3-->', ''].join('\n'))
})

test('a tree file that is a symbolic link is not written through', async ($, on) => {
  const { w, start } = setup(on, { linked: SESSION_FILE })
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  const r = await call($, 'tree_add', { text: 'x' })
  expect(r.deny).toMatch(/^E_IO: .*symbolic link/)
  expect(fileText(w)).toBe(TREE_TEXT)
  expect(w.counts.write).toBe(0)
})

test('a tool write redraws the Pane at once, and a poll read that was in flight does not put the old tree back', async ($, on) => {
  const { w, clock, start } = setup(on)
  w.files.set(SESSION_FILE, { text: TREE_TEXT, mtimeMs: 1000 })
  await start($)
  // 手の編集を poll が読みはじめ、読み終わる前にツールが書く
  w.files.set(SESSION_FILE, { text: TREE_TEXT + '- By hand <!--hhhhh1-->\n', mtimeMs: 2000 })
  let open!: () => void
  w.readGate = new Promise<void>((res) => { open = res })
  const gated = new Promise<void>((res) => { w.onGated = res })
  const polling = clock.advance(2000)
  await gated // poll の read が門で止まるまで待つ
  const invalidates = w.counts.invalidate
  const r = await call($, 'tree_add', { text: 'By tool' })
  expect(w.counts.invalidate).toBe(invalidates + 1)
  open()
  await polling
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /· By tool/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /· By hand/ })).toBeDefined()
  await ui.unmount()
  expect(r.result).toContain('ok add')
})

test('after a tool writes to a new scope, the Pane heading names that scope', async ($, on) => {
  const { w, start } = setup(on, { branch: 'main' })
  await start($)
  w.branch = 'feature/x'
  await call($, 'tree_add', { text: 'After checkout', here: true })
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /tree: feature\/x/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ After checkout/ })).toBeDefined()
  await ui.unmount()
})
