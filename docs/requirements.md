# claude-yak-tree 要件（2026-10-05 確定）

実装済みは P2 まで（Pane の表示と、`tree_promote` を除く 5 つのツール）。忘れ対策の警告と `tree_promote` は未実装。段階は `docs/design.md` §13、利用者向けの現状は `README.ja.md` の「開発状況」。

Claude Code の Mod として、作業中の「今やっていることのツリー」を画面右側に表示し続ける。
発想の元：ひげぽん「第9回 ログのすすめ」（gihyo.jp、2017-12-27）https://gihyo.jp/dev/serial/01/continue-power/0009
入れ子の箇条書きで作業の分解と試行錯誤の分岐を書き、`done` / `here` / `important` の印で現在地を示す。

## 決定事項

| 項目 | 決定 |
|---|---|
| 目的 | 主に人間（利用者本人）が話の大筋を見失わないため。Claude の現在地の回復は副次 |
| 書き手 | メインの Claude だけが専用ツールで書く。人間もファイルを直接直せる。サブエージェントは書かない（委譲は1つの枝としてメインが載せる） |
| 単位 | 次の順で決める（2026-10-05 更新）。1. userConfig の `issueKeyPattern`（既定は未設定）がブランチ名に一致 → issue ツリー。2. このセッションに `tree_promote` の記録がある → 名前付きツリー（名前は任意。英数字・`-`・`_`・`.`）。3. 既定ブランチ以外のブランチ → ブランチツリー。4. それ以外（既定ブランチ、detached HEAD、git 外）→ セッションツリー |
| 保存先 | リポジトリ外（`~/.claude/yak-tree/<repo>/` 以下。issue・名前付きは `<name>.md`、ブランチは `branches/<エンコード済みブランチ名>.md`、セッションは `sessions/<session-id>.md`）。正確なパスは設計 §3.1 |
| 形式 | ひげぽん式 Markdown。各行末に隠し ID `<!--id-->` |
| 印 | `done` / `here` / `important` / `abandoned`。1行に1つ。here は最大1つで、置けるのは印のないノードだけ。行き場が無いときだけ0個（here を done/abandoned にすると、印のない親→後続の印のない兄弟→さらに上の印のない祖先の順に自動で移る。here の祖先を done にしても here は動かない。2026-10-05 更新） |
| 実装 | 1つの Mod。`$.tool.register` の専用ツールと Pane を持つ。MCP サーバーは使わない |
| 専用ツール | `tree_add(parent_id?, text, here?)` / `tree_here(id)` / `tree_mark(id, done\|important\|abandoned\|none)` / `tree_edit(id, text)` / `tree_read()` / `tree_promote(name)`。サブエージェントは `tree_read` だけ呼べる（書き戻しなし）。2026-10-05 更新 |
| 表示 | `/tree` コマンドでだけ開閉（自動では開かない）。fullscreen かつ幅が十分ならサイドバー、狭ければプロンプト上の枠で可。表示モードは2つ：e（アウトライナー風）、a（git のグラフ風）。`/tree e`・`/tree a` で切り替え、選んだモードは `$.store` に保存して次のセッションでも使う。保存がなければ userConfig の `view`、それもなければ e。見出しに要約（`★N`：important の数、`open N`：here とその祖先を除く印のないノードの数）を出す（2026-10-06 更新） |
| 表示範囲 | 根から here までの経路とその兄弟。done / abandoned の枝は1行にたたむ。important は常に表示 |
| 反映 | ファイルを定期確認（`$.clock.every` + `$.fs.stat`）し、人間の手直しも Pane に反映 |
| 忘れ対策 | メインのターンでツール使用が3回以上（全ツールを数える。しきい値は設定で変更可）あったのにツリー未更新で終わったら、turn.complete で回答の下に警告1行。session スコープでツリーファイルがまだ無いときは出さない（issue スコープでは出す）。2026-10-05 更新 |
| 文脈注入 | しない。Claude は必要なときに `tree_read` を呼ぶ |
| 表示の言語 | 英語が既定。userConfig の `language` が `ja` なら日本語（Pane の見出しとモードの見出し語、警告、エラー、注意）。ツールの description（Claude が読む）は英語のみ。文字列は `hooks/i18n.js` に集約（2026-10-05 追加） |
| 設定 | userConfig に `issueKeyPattern`（既定なし）、`language`（既定 `en`）、`warnAfterToolCalls`（既定 3）、`view`（`e` / `a`、既定 `e`）（2026-10-05 追加） |
| 組み込みタスクリスト | 連携しない（Opus 5 では既定で無効、親子階層の記載なし） |
| 配布 | 公開する（GitHub の `padawansato/claude-yak-tree`。marketplace からインストールするか、`--plugin-dir` で読み込む。2026-11-12 更新） |
| 環境 | VS Code 統合ターミナル内の herdr。VS Code の chat パネルでは Mod は描画されない |

## 確認済みの Mod の制約（2026-10-02、一次資料は `ref/` に写し、git 管理外）

- Pane は `$.ui.open({ id })` で開き、`ui.render` で中身を返す。サイドバーになるのは fullscreen かつ 110 列以上（型定義の記載）。それ以外はプロンプト上のインライン枠
- ユーザー操作で開いた Pane は幅に関係なく表示される
- `$.ui.invalidate('ui.render')` で再描画（1秒10回まで。端末で表示中の Pane は30回まで）。`$.state` の書き込みでも再描画
- Mod に Node API・setTimeout は無い。`$.fs`（read/write/list/exists/stat/ancestors、1ファイル 4 MiB）、`$.process.run`、`$.clock` を使う
- `$.fs` に watch は無い。`classic.FileChanged` + `watchPaths` は未確認
- turn.start / turn.step / turn.complete は Mod のイベント。turn.complete は `{ text }` を返すと回答の下に1行出せる
- 出典：https://code.claude.com/docs/en/plugins/mods/interface 、https://code.claude.com/docs/en/plugins/mods/api 、https://code.claude.com/docs/en/plugins/mods/reference 、https://code.claude.com/docs/en/plugins/mods/events

## 設計で確認した事項（2026-10-05、詳細は `docs/design.md` §1）

- `/tree` コマンド：`session.start` で `$.command.register`、`command.run` で受ける。組み込みと同名なら登録が失敗するので `try/catch` で `/yak-tree` に逃がす。逃がしたときは `/tree` を受け取らず、同名の他の Mod のコマンドを横取りしない。`/tree` が組み込みにあるかは資料に記載がなく未確認
- ブランチ名：mods API に無い。公式の例どおり `$.process.run(['git','branch','--show-current'])`。セッション ID は `$.session.id()`。`/clear` `/branch` で ID が変わるので `classic.SessionStart` で引き継ぐ（`/resume` の挙動は未確認）
- ツール使用の判定：`tool.call`（メインは `agentId` なし）で数え、`turn.start` でリセット、`turn.complete`（`agentId` なし）で判定できる
- サブエージェントからツールを隠す手段は無い。書き込み系は `tool.call` で `agentId` を見て拒否し、`tree_read` だけ許す
