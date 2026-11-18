// poll.js の単体テスト（node:test）。定期確認の判定に使う純関数。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signatureOf, isMissingError, shouldResolveScope, gitBranchOf, scopeLabel, POLL_MS, SCOPE_EVERY } from '../../hooks/poll.js'

test('定期確認の間隔は 2 秒、スコープの再判定は 5 回に 1 回', () => {
  assert.equal(POLL_MS, 2000)
  assert.equal(SCOPE_EVERY, 5)
})

test('signatureOf: mtimeMs と size が同じなら同じ、どちらかが違えば別', () => {
  const a = signatureOf({ mtimeMs: 100, size: 10 })
  assert.equal(a, signatureOf({ mtimeMs: 100, size: 10, kind: 'file' }))
  assert.notEqual(a, signatureOf({ mtimeMs: 101, size: 10 }))
  assert.notEqual(a, signatureOf({ mtimeMs: 100, size: 11 }))
})

test('signatureOf: stat が無ければ null（ファイルなし）', () => {
  assert.equal(signatureOf(null), null)
  assert.equal(signatureOf(undefined), null)
})

test('isMissingError: ENOENT だけをファイルなしとみなす', () => {
  assert.equal(isMissingError(Object.assign(new Error('x'), { code: 'ENOENT' })), true)
  assert.equal(isMissingError(new Error('ENOENT: no such file or directory')), true)
  assert.equal(isMissingError('ENOENT'), true)
  assert.equal(isMissingError(new Error('EACCES: permission denied')), false)
  assert.equal(isMissingError(undefined), false)
})

test('shouldResolveScope: 5 回に 1 回。0 回目（session.start で済ませる）は含めない', () => {
  assert.deepEqual([0, 1, 4, 5, 6, 9, 10].map(shouldResolveScope), [false, false, false, true, false, false, true])
})

test('gitBranchOf: 成功なら末尾の改行を除いたブランチ名、失敗や空は空文字', () => {
  assert.equal(gitBranchOf({ exitCode: 0, stdout: 'PAD-196/read-tree\n', stderr: '' }), 'PAD-196/read-tree')
  assert.equal(gitBranchOf({ exitCode: 0, stdout: '\n', stderr: '' }), '') // detached HEAD
  assert.equal(gitBranchOf({ exitCode: 128, stdout: 'x\n', stderr: 'fatal' }), '')
  assert.equal(gitBranchOf(undefined), '')
})

test('scopeLabel: issue と named は名前、branch はブランチ名、session は言語別の語', () => {
  const base = { sessionId: 's1', repo: 'r', cwd: '/w' }
  assert.equal(scopeLabel('en', { kind: 'issue', name: 'PAD-196', ...base }), 'PAD-196')
  assert.equal(scopeLabel('en', { kind: 'named', name: 'auth-rewrite', ...base }), 'auth-rewrite')
  assert.equal(scopeLabel('en', { kind: 'branch', branch: 'feature/x', ...base }), 'feature/x')
  assert.equal(scopeLabel('en', { kind: 'session', ...base }), 'this session')
  assert.equal(scopeLabel('ja', { kind: 'session', ...base }), 'このセッション')
})
