// i18n.js の単体テスト（node:test）。人に見える文字列は i18n.js の 1 か所にある。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MESSAGES, normalizeLanguage, t } from '../../hooks/i18n.js'

test('normalizeLanguage: ja だけが日本語、それ以外（未設定を含む）は英語', () => {
  assert.equal(normalizeLanguage('ja'), 'ja')
  for (const v of ['en', undefined, null, '', 'fr', 'JA', 3]) assert.equal(normalizeLanguage(v), 'en')
})

test('en と ja のキーが一致する', () => {
  assert.deepEqual(Object.keys(MESSAGES.ja).sort(), Object.keys(MESSAGES.en).sort())
})

test('en と ja のプレースホルダが一致する', () => {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  for (const k of Object.keys(MESSAGES.en)) assert.deepEqual(ph(MESSAGES.ja[k]), ph(MESSAGES.en[k]), k)
})

test('t: 英語が既定、ja で日本語、プレースホルダを置換する', () => {
  assert.equal(t('en', 'pane.omitted', { n: 3 }), ' (+3 rows omitted)')
  assert.equal(t('ja', 'pane.omitted', { n: 3 }), ' (+3 行省略)')
  assert.equal(t(undefined, 'pane.omitted', { n: 3 }), ' (+3 rows omitted)')
})

test('t: 未知のキーはキーそのもの、未指定のプレースホルダはそのまま', () => {
  assert.equal(t('en', 'no.such.key'), 'no.such.key')
  assert.equal(t('en', 'pane.omitted'), ' (+{n} rows omitted)')
})

test('en の文字列に日本語は含まれない', () => {
  for (const [k, v] of Object.entries(MESSAGES.en)) assert.equal(/[぀-ヿ㐀-鿿]/.test(v), false, k)
})

test('表示モードの新しい文字列が en と ja の両方にある', () => {
  const keys = ['pane.mode', 'pane.unknownView', 'pane.important', 'pane.open', 'view.here']
  for (const k of keys) {
    assert.ok(k in MESSAGES.en, 'en: ' + k)
    assert.ok(k in MESSAGES.ja, 'ja: ' + k)
  }
  assert.equal(t('en', 'pane.mode', { mode: 'a', command: 'tree' }), 'mode: a  (/tree e|a)')
  assert.equal(t('ja', 'pane.open', { n: 4 }), '未着手 4')
})

test('c モード用のキーは残っていない', () => {
  for (const k of ['view.siblings', 'view.up', 'view.closed', 'view.top', 'view.next', 'view.since']) {
    assert.equal(k in MESSAGES.en, false, k)
    assert.equal(k in MESSAGES.ja, false, k)
  }
})
