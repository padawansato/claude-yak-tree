// config.js の単体テスト（node:test）。userConfig の値（register の options）を読む純関数。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveOptions, DEFAULT_WARN_AFTER } from '../../hooks/config.js'

test('未設定（options が空や undefined）でも既定値になる', () => {
  for (const o of [undefined, null, {}]) {
    assert.deepEqual(resolveOptions(o), { issueKeyPattern: undefined, language: 'en', warnAfterToolCalls: 3, view: 'e' })
  }
  assert.equal(DEFAULT_WARN_AFTER, 3)
})

test('issueKeyPattern: 文字列はそのまま、空文字や非文字列は未設定', () => {
  assert.equal(resolveOptions({ issueKeyPattern: '^([A-Z]+-[0-9]+)' }).issueKeyPattern, '^([A-Z]+-[0-9]+)')
  for (const v of ['', '   ', 5, true, null]) assert.equal(resolveOptions({ issueKeyPattern: v }).issueKeyPattern, undefined)
})

test('issueKeyPattern: 不正な正規表現は未設定として扱う', () => {
  assert.equal(resolveOptions({ issueKeyPattern: '([x' }).issueKeyPattern, undefined)
})

test('language: ja だけが ja、それ以外は en', () => {
  assert.equal(resolveOptions({ language: 'ja' }).language, 'ja')
  for (const v of ['en', 'fr', '', 3, undefined]) assert.equal(resolveOptions({ language: v }).language, 'en')
})

test('warnAfterToolCalls: 1 以上の整数だけ受け、それ以外は既定の 3', () => {
  assert.equal(resolveOptions({ warnAfterToolCalls: 5 }).warnAfterToolCalls, 5)
  assert.equal(resolveOptions({ warnAfterToolCalls: 1 }).warnAfterToolCalls, 1)
  for (const v of [0, -1, 2.5, '4', NaN, undefined]) assert.equal(resolveOptions({ warnAfterToolCalls: v }).warnAfterToolCalls, 3)
})

test('view: e / a だけ受け、それ以外（c を含む）は既定の e', () => {
  for (const v of ['e', 'a']) assert.equal(resolveOptions({ view: v }).view, v)
  for (const v of ['c', 'x', '', 'E', 3, null, undefined]) assert.equal(resolveOptions({ view: v }).view, 'e')
})
