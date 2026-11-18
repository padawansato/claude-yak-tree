// 唯一の hooks module。`$` の呼び出しはすべてここに置く（設計書 §2）。
// `/tree`（衝突時は `/yak-tree`）で Pane を開閉する。ツリーのファイルを 2 秒ごとに確認して描く（poll は読むだけ。P1）。
// ファイルがまだ無いときだけ、固定のサンプルツリーを描く。
// Claude は専用ツール（tree_add など）でツリーを書く（P2。設計書 §5、§11）。
import { resolveOptions } from './config.js'
import { t } from './i18n.js'
import { parseTree, serializeTree, addNode, setHere, markNode, editNode, newId, TreeError } from './tree.js'
import { resolveScope, defaultBranchFromSymbolicRef } from './scope.js'
import { POLL_MS, signatureOf, isMissingError, shouldResolveScope, gitBranchOf, scopeLabel } from './poll.js'
import { parseModeArg, resolveMode, headingText, renderView, sampleTree, summarize } from './views.js'

const PANE = 'yak-tree'

const STORE_KEY = 'view'
// command.run のマッチャにも同じ2つを直接書く（validate の静的解析が変数を読めないため）
const COMMANDS = ['tree', 'yak-tree']

// 登録できたコマンド名。/tree が断られて /yak-tree になったら、/tree は他の Mod のものなので受け取らない
let command = COMMANDS[0]

// 表示モード（e / a）。session.start で $.store の保存値か userConfig の view から決める
let mode = resolveMode(undefined, undefined)
// here になった時刻（仮の値。ファイル形式に時刻が入ったら差し替える）。module 読み込み時の 47 分前
const HERE_SINCE = Date.now() - 47 * 60_000

// ---- poll の状態（設計書 §8.2。module 変数。リロードで消えても次の poll で復元できる） ----
let timer = null // $.clock.every のタイマー。作り直す前に cancel する
let polling = false // 実行中フラグ。前回の poll が終わっていなければ重ねない
let pollCount = 0
let scope = null // resolveScope の結果（kind、path など）
let sig = undefined // 直前の (mtimeMs, size)。undefined は未確認、null はファイルなし
let tree = null // parse 済みのツリー。null ならファイルなし（サンプルを描く）
let sampleMinute = -1 // サンプルの here の経過時間を進めるため、最後に再描画した分

// ---- 書き込み（設計書 §11.1） ----
const MAX_BYTES = 4 * 1024 * 1024 // $.fs.read / $.fs.write の上限
const MAX_ATTEMPTS = 3 // 読んでから書くまでに外部変更があれば読み直す回数
let writeChain = Promise.resolve() // 書き込みを 1 件ずつ進めるためのキュー
let writeGen = 0 // ツールが書くたびに進む。途中で進んだら、poll は読みかけの結果を捨てる

// ツールの説明は Claude が読む。言語設定に関係なく英語（i18n.js の冒頭を参照）
const WHEN = 'The yak-tree is the outline of the current work that the user watches in a pane.'
const MAIN_ONLY = 'Writes are for the main conversation only; a subagent is refused.'
const IDS = 'Ids are the 6-character codes at the end of each line; call tree_read to see them.'
const TOOLS = [
  {
    name: 'tree_add',
    description: `${WHEN} Add a node. Call this when you break the work into steps, when you change approach, or when something worth keeping turns up. Without parent_id the node goes to the end of the top level; with it, to the end of that node's children. here: true also moves the here marker to the new node. Returns the new id. ${MAIN_ONLY} ${IDS}`,
    inputSchema: {
      type: 'object',
      properties: {
        parent_id: { type: 'string', description: 'id of the parent node; omit for the top level' },
        text: { type: 'string', description: 'one line of text' },
        here: { type: 'boolean', description: 'move the here marker to the new node' },
      },
      required: ['text'],
    },
  },
  {
    name: 'tree_here',
    description: `${WHEN} Move the here marker (the one node you are working on now) to the node with this id. Call it whenever you start on a different node. The node must have no mark. ${MAIN_ONLY} ${IDS}`,
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'tree_mark',
    description: `${WHEN} Set the mark of a node: done (finished), abandoned (a path you gave up; keep it as a record), important (always shown), or none (remove the mark). Call it when a step is finished or given up. Marking the here node done or abandoned moves here to a nearby unmarked node, and the result says where. ${MAIN_ONLY} ${IDS}`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, mark: { type: 'string', enum: ['done', 'important', 'abandoned', 'none'] } },
      required: ['id', 'mark'],
    },
  },
  {
    name: 'tree_edit',
    description: `${WHEN} Replace the text of a node. The mark and the id stay. ${MAIN_ONLY} ${IDS}`,
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string', description: 'one line of text' } }, required: ['id', 'text'] },
  },
  {
    name: 'tree_read',
    description: `${WHEN} Read the whole tree with its ids, its file path and where here is. Call it before the first write of a session and whenever an id is refused. Subagents may call it.`,
    inputSchema: { type: 'object', properties: {} },
  },
]

