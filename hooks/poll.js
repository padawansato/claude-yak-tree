// 定期確認（設計書 §8.1）の判定に使う純関数。`$` は受け取らない。I/O は register.js 側。
import { t } from './i18n.js'

export const POLL_MS = 2000
// スコープの再判定（git の実行）は 5 回に 1 回、つまり 10 秒に 1 回
export const SCOPE_EVERY = 5

/** `$.fs.stat` の結果から変更検出用の印を作る。ファイルなし（stat が無い）は null。 */
export function signatureOf(stat) {
  return stat ? `${stat.mtimeMs}:${stat.size}` : null
}

/** stat が拒否された理由が「ファイルなし」か（ENOENT）。権限エラーなどは false。 */
export function isMissingError(err) {
  if (err && typeof err === 'object' && err.code === 'ENOENT') return true
  const msg = err && typeof err === 'object' ? err.message : err
  return typeof msg === 'string' && msg.includes('ENOENT')
}

/** n 回目の poll でスコープを判定し直すか。session.start での判定を 0 回目とみなし、そこでは重ねない。 */
export function shouldResolveScope(n) {
  return n > 0 && n % SCOPE_EVERY === 0
}

/** `git branch --show-current` の結果からブランチ名を取る。失敗・空（detached HEAD）は空文字（session スコープになる）。 */
export function gitBranchOf(result) {
  if (!result || result.exitCode !== 0) return ''
  return String(result.stdout ?? '').trim()
}

/** 見出しに出すスコープの短い名前。 */
export function scopeLabel(lang, scope) {
  if (scope.kind === 'issue' || scope.kind === 'named') return scope.name
  if (scope.kind === 'branch') return scope.branch
  return t(lang, 'scope.session')
}
