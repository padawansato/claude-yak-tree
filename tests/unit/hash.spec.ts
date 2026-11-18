// hash.js の単体テスト（node:test）。Mod からは node:crypto が使えないので、依存なしの SHA-256 を node:crypto と突き合わせる。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sha256Hex } from '../../hooks/hash.js'

const ref = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

for (const s of ['', 'abc', 'feature/login', '日本語のブランチ/名前', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'x'.repeat(1000), '😀'.repeat(50)]) {
  test(`sha256Hex: ${JSON.stringify(s.slice(0, 12))}（${s.length} 文字）が node:crypto と一致`, () => {
    assert.equal(sha256Hex(s), ref(s))
  })
}