function errorDetail(err) {
  return err instanceof Error ? err.message : String(err)
}

function dirnameOf(path) {
  return path.slice(0, path.lastIndexOf('/'))
}

function isSameStat(a, b) {
  return signatureOf(a) === signatureOf(b)
}

/** 無ければ null。それ以外の失敗は E_IO。 */
async function statOrNull($, path) {
  try {
    return await $.fs.stat(path)
  } catch (err) {
    if (isMissingError(err)) return null
    throw new TreeError('E_IO', 'err.io', { path, detail: errorDetail(err) })
  }
}

async function removeTmp($, tmp) {
  try {
    await $.process.run(['rm', '-f', tmp]) // 一時ファイル 1 つだけを消す
  } catch {
    // 消せなくても続ける（.tmp に残るだけ）
  }
}

/** 書き込みを 1 件ずつ進める。前の件が失敗しても次は走る。 */
function enqueue(fn) {
  const p = writeChain.then(fn, fn)
  writeChain = p.catch(() => {})
  return p
}

/**
 * 設計書 §11.1。キューの中で呼ぶ。スコープを決め直し、ファイルを読み直して mutate し、tmp に書いて mv で置き換える。
 * 読んでから書くまでに外部変更があれば読み直す。mutate は `{ doc, write?: boolean, ...info }` を返す（write: false なら書かない）。
 * @returns {Promise<{ scope, text: string, written: boolean, doc, [k: string]: unknown }>}
 */
async function writeThrough($, cfg, mutate) {
  const sc = await lookupScope($, cfg)
  const path = sc.path
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await statOrNull($, path)
    if (before?.isLink) throw new TreeError('E_IO', 'err.isLink', { path }) // mv はリンクそのものを置き換えてしまう
    if (before && before.size > MAX_BYTES) throw new TreeError('E_TOO_LARGE', 'err.tooLarge', { path })
    let text = ''
    if (before) {
      try {
        text = await $.fs.read(path)
      } catch (err) {
        if (isMissingError(err)) continue // stat の後で消された。読み直す
        throw new TreeError('E_IO', 'err.io', { path, detail: errorDetail(err) })
      }
      if (typeof text !== 'string') throw new TreeError('E_IO', 'err.io', { path, detail: 'not a text file' })
    }
    const r = mutate(parseTree(text))
    const out = serializeTree(r.doc)
    if (r.write === false || out === text) return { ...r, scope: sc, text, written: false }
    if (new TextEncoder().encode(out).length > MAX_BYTES) throw new TreeError('E_TOO_LARGE', 'err.tooLarge', { path })
    // $.fs.write は原子的でないので、同じディレクトリの .tmp に書いてから mv で置き換える
    // 名前は乱数だけにする（ブランチ名は 200 バイトまであり、足すとファイル名の上限 255 バイトを超えうる）
    const tmp = `${dirnameOf(path)}/.tmp/${newId()}${newId()}.tmp`
    try {
      await $.fs.write(tmp, out)
    } catch (err) {
      throw new TreeError('E_IO', 'err.io', { path: tmp, detail: errorDetail(err) })
    }
    let now
    try {
      now = await statOrNull($, path)
    } catch (err) {
      await removeTmp($, tmp)
      throw err
    }
    if (!isSameStat(before, now)) {
      await removeTmp($, tmp) // 読んだ後に誰かが書いた。捨てて読み直す
      continue
    }
    let mv
    try {
      mv = await $.process.run(['mv', '-f', tmp, path])
    } catch (err) {
      mv = { exitCode: -1, stderr: errorDetail(err) }
    }
    if (mv.exitCode !== 0) {
      await removeTmp($, tmp)
      throw new TreeError('E_IO', 'err.io', { path, detail: String(mv.stderr ?? '').trim() || `mv exited with ${mv.exitCode}` })
    }
    // Pane をすぐ更新する。署名は未確認に戻し、次の poll にファイルを読み直させる
    // （mv の直後に人が保存した内容を、古い署名のせいで見落とさないため）
    writeGen++
    scope = sc
    tree = r.doc
    sig = undefined
    $.ui.invalidate('ui.render')
    return { ...r, scope: sc, text: out, written: true }
  }
  throw new TreeError('E_CONFLICT', 'err.conflict', { path })
}

