// スコープ決定の純関数（設計書 §3）。`$` は受け取らない。I/O は register.js 側。
import { TreeError } from './tree.js'
import { sha256Hex } from './hash.js'

// ツリー名（名前付きツリーと issue キー）。ファイル名に使うので文字を絞る
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export function isValidName(s) {
  return typeof s === 'string' && NAME_RE.test(s) && !s.includes('..')
}

export function assertValidName(s) {
  if (!isValidName(s)) throw new TreeError('E_BAD_INPUT', 'err.badName', { value: JSON.stringify(s) })
  return s
}

function compilePattern(src) {
  if (typeof src !== 'string' || src === '') return null
  try {
    return new RegExp(src)
  } catch {
    return null
  }
}

/**
 * userConfig の issueKeyPattern でブランチ名から issue キーを取り出す。
 * キャプチャグループがあれば 1 番目、無ければ一致全体。未設定・不正な正規表現・取り出した値が名前に使えない場合は null。
 */
export function issueFromBranch(branch, pattern) {
  const re = compilePattern(pattern)
  if (!re || !branch) return null
  const m = re.exec(branch)
  if (!m) return null
  const key = m[1] ?? m[0]
  return isValidName(key) ? key : null
}

/** `git symbolic-ref --short refs/remotes/origin/HEAD` の出力（`origin/main`）から既定ブランチ名を取る。取れなければ null。 */
export function defaultBranchFromSymbolicRef(stdout) {
  const s = String(stdout ?? '').trim()
  if (!s.startsWith('origin/') || /\s/.test(s)) return null
  return s.slice('origin/'.length) || null
}

/** origin/HEAD から取れた既定ブランチがあればそれ。無ければ main と master を既定ブランチとみなす。 */
export function isDefaultBranch(branch, defaultBranch) {
  return defaultBranch ? branch === defaultBranch : branch === 'main' || branch === 'master'
}

const MAX_ENCODED_BYTES = 200
const HASH_DIGITS = 16

/**
 * ブランチ名をファイル名に安全で、衝突しない形にする。
 * 英数字・`-`・先頭以外の `.` はそのまま、それ以外（`/`、`_`、日本語など）は UTF-8 の各バイトを `_xx`（小文字 16 進）にする。
 * 変換後が 200 バイトを超えたら、先頭 182 文字に `_h` と元のブランチ名の SHA-256 先頭 16 桁を付けて 200 バイトにする
 * （ファイル名の上限 255 バイトに `.md` を足しても収める）。`_h` は通常の変換結果に現れない
 * （`_` の後ろは 16 進 2 桁で、`h` は 16 進でない）ので、切り詰めた名前が切り詰めない名前と衝突することはない。
 * したがって変換は、200 バイトの上限内では単射で、超えた分はハッシュが衝突しない限り区別される。
 * 切り詰めた名前は decodeBranchName で元に戻せない。
 */
export function encodeBranchName(branch) {
  let out = ''
  let first = true
  for (const ch of String(branch)) {
    if (/[A-Za-z0-9-]/.test(ch) || (ch === '.' && !first)) out += ch
    else for (const b of new TextEncoder().encode(ch)) out += '_' + b.toString(16).padStart(2, '0')
    first = false
  }
  if (out.length <= MAX_ENCODED_BYTES) return out
  const suffix = '_h' + sha256Hex(String(branch)).slice(0, HASH_DIGITS)
  return out.slice(0, MAX_ENCODED_BYTES - suffix.length) + suffix
}

export function decodeBranchName(encoded) {
  const bytes = []
  for (let i = 0; i < encoded.length; ) {
    if (encoded[i] === '_') {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16))
      i += 3
    } else {
      bytes.push(...new TextEncoder().encode(encoded[i]))
      i += 1
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

function basename(p) {
  const parts = String(p).split('/').filter((s) => s !== '')
  return parts.at(-1) ?? ''
}

export function repoNameFromRoot(root) {
  return basename(root)
}

/**
 * スコープの決定順（§3.2）:
 *  1. issueKeyPattern が設定され、ブランチ名から取れた → issue
 *  2. このセッションに promote の記録がある → named
 *  3. 既定ブランチ以外のブランチ → branch
 *  4. それ以外（既定ブランチ、detached HEAD、git 外）→ session
 * sessionPath は /clear 等で引き継いだ session ファイルの絶対パス（無ければ既定パス）。
 * @param {{ branch: string, defaultBranch?: string | null, issueKeyPattern?: string, promoted: string | null, sessionId: string, repoRoot: string | null, cwd: string, sessionPath?: string | null }} c
 */
export function decideScope({ branch, defaultBranch = null, issueKeyPattern, promoted, sessionId, repoRoot, cwd, sessionPath = null }) {
  const base = { sessionId, repo: repoRoot ? repoNameFromRoot(repoRoot) : null, cwd }
  const key = issueFromBranch(branch, issueKeyPattern)
  if (key) return { kind: 'issue', name: key, ...base }
  if (isValidName(promoted)) return { kind: 'named', name: promoted, ...base }
  if (branch && base.repo !== null && !isDefaultBranch(branch, defaultBranch)) return { kind: 'branch', branch, ...base }
  return { kind: 'session', ...base, sessionPath }
}

function safeSegment(s, what) {
  if (typeof s !== 'string' || s === '' || s === '.' || s === '..' || s.includes('/')) {
    throw new TreeError('E_BAD_INPUT', 'err.unsafeSegment', { what, value: JSON.stringify(s) })
  }
  return s
}

/** 保存パス（§3.1）。base は絶対パス（呼び出し側が HOME から組み立てる）。 */
export function scopePath(base, scope) {
  const b = base.replace(/\/+$/, '')
  if (scope.kind === 'session' && scope.sessionPath) return scope.sessionPath
  if (scope.repo === null) {
    // git 外: 名前付きは _nogit/<name>.md、session は _nogit/<basename(cwd)>/sessions/<id>.md
    if (scope.kind === 'issue' || scope.kind === 'named') return `${b}/_nogit/${safeSegment(scope.name, 'name')}.md`
    return `${b}/_nogit/${safeSegment(basename(scope.cwd), 'cwd basename')}/sessions/${safeSegment(scope.sessionId, 'session id')}.md`
  }
  const repo = safeSegment(scope.repo, 'repo')
  if (scope.kind === 'issue' || scope.kind === 'named') return `${b}/${repo}/${safeSegment(scope.name, 'name')}.md`
  if (scope.kind === 'branch') return `${b}/${repo}/branches/${encodeBranchName(scope.branch)}.md`
  return `${b}/${repo}/sessions/${safeSegment(scope.sessionId, 'session id')}.md`
}

/**
 * 入力（git ブランチ、既定ブランチ、設定、store の promoted / sessionPath、セッション ID、repo、cwd、base）から scope と path を決める純関数。
 * 値の取得（`$.session.*`、git、`$.store.get`）は register.js の責務。
 * 呼び出しは writeThrough の冒頭、つまり書き込みキューの中で行う（§3.2、§11.1）。
 */
export function resolveScope({ base, ...input }) {
  const scope = decideScope(input)
  return { ...scope, path: scopePath(base, scope) }
}
