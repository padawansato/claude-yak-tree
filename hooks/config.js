// userConfig の値（`register(on, options)` の options）を読む純関数。
// 宣言は .claude-plugin/plugin.json。未設定のキーは options に無い（推測）ので、欠けていても既定値に落とす。
import { normalizeLanguage } from './i18n.js'

export const DEFAULT_WARN_AFTER = 3
export const VIEW_MODES = ['e', 'a']
export const DEFAULT_VIEW = 'e'

/** @returns {{ issueKeyPattern: string | undefined, language: 'en' | 'ja', warnAfterToolCalls: number, view: 'e' | 'a' }} */
export function resolveOptions(options) {
  const o = options ?? {}
  let issueKeyPattern
  if (typeof o.issueKeyPattern === 'string' && o.issueKeyPattern.trim() !== '') {
    try {
      new RegExp(o.issueKeyPattern)
      issueKeyPattern = o.issueKeyPattern
    } catch {
      issueKeyPattern = undefined
    }
  }
  const n = o.warnAfterToolCalls
  return {
    issueKeyPattern,
    language: normalizeLanguage(o.language),
    view: VIEW_MODES.includes(o.view) ? o.view : DEFAULT_VIEW,
    warnAfterToolCalls: Number.isInteger(n) && n >= 1 ? n : DEFAULT_WARN_AFTER,
  }
}