function requireId(id) {
  if (typeof id !== 'string' || id === '') throw new TreeError('E_BAD_INPUT', 'err.missingId')
  return id
}

/** 成功時の結果。1 行目 `ok <op> <id>`、2 行目 here、3 行目パス、あとは補足（設計書 §5）。 */
function okText(op, id, r, extra = []) {
  return [`ok ${op} ${id}`, `here: ${r.doc.here ?? 'none'}`, r.scope.path, ...extra].join('\n')
}

/** ツール 1 回分。書き込み系はサブエージェントを断り、キューに入れて実行する。エラーは deny（Claude にエラー結果として届く）。 */
async function runTool($, cfg, e, { write, run }) {
  try {
    if (write && e.agentId) throw new TreeError('E_SUBAGENT', 'err.subagent')
    return { result: await enqueue(() => run()) }
  } catch (err) {
    if (err instanceof TreeError) return { deny: `${err.code}: ${t(cfg.language, err.key, err.params)}` }
    await logDebug($, `yak-tree: tool failed: ${errorDetail(err)}`)
    return { deny: `E_IO: ${errorDetail(err)}` }
  }
}

/** ツールのフックが投げた・時間切れになったときの答え。next に流さず、Claude にエラーとして返す。 */
async function toolFailed($, e, next) {
  return { deny: `E_IO: ${next?.error?.message ?? 'the yak-tree tool failed'}` }
}

async function logDebug($, msg) {
  try {
    await $.ui.log(msg, { to: 'debug' })
  } catch {
    // デバッグログが書けなくても続ける
  }
}

async function storeString($, key) {
  try {
    const v = await $.store.get(key)
    return typeof v === 'string' && v !== '' ? v : null
  } catch {
    return null // 読めなければ記録なしとして扱う
  }
}

async function runGit($, cwd, argv) {
  try {
    return await $.process.run(argv, { cwd })
  } catch {
    return undefined // git が無い、タイムアウトなどは失敗として扱う（空のブランチ＝ session スコープ）
  }
}

/** セッション ID・repo・cwd・git・store の記録から、いまのスコープとパスを決める（設計書 §3.2。読むだけ）。 */
async function lookupScope($, cfg) {
  const sessionId = await $.session.id()
  const repo = await $.session.repo()
  const cwd = await $.session.cwd()
  const home = await $.env.get('HOME')
  if (!home) throw new Error('HOME is not set')
  const branch = gitBranchOf(await runGit($, cwd, ['git', 'branch', '--show-current']))
  const ref = await runGit($, cwd, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  return resolveScope({
    base: `${home}/.claude/yak-tree`,
    branch,
    defaultBranch: ref?.exitCode === 0 ? defaultBranchFromSymbolicRef(ref.stdout) : null,
    issueKeyPattern: cfg.issueKeyPattern,
    promoted: await storeString($, `promoted:${sessionId}`),
    sessionId,
    repoRoot: repo?.root ?? null,
    cwd,
    sessionPath: await storeString($, `sessionPath:${sessionId}`),
  })
}

/** ファイルが変わっていれば読み直す。変わったら true。ファイルは書かない。 */
async function refreshTree($) {
  const gen = writeGen
  let stat = null
  try {
    stat = await $.fs.stat(scope.path)
  } catch (err) {
    if (!isMissingError(err)) throw err // 権限エラーなどは前回のツリーを残して呼び出し側で記録する
  }
  const next = signatureOf(stat)
  if (next === sig) return false
  let nextTree = null
  if (next !== null) {
    const text = await $.fs.read(scope.path)
    if (typeof text !== 'string') throw new Error('tree file is not text')
    nextTree = parseTree(text)
  }
  if (gen !== writeGen) return false // 読んでいるあいだにツールが書いた。古い内容で上書きしない
  tree = nextTree
  sig = next
  return true
}

/** 設計書 §8.1。first は session.start からの最初の 1 回（スコープも必ず判定する）。 */
async function poll($, cfg, first) {
  if (polling) return
  polling = true
  try {
    pollCount = first ? 0 : pollCount + 1
    if (first || shouldResolveScope(pollCount)) {
      const gen = writeGen
      const next = await lookupScope($, cfg)
      if (gen !== writeGen) return // 判定のあいだにツールが書いた。ツールが決めたスコープを残す
      if (next.path !== scope?.path) {
        // 別のファイルを指したら読み直す。読めるまでは前のファイルのツリーを新しい見出しで出さない
        sig = undefined
        tree = null
      }
      scope = next
    }
    let redraw = scope ? await refreshTree($) : false
    if (!tree) {
      // サンプルを描いているあいだは、here の経過時間が進む分（1 分ごと）に再描画する
      const minute = Math.floor((Date.now() - HERE_SINCE) / 60_000)
      if (minute !== sampleMinute) {
        sampleMinute = minute
        redraw = true
      }
    }
    if (redraw) $.ui.invalidate('ui.render')
  } catch (err) {
    await logDebug($, `yak-tree: poll failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    polling = false
  }
}

export function register(on, options) {
  const cfg = resolveOptions(options)
  // P0: 固定のサンプルツリー。language が ja なら日本語、それ以外は英語（本文は i18n.js）
  const SAMPLE = sampleTree(cfg.language)
  on('session.start', async ($, e, next) => {
    // try の中は登録と代入だけにする（ログの失敗で /yak-tree に逃がさないため）
    const description = t(cfg.language, 'cmd.description')
    try {
      await $.command.register({ name: COMMANDS[0], description, immediate: true })
      command = COMMANDS[0]
    } catch {
      try {
        await $.command.register({ name: COMMANDS[1], description, immediate: true })
        command = COMMANDS[1]
      } catch {
        command = null // どちらも登録できなければ、どのコマンドも受け取らない
      }
    }
    try {
      await $.ui.log(command ? `yak-tree: registered /${command}` : 'yak-tree: /tree and /yak-tree were both refused', { to: 'debug' })
    } catch {
      // デバッグログが書けなくても続ける
    }
    // ツールは 1 つずつ登録する。断られても /tree と poll は動かす
    for (const tool of TOOLS) {
      try {
        await $.tool.register(tool)
      } catch (err) {
        await logDebug($, `yak-tree: tool ${tool.name} was refused: ${errorDetail(err)}`)
      }
    }
    // 優先順位は $.store の保存値 → userConfig の view → e
    let stored
    try {
      stored = await $.store.get(STORE_KEY)
    } catch {
      stored = undefined // 読めなければ保存値なしとして扱う
    }
    mode = resolveMode(stored, cfg.view)
    // ファイルを 2 秒ごとに確認する。作り直す前に前のタイマーを止める（二重起動を避ける）
    try {
      timer?.cancel()
    } catch {
      // 止められなくても作り直す
    }
    await poll($, cfg, true)
    timer = $.clock.every(POLL_MS, () => poll($, cfg, false))
    return next(e)
  })

  on('command.run', { command: ['tree', 'yak-tree'] }, async ($, e, next) => {
    if (e.command !== command) return next(e)
    const panes = await $.ui.panes()
    const isOpen = panes.some((p) => p.id === PANE)
    const arg = String(e.args ?? '').trim()
    const wanted = parseModeArg(arg)
    if (arg !== '' && !wanted) {
      // 不正な引数は何も変えず toast で知らせる
      $.ui.toast(t(cfg.language, 'pane.unknownView', { value: arg, command }))
      return {}
    }
    if (wanted) {
      // 引数付き: 選んだモードを保存し、閉じていれば開き、開いていればモードだけ変えて再描画
      mode = wanted
      try {
        await $.store.set(STORE_KEY, wanted)
      } catch {
        // 保存に失敗しても、このセッションでは選んだモードで表示する（読み出し側の session.start と同じ扱い）
      }
      if (isOpen) $.ui.invalidate('ui.render')
      else await $.ui.open({ id: PANE, title: 'yak-tree', rows: 14 })
    } else if (isOpen) await $.ui.close({ id: PANE })
    else await $.ui.open({ id: PANE, title: 'yak-tree', rows: 14 })
    return {}
  })

  // ---- 専用ツール（設計書 §5）。マッチャは command.run と同じ理由で直接書く。next は呼ばない（許可プロンプトを出さない） ----
  on('tool.call', { tool: 'mcp__yak-tree__tree_add' }, ($, e) =>
    runTool($, cfg, e, {
      write: true,
      run: async () => {
        if (e.parent_id !== undefined && e.parent_id !== null && (typeof e.parent_id !== 'string' || e.parent_id === '')) {
          throw new TreeError('E_BAD_INPUT', 'err.badParent')
        }
        if (e.here !== undefined && e.here !== null && typeof e.here !== 'boolean') throw new TreeError('E_BAD_INPUT', 'err.badHere')
        const r = await writeThrough($, cfg, (doc) => addNode(doc, { parentId: e.parent_id, text: e.text, here: e.here === true }))
        return okText('add', r.id, r)
      },
    })).catch(toolFailed)

  on('tool.call', { tool: 'mcp__yak-tree__tree_here' }, ($, e) =>
    runTool($, cfg, e, {
      write: true,
      run: async () => {
        const id = requireId(e.id)
        const r = await writeThrough($, cfg, (doc) => setHere(doc, id))
        return okText('here', id, r, [`previous here: ${r.previous ?? 'none'}`])
      },
    })).catch(toolFailed)

  on('tool.call', { tool: 'mcp__yak-tree__tree_mark' }, ($, e) =>
    runTool($, cfg, e, {
      write: true,
      run: async () => {
        const id = requireId(e.id)
        const r = await writeThrough($, cfg, (doc) => markNode(doc, id, e.mark))
        const extra = []
        if (r.movedTo) extra.push(`here moved to ${r.movedTo}`)
        if (r.note) extra.push(t(cfg.language, r.note.key, r.note.params))
        return okText('mark', id, r, extra)
      },
    })).catch(toolFailed)

  on('tool.call', { tool: 'mcp__yak-tree__tree_edit' }, ($, e) =>
    runTool($, cfg, e, {
      write: true,
      run: async () => {
        const id = requireId(e.id)
        const r = await writeThrough($, cfg, (doc) => editNode(doc, id, e.text))
        return okText('edit', id, r)
      },
    })).catch(toolFailed)

  on('tool.call', { tool: 'mcp__yak-tree__tree_read' }, ($, e) =>
    runTool($, cfg, e, {
      write: false,
      run: async () => {
        // ID を補ったときだけ書き戻す（返した ID を次の呼び出しでも有効にする。§4.4）。字下げだけの違いでは書かない。
        // サブエージェントからは読むだけ
        const r = await writeThrough($, cfg, (doc) => ({ doc, write: !e.agentId && doc.issues.length > 0 }))
        const sc = r.scope
        const head = [`scope: ${sc.kind}${sc.kind === 'session' ? '' : ' ' + scopeLabel(cfg.language, sc)}`, `path: ${sc.path}`, `here: ${r.doc.here ?? 'none'}`]
        if (r.doc.issues.length > 0) head.push(t(cfg.language, 'tool.issues', { n: r.doc.issues.length }))
        // 書き戻さなかったときも、ID を補った形で返す（サブエージェントに見せる ID は次の呼び出しまで持たない）
        const body = r.doc.nodes.length === 0 && r.text === '' ? t(cfg.language, 'tool.noFile') : r.doc.issues.length > 0 ? serializeTree(r.doc) : r.text
        return [...head, '---', body].join('\n')
      },
    })).catch(toolFailed)

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // ファイルがあればそのツリー（時刻と here の経過時間はまだ無い）、無ければサンプル
    const real = tree !== null
    const doc = real ? tree : SAMPLE
    const { elements: body, omitted } = renderView(mode, { Box, Text }, doc, {
      bodyColumns: e.props.bodyColumns,
      bodyRows: e.props.scroll?.bodyRows,
      lang: cfg.language,
      ...(real ? { times: {} } : { hereElapsedMs: Date.now() - HERE_SINCE }),
    })
    const base = real ? t(cfg.language, 'pane.treeHeading', { label: scopeLabel(cfg.language, scope) }) : t(cfg.language, 'pane.sampleHeading')
    const heading = headingText(cfg.language, base, mode, summarize(doc), omitted, command ?? COMMANDS[0])
    const rows = [Text({ key: 'heading', wrap: 'truncate-end', dimColor: true, children: [heading] }), ...body]
    return Box({ flexDirection: 'column', width: e.props.bodyColumns, children: rows })
  })
}
