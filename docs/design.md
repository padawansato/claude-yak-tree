# claude-yak-tree 設計案（2026-10-05、PAD-193）

要件は `docs/requirements.md`（2026-10-05 確定、同日に決定後の内容へ更新：here の個数、ツール一覧、忘れ対策の条件、再描画上限、未確認 4 点の確認結果）。本書はその実現方法を定める。設計レビュー（Opus reviewer、2 回）の指摘とユーザーの判断は §14 にまとめ、本文に反映済み。

## 0. 前提と資料の版

| 資料 | 版 | 備考 |
|---|---|---|
| `ref/mods_*.md`, `ref/plugins_mods_*.md`, `ref/hooks.md` | ドキュメントは v2.1.287 時点（`ref/plugins_mods_reference.md` 冒頭） | 2026-10-02 取得 |
| `ref/cc.d.ts` | 先頭行「Written by Claude Code 2.1.277」 | ドキュメントより古い。`$.ui.open` の戻り値がドキュメントでは `{ isPlaced }`、d.ts では `void` など差がある |
| 手元の Claude Code | 2.1.289（`claude --version`、2026-10-05） | Mod の必要版 2.1.287 以上を満たす（`ref/mods_create.md` Note） |
| https://code.claude.com/docs/en/plugins/mods/test | 2026-10-05 取得（`ref/` に写しなし） | テスト方針の出典 |

出典の書き方：`ファイル名「節名」`。推測は「推測」と明記する。「未確認」は一次資料で裏が取れなかったもの。

`ref/mods_create.md`「Get type definitions for your version」によれば、`--plugin-dir` で読み込むと `.claude-plugin/types/` に手元の版の d.ts が書き出され、「ドキュメントと食い違うときはこちらを信じよ」とある。実装着手時に最初にこれを生成し、本書の d.ts 引用を 2.1.289 のもので照合すること。

mods API の `$.session.id()` / `cwd()` / `root()` / `repo()`、`$.store.get()`、`$.env.get()`、`$.fs.*`、`$.process.run()`、`$.command.register()` はすべて Promise を返す（`ref/cc.d.ts` 各名前空間）。本書の擬似コードは `await` を省かない。

## 1. 未確認 4 点の裏取り結果

### 1.1 `/tree` コマンドの定義方法 — 確認できた（名前の衝突だけ未確認）

- `session.start` フックで `await $.command.register({ name, description, argumentHint?, immediate? })`、`command.run` を `{ command: 'tree' }` のマッチャで受ける（`ref/mods_api.md`「Add a command」、`ref/cc.d.ts` `CommandSpec`）。
- Pane を開くだけのコマンドは `{}` を返すと transcript に何も出ない（同節）。
- ターン実行中にも開閉したいので `immediate: true` を付ける。付けないとターン終了まで待たされる（`ref/mods_api.md`「Add a command」、`ref/plugins_mods_interface.md`「Open a pane at the right time」）。
- 組み込みと同名だと `$.command.register` は失敗する（Promise が reject。`ref/mods_api.md`「Add a command」、`ref/cc.d.ts` `command.register`「a built-in's name is refused」）。フックが throw すると、その回の `session.start` フックの残りの処理が走らない。対策は「最後に登録する」か `try/catch`（同節）。
- `/tree` が組み込みにあるかは**未確認**。`ref/` 全体を `/tree` で grep すると GitHub URL の `/tree/main` しか当たらず、`ref/interactive.md` 等に現れる組み込みコマンド名（60 件ほど）にも `/tree` はないが、網羅的な一覧ではない。
- 決定：`try { await $.command.register({ name: 'tree', ... }) } catch { await $.command.register({ name: 'yak-tree', ... }) }`（`await` を付けないと reject を catch できない）。どちらで登録できたかを `$.ui.log(..., { to: 'debug' })` に残す。`command.run` のマッチャは `{ command: ['tree', 'yak-tree'] }`（配列マッチャ：`ref/mods_events.md`「Filter which events a hook handles」）。マッチャは変数にせず配列を直接書く（変数にすると `claude plugin validate` の静的解析が `command=?` と表示し、受けるコマンドを読み取れない）。フックの中では、登録できた名前と `e.command` が違えば `next(e)` に渡す。`/yak-tree` に逃がしたときの `/tree` は他の Mod のコマンドなので、横取りしない（2026-10-14、PAD-202）。試作で `claude plugin validate` を通した（§15）。

### 1.2 ブランチ名とセッション ID — セッション ID は確認、ブランチは git を叩く

- セッション ID：`await $.session.id()`「Returns the session's id (the transcript file's name)」（`ref/cc.d.ts` `session` 名前空間）。
- `/clear` や `/branch` の後はプロセスが別の ID で続く（`ref/cc.d.ts` `SessionEndInput.sessionId` のコメント「after a /clear or a resume the process goes on under another」）。`session.start` はその際に再発火しないので、`classic.SessionStart` を `{ source: ['clear', 'resume', 'fork'] }` で受けて取り直す（`ref/plugins_mods_interface.md`「Load a saved value again after /clear」、`ref/plugins_mods_reference.md`「Session」）。`/resume` で ID が「元のセッションの ID に戻る」のか「別の新しい ID になる」のかは**未確認**。
- ブランチ名：mods API に直接の取得手段はない。`$.session.repo()` が返すのは `{ root, remote, internal, name }` でブランチは含まない（`ref/cc.d.ts` `SessionRepo`）。公式の例自体が `$.process.run(['git', 'branch', '--show-current'])` を使っている（`ref/mods_events.md`「Rewrite or add to a prompt」「Approve or refuse a tool call before the user is asked」）ので、それに従う。`$.process.run` はシェルを使わず argv を取り、exitCode に関わらず resolve、起動失敗・タイムアウト（既定 30 秒）で reject（`ref/mods_api.md`「Reach files, processes, and the network」）。
- リポジトリ名：`$.session.repo()` は git リポジトリ外では `null`、中では `root` が worktree でも「main working tree の root」（`ref/cc.d.ts` `SessionRepo.root`）。この basename を `<repo>` に使えば、同じ issue の worktree どうしが同じツリーファイルを共有できる。
- `$.session.cwd()` と `$.session.root()` は別物（`/cd` 等で動くのが root。`ref/cc.d.ts` `session.root`）。git は `cwd` で実行する。

### 1.3 「ツール使用があったのにツリー未更新」の判定 — 確認できた

- `tool.call` は Claude が使う全ツールで発火し、サブエージェントの呼び出しや MCP ツールも含む。サブエージェント内の呼び出しは `e.agentId` が付き、メインループでは付かない（`ref/mods_events.md`「Guard or change a tool call」、`ref/cc.d.ts` `ToolCallInput = ToolCallEnvelope & AgentLoop`、`AgentLoop.agentId`「absent on the main loop」）。
- `turn.start` は `e.turnId` を持ち、`turn.complete` は同じ `turnId` と `answer`、`isAborted`、`reason`、サブエージェントなら `agentId` を持つ（`ref/mods_events.md`「Follow a turn」、`ref/cc.d.ts` `TurnCompleteFields`）。サブエージェントのターンも全フックに見えるので `agentId` で除外する必要がある（同 d.ts コメント「Every hook sees a subagent's turn」）。
- `turn.complete` フックが `{ text }` を返すと回答の下に 1 行出る（`ref/mods_events.md`「Follow a turn」）。core が `usage` を埋めるので `{ ...(await next(e)), text }` の形で返す（`ref/cc.d.ts` `TurnCompleteResult` コメント）。
- したがって「`turn.start` でカウンタを 0 に → メインループの `tool.call`（自前の `tree_*` を除く）で加算 → `tree_*` の書き込みツールが成功したらフラグ → `turn.complete` で判定」で実現できる。代替として `turn.step` の結果 `toolUses`（`ref/cc.d.ts` `TurnStepResult.toolUses`）を数える手もあるが、`turn.step` は async generator で書く必要があり複雑なので採らない。
- 試作の静的検証（`claude plugin validate`）は通った。テストキットでの動作確認は環境側の理由で未了（§15）。

### 1.4 サブエージェントから専用ツールを隠せるか — 隠せない。書き込み系は拒否、`tree_read` は許す

- `$.tool.register` の `ToolSpec` は `name`、`description`、`inputSchema` だけで、可視範囲を指定する項目はない（`ref/cc.d.ts` `ToolSpec`）。
- `tool.describe` は「ツールごとに 1 回、最初に説明がモデルへ送られるとき」に発火し、エージェント軸（`agentId`）を持たない（`ref/plugins_mods_reference.md`「Tools」、`ref/cc.d.ts` `ToolDescribeInput`）。サブエージェントにだけ別の説明を出すことはできない。
- `agent.spawn` の入力で書き換えられるのは `prompt`、`description`、`subagentType`、`model`、`background`、`cwd` で、ツール一覧は含まない（`ref/cc.d.ts` `AgentSpawnInput`）。
- 結論：**直接の手段はない**（検証エージェントも同じ結論。§15.1）。
- 決定：各ツールの `tool.call` 処理（`{ tool: 'mcp__yak-tree__<name>' }` で個別に受ける）の共通前処理で `e.agentId` を見る。書き込み系（`tree_add` / `tree_here` / `tree_mark` / `tree_edit` / `tree_promote`）は `{ deny: 'yak-tree の書き込みはメイン会話専用。変更したい内容は最終報告に書き、メインが載せる' }` を返し、`tree_read` は許す（サブエージェントが現在地を知るのは無害で役に立つ。ただし ID の補正書き戻しはしない。§5）。正規表現マッチャの別フックにはしない：各ツール処理は `next` を呼ばずに答えるので、同じイベントに後から `on` したフックは走らない（`ref/mods_events.md`「The order mods run in」「Within one module, hooks run in the order `register` called `on`」）。deny の文はツール結果として Claude が読むので、行動指示として書く（同「Guard or change a tool call」）。ツール説明にも「書き込みはメイン会話専用」と明記する。

## 2. ファイル構成

```
claude-yak-tree/
├── .claude-plugin/
│   └── plugin.json            # name: "yak-tree"（後述）、userConfig: issueKeyPattern / language / view / warnAfterToolCalls、公開用メタデータ
├── hooks/
│   ├── hooks.json             # { "modules": ["./register.js"] }
│   ├── register.js            # 唯一の hooks module。$.xxx の呼び出しは全部ここ
│   ├── tree.js                # 純関数：parse / serialize / 操作（add, setHere, mark, edit, moveHereAfterClose）
│   ├── view.js                # 純関数：表示モデル（here 中心の折りたたみ、幅・高さへの当てはめ）
│   ├── views.js               # 表示モード e / a の描き方（Box / Text を引数で受け取る。`$` は受け取らない）
│   ├── scope.js               # 純関数：ブランチ名・セッション ID・repo・設定 → スコープと保存パス
│   ├── poll.js                # 純関数：定期確認の判定（stat の印、ENOENT、スコープ再判定の間隔、git の出力、見出しのスコープ名）
│   ├── i18n.js                # 人に見える文字列（en / ja）を 1 か所に集約
│   └── config.js              # 純関数：userConfig の値（options）を読む
├── tests/
│   ├── unit/                  # node:test の単体テスト（tree / view / views / scope / poll / i18n / config の *.spec.ts）
│   └── mod.test.ts            # フック経由のテスト（claude plugin test）
├── docs/
│   ├── requirements.md
│   └── design.md
├── LICENSE                    # MIT
├── README.md / README.ja.md   # 公開用（英語 / 日本語）
└── ref/                       # 一次資料の写し（git 管理外）
```

根拠と制約：

- 必須ファイルは `plugin.json`、`hooks/hooks.json`（`modules` に 1 パス）、hooks module の 3 つ（`ref/plugins_mods_reference.md`「Files」）。
- プラグイン名は `claude-` で始まると `claude plugin validate` が落ちる（`ref/mods_create.md`「Share your mod」）。`plugin.json` の `name` は `yak-tree`、marketplace の名前は `claude-yak-tree` にする（インストールは `yak-tree@claude-yak-tree`）。GitHub のリポジトリは `padawansato/claude-yak-tree`。`homepage` と `repository` はこれを指す（2026-11-12 更新）。ツールの完全名は `mcp__yak-tree__tree_add` などになる（`ref/mods_api.md`「Add a tool」）。
- `$` を別ファイルの関数に渡すと静的解析に落ちる（`ref/mods_create.md`「Check what Claude Code reads from your mod」）。そのため `tree.js` / `view.js` / `scope.js` は `$` を受け取らない純関数にし、ファイル I/O・git・UI は `register.js` に集める。この分割はテストのしやすさにも効く。
- `types/index.d.ts` は `$.state` を使う場合に必要（同「Files」）。本設計は `$.state` を使わず module 変数＋`$.ui.invalidate` で描画するので不要。理由は §8。
- userConfig は `issueKeyPattern`（string、既定なし）、`language`（`en` / `ja`、既定 `en`）、`view`（`e` / `a`、既定 `e`）、`warnAfterToolCalls`（number、min 1、既定 3）の 4 つ（2026-10-05 更新。旧：`warnAfterToolCalls` だけ）。値は `register(on, options)` の `options` に入る（`ref/plugins_mods_reference.md`「Files」）。`--plugin-dir` / `CLAUDE_CODE_PLUGIN_DIRS` で読み込む mod の値は `pluginConfigs` の `yak-tree@inline` キーで与える（同「Settings and environment variables」）。
- 配布は `CLAUDE_CODE_PLUGIN_DIRS`（絶対パス、`:` 区切り。同節）。開発中は `claude --plugin-dir` でホットリロード（`ref/mods_create.md`「Change the code while the session runs」）。

## 3. 保存パスとスコープ

### 3.1 パス

```
<base>/<repo>/<ISSUE>.md                 # issue スコープ（issueKeyPattern がブランチ名に一致）  例: ~/.claude/yak-tree/my-repo/PAD-193.md
<base>/<repo>/<name>.md                  # 名前付きスコープ（tree_promote の記録あり）
<base>/<repo>/branches/<エンコード済みブランチ名>.md   # ブランチスコープ（既定ブランチ以外）
<base>/<repo>/sessions/<session-id>.md   # セッションスコープ
<base>/_nogit/<basename(cwd)>/sessions/<session-id>.md   # $.session.repo() が null のとき
<base>/_nogit/<name>.md                  # $.session.repo() が null で issue / 名前付きスコープのとき（promote 後）
```

- `<base>` は `${HOME}/.claude/yak-tree` 固定。`$.fs.stat` のコメントに「a spelling it cannot resolve (`~`, a file not there yet)」とあり（`ref/cc.d.ts` `$.fs.stat`）、`$.fs` 名前空間の冒頭は「absolute path is used as given」なので `~` には頼らず、`await $.env.get('HOME')` で絶対パスを組み立てる。
- `<repo>` は `(await $.session.repo()).root` の basename。同名のリポジトリを複数使う人では衝突する。既知の制約として許容する。
- `<ISSUE>` と `<name>` は `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` で、`..` を含まないものに限定（ファイル名に使うため。パス区切りや `..` は `E_BAD_INPUT`）。`issueKeyPattern` で取り出した値がこれに合わなければ issue として扱わない。
- `<エンコード済みブランチ名>`：英数字・`-`・先頭以外の `.` はそのまま、それ以外（`/`、`_`、日本語など）は UTF-8 の各バイトを `_xx`（小文字 16 進）に置き換える（`feature/login` → `feature_2flogin`）。`_` 自身も置き換えるので、変換後が 200 バイト以内なら別のブランチ名が同じファイルになることはない（単射）。変換後が 200 バイトを超えたら、先頭 182 文字に `_h` と元のブランチ名の SHA-256 先頭 16 桁を付けて 200 バイトにする（ファイル名の上限 255 バイトに `.md` を足しても収める）。通常の変換結果に `_h` は現れないので、切り詰めた名前が切り詰めない名前と衝突することはない。切り詰めた名前は元に戻せない。SHA-256 は `hooks/hash.js` の依存なし実装（Mod の hooks module は `node:crypto` を import できず、グローバルの `crypto` に同期のハッシュがないため。出力は `node:crypto` と一致することをテストで照合）。
- 注意：大文字と小文字を区別しないファイルシステム（macOS の既定など）では、大小だけが違うブランチ名（`Feature` と `feature`）が同じファイルを共有する。コードでは区別しない（既知の制約）。
- `.md` 以外に `<base>/<repo>/.tmp/` を作り、書き込みの一時ファイルに使う（§11）。

### 3.2 スコープ判定

```
async resolveScope():
  sessionId = await $.session.id()
  repo      = await $.session.repo()                       // null なら _nogit
  cwd       = await $.session.cwd()
  branch    = (await $.process.run(['git','branch','--show-current'], { cwd })).stdout.trim()  // reject/非0 なら ''
  defaultBranch = git symbolic-ref --short refs/remotes/origin/HEAD から取れた名前 ?? null   // 取れなければ main / master を既定とみなす
  key = issueKeyPattern がブランチ名に一致して取り出せた値                                   // 未設定なら null
  if key                                   → issue スコープ(key)                // 1. ブランチ優先
  promoted = promotedCache[sessionId] ?? await $.store.get('promoted:' + sessionId)
  if promoted                              → 名前付きスコープ(promoted)          // 2.
  if branch && branch は既定ブランチでない  → ブランチスコープ(branch)             // 3.
  sessionPath = sessionPathCache[sessionId] ?? await $.store.get('sessionPath:' + sessionId) ?? 既定パス(sessionId)
  → session スコープ(sessionId, sessionPath)
```

- 決定順（2026-10-05 更新。旧：`[A-Z][A-Z0-9]*-[0-9]+` のブランチ → promote → session の決め打ち）：1. userConfig の `issueKeyPattern`（正規表現の文字列。既定は未設定）が設定され、ブランチ名から取り出せたら issue。キャプチャグループがあれば 1 番目、なければ一致全体を使う。不正な正規表現は未設定として扱う。2. このセッションに promote の記録があれば名前付き。3. 既定ブランチ以外のブランチにいればブランチ。4. それ以外（既定ブランチ、detached HEAD、git 外）は session。
- 既定ブランチは `git symbolic-ref --short refs/remotes/origin/HEAD`（`origin/` を外す）を優先し、取れなければ `main` と `master` を既定とみなす。
- `tree_promote` は、ブランチ名から issue キーが取れないときに、このセッションのツリーに名前を付ける手段（§10）。
- 判定のタイミング：`session.start`、`classic.SessionStart`（source: clear/resume/fork）、各 `tree_*` 呼び出しでは書き込みキューに入った直後（`writeThrough` の冒頭。§11.1。キューの外で判定すると、promote と add が同時に来たとき add が旧パスに書く）、定期確認の 5 回に 1 回（10 秒ごと、§8）。ブランチを途中で切り替えても追従させるためで、git の実行を 2 秒ごとにしないための間引き。
- `promotedCache` と `sessionPathCache` は module 変数で、`$.store`（`promoted:<id>`、`sessionPath:<id>`）にも持つ。`/clear` と `/branch`（source `fork`）でセッション ID が変わるので、`classic.SessionStart` の `clear` / `fork` では直前の ID から新しい ID へ引き継ぐ：`promoted` の値をコピーし、session スコープなら「新 ID が使う session ファイルのパス」として旧 ID のパス（旧 ID 自身が引き継いでいればそのパス）を `sessionPath:<newId>` に記録する。これで `/clear` の後も同じ session ツリーが続く（新 ID のパスへコピーはしない）。直前の ID は `session.end` の `e.sessionId` で控える（`ref/cc.d.ts` `SessionEndInput`）。`/resume` では ID の扱いが未確認（§1.2）なのでコピーはせず、新しい ID のキーを読むだけ。見つからなければ既定の session パスに落ちる。
- `$.store` はマシン上の全セッションで共有され、合計 4 MiB（`ref/plugins_mods_reference.md`「Limits」）。キーをセッション ID で分けるので衝突しない（`ref/plugins_mods_interface.md`「Save from more than one session」）。

## 4. Markdown 書式とパース／書き出し

### 4.1 書式（ひげぽん式＋隠し ID）

元記事（gihyo.jp「第9回 ログのすすめ」、2026-10-05 取得）の例は、字下げ 4 スペースの箇条書きで、印を行頭に `__done__` / `__here__` / `__important__` と置く。元記事に here の移動規則はない（確認済み）。原文の例（リスト 2）：

```
- システムAをローカルで動かしてみる
    - __done__ ライブラリDが必要らしい
        - __done__ dependencyに追加した
    - __here__ スタックトレースを見るとDIで失敗している
        - そもそもそのdependencyは必要なのか
    - 本番サーバのconfigを見てみる
- システムAをデバッガで動かしてみて処理を追う
```

本 Mod の正規形はこれに `abandoned` と行末の隠し ID を足したもの：

```
# PAD-193 yak-tree

- __done__ 要件の未確認 4 点を一次資料で裏取り <!--k3f9a2-->
    - __done__ /tree の登録方法 <!--p0w1xd-->
    - __important__ サブエージェントから隠す手段は無い。tool.call で拒否 <!--m8t2qa-->
- 設計書を書く <!--z51hhc-->
    - __done__ ファイル構成 <!--4tcq2p-->
    - __here__ Pane の描画規則 <!--j4qaq2-->
        - 狭い幅の扱いを決める <!--b6xav2-->
    - __abandoned__ $.state で描画する案（型宣言ファイルが増えるだけ） <!--dddd44-->
- git commit <!--ffff66-->
```

- 1 行 = 1 ノード。`{字下げ}- {__印__ }{本文} <!--{id}-->`。
- 字下げ：**書くときは** 4 スペース／段。**読むときは**固定幅で割らず、スタック上の祖先の実際の字下げ幅と比較して深さを決める（§4.2）。2 スペース、3 スペース、タブ、混在のどれでも木になる。
- 印は `done` / `here` / `important` / `abandoned` の 4 つ、1 行に 1 つ（元記事と同じ）。読むときは行頭の `__印__` だけを印とみなし、本文中の `__important__` は本文の一部として残す（試作で確認）。
- ID は行末の `<!--[0-9a-z]{6}-->`（空白なし、6 文字固定、base36 で約 22 億通り）。この形に一致しないコメントは本文の一部。生成は `crypto.getRandomValues`（hooks module のグローバル `crypto` 宣言に `getRandomValues` と `randomUUID` がある：`ref/cc.d.ts` の `var crypto` 宣言。確認済み）。
- `<!--id-->` は Markdown のレンダラでは表示されないので、GitHub や VS Code のプレビューでは元記事と同じ見た目になる。
- 箇条書き以外の行（見出し、空行、散文、HTML コメント）は「直前のノードに付随する行」として位置ごと保持し、書き出しでもそのまま出す。先頭ノードより前の行は `prelude` として保持する。コードフェンス（```` ``` ```` または `~~~` で始まり、同じ記号の行で閉じる）の内側は、`- ` で始まっていても散文として扱う。
- 最上位ノードは複数あってよい（元記事も複数）。「根」は仮想ノードとし、`tree_add` の `parent_id` 省略時は最上位の末尾に追加する。

既知の制約：最上位への追加は「最後の最上位ノードの付随行の後ろ」に入る。人間がファイル末尾に見出しやメモを書いていると、新しい最上位ノードはその見出しの下に並ぶ。ツリーファイルの末尾にメモを書かず、先頭（`prelude`）か各ノードの直後に書く運用で避ける。

### 4.2 パース規則（`tree.js` の `parseTree(text) → { prelude, nodes, issues, here }`）

深さの決め方：行頭の空白を列数に直し（タブは次の 4 の倍数へ）、スタック（祖先の列）の末尾が自分の列以上である間 pop する。pop 後のスタック長が深さ、末尾が親。これにより 2 スペース刻みも 3 スペースも、祖先より深ければ子、同じなら兄弟、浅ければ対応する祖先の兄弟になる。祖先より 2 段以上深く見える行も「直前のより浅い行の子」になるだけで、`indent-jump` の報告は不要。

| 入力 | 扱い | `issues` |
|---|---|---|
| `- ` / `* ` / `+ ` で始まる行（フェンス外） | ノード。`-` に正規化 | — |
| ID なし、または `<!--[0-9a-z]{6}-->` に一致しない | その場で新 ID を採番 | `no-id` |
| ID が既出と重複 | 後の行に新 ID を採番（`no-id` とは二重に報告しない） | `dup-id` |
| `__here__` が複数 | 文書順で最後を採用、他は印なしに | `multi-here` |
| `__here__` がない | `here = null`。エラーにしない | — |
| 箇条書き以外の行、フェンス内の行 | 直前ノードの `trailing`（先頭なら `prelude`）に保持 | — |
| 4 MiB 超 | `$.fs.read` が拒否するので読まない | `too-large`（呼び出し側） |

`issues` は Pane の見出し行と `tree_read` の冒頭に短く出す（例：`ID なし 2 行を採番`、`here が 2 つ → j4qaq2 を採用`）。

### 4.3 書き出し規則（`serializeTree(doc) → text`）

- `prelude` → 各ノード（`'    '.repeat(depth) + '- ' + (mark ? '__mark__ ' : '') + text + ' <!--id-->'`）→ `trailing` の順。末尾は改行 1 つ。
- 冪等：`serialize(parse(serialize(parse(x))))` が `serialize(parse(x))` と一致すること（試作で確認）。
- 本文の末尾空白は落とす。本文中の `<!--` はそのまま残す（ID は行末の 6 文字形だけなので混同しない）。
- 字下げの正規化はツールが書くときに自然に起きる（全文を書き直すため）。読み取りだけの定期確認では書き戻さない。

### 4.4 人間が壊したときの扱い

| 事象 | 読み取り時 | ファイルへの反映 |
|---|---|---|
| ID を消した・書き換えた・他の行にコピーした | 新 ID を採番し、`issues` に出す | ID を Claude に渡すツール（`tree_read` を含む全ツール）が、その呼び出しの中で ID を補ったファイルを書き戻す（§11 の手順。読んだときと `stat` が同じときだけ書く）。これで `tree_read` が返した ID は次の呼び出しでも有効。例外：サブエージェントからの `tree_read` は書き戻さない（要件「サブエージェントは書かない」）ので、返した ID の有効性はメイン会話の呼び出しに限って保証する |
| 行を手で足した（ID なし） | 同上 | 同上 |
| `__here__` を 2 か所に | 文書順で最後を採用 | 同上（他方の印を落として書き戻す） |
| 字下げを崩した | 祖先との比較で木にする | ツールが次に書くときに 4 スペースに揃う。読むだけでは直さない |
| ファイルを消した | `ENOENT` → 空ツリー扱い。Pane に「ファイルなし」 | 次の `tree_add` で作り直す。勝手には作らない |
| ファイルが 4 MiB 超 | 読まない。Pane に「大きすぎる」 | 人間が分割する。ツールは `deny` |

定期確認（§8）は読むだけで、ファイルを書き換えない。人間が編集中のファイルに Mod が割り込まないようにするため。

## 5. 専用ツール 6 つ

登録は `session.start` で `await $.tool.register`。処理は `tool.call` を `{ tool: 'mcp__yak-tree__<name>' }` で受け、`next` を呼ばずに `{ result }` か `{ deny }` を返す。`next` を呼ばないので許可プロンプトは出ない（`ref/mods_events.md`「Guard or change a tool call」）。引数は `e` のフィールドとして渡る（`ref/mods_api.md`「Add a tool」の `e.id`）。

共通の前処理：書き込み系は `e.agentId` があれば deny（§1.4）→ §11 の直列化キューに入る → キューの中で `await resolveScope()` → ファイルを読み直して parse（キャッシュは使わない）。

フックの登録順（`register` 内の `on` の順）：**カウント用の `tool.call` フック（マッチャなし、§9）を先に、各ツールの処理フックを後に** 登録する。各ツール処理は `next` を呼ばずに答えるので、後ろに登録したフックはそのイベントで走らない（`ref/mods_events.md`「The order mods run in」）。順序が逆だと `tree_*` 以外のカウントは動くが、`tree_*` 呼び出しで `treeWritten` を立てる処理がツール処理の中にある限り問題はない。それでも「カウントが先」に固定し、テストで守る（§12.3-7）。

共通のエラー（すべて `{ deny: '<コード>: <説明と次にすべきこと>' }`。deny はモデルにエラー結果として届く：`ref/cc.d.ts` `ToolCallResult`）：

| コード | 条件 |
|---|---|
| `E_SUBAGENT` | 書き込み系で `e.agentId` あり |
| `E_NOT_FOUND` | `id` が現在のファイルにない。「`tree_read` で ID を確認せよ」を添える |
| `E_BAD_INPUT` | 空文字、改行入り本文、印の記法（`__done__ ` など）で始まる本文、`<!--` から `-->` までを含む本文、規定外の `mark` / `issue`、issue ブランチでの `tree_promote` |
| `E_EXISTS` | `tree_promote` の昇格先が既にある。「人間が手で統合する」を添える |
| `E_CONFLICT` | 書き込みの再試行（§11.1）を 2 回やっても外部変更が続いた |
| `E_TOO_LARGE` | ファイル 4 MiB 超 |
| `E_IO` | 読み書き・`mv` の失敗。パスを添える |

成功時の `result` は文字列（Markdown）で返す。1 行目に `ok <op> <id>`、2 行目に `here: <id or none>`、3 行目にファイルパス。Claude が次の判断に必要な最小情報だけを返し、全文は `tree_read` に任せる。

| ツール | inputSchema | 動作 | 結果 |
|---|---|---|---|
| `tree_add` | `{ parent_id?: string, text: string, here?: boolean }`、required `['text']` | `parent_id` の子の末尾（省略時は最上位の末尾）に新ノード。`here: true` なら同時に here をそこへ移す | 新 `id` |
| `tree_here` | `{ id: string }` | `id` を `here` に。前の `here` は印なしに戻す | 旧 here と新 here |
| `tree_mark` | `{ id: string, mark: 'done' \| 'important' \| 'abandoned' \| 'none' }` | 印を置き換える（`none` は外す）。対象が `here` だった場合は §6 の規則で here を移す | 新しい here |
| `tree_edit` | `{ id: string, text: string }` | 本文だけ置換。印と ID は保持 | — |
| `tree_read` | `{}` | 現在のファイル全文（ID 付き）を返す。冒頭にスコープ、パス、`here`、`issues` を 1〜3 行。メイン会話からの呼び出しで `issues` があれば補正済みの内容を書き戻してから返す（§4.4）。サブエージェントからも呼べるが、そのときは読むだけで書き戻さない | 全文 |
| `tree_promote` | `{ name: string }` | §10 | 新パス |

要件書のシグネチャ `tree_add(parent_id?, text)` と `tree_mark(id, done|important|abandoned)` に対し、`here?: boolean` と `none` を加えた（ユーザー判断、§14）。

ツール説明（`description`）はモデルが呼ぶ判断の唯一の手がかりなので（要件「文脈注入しない」）、次を含める：「作業を分解したとき・方針を変えたとき・一区切りついたときに呼ぶ」「書き込みはメイン会話専用」「ID は `tree_read` で確認」。

## 6. here の規則

不変条件：ファイル中の `__here__` は最大 1 個。行き場が無いときだけ 0 個（要件書に同文で反映済み）。ツール経由の書き込みでは常に守る。人間の編集で破れた場合は読み取り時に 1 つへ絞る。

印は 1 行に 1 つなので、here を付けると移動先の `done` / `important` / `abandoned` が消える。これを避けるため、here を置けるのは**印のないノードだけ**とする。

- `tree_here(id)` / `tree_add(..., here: true)`：旧 here の印を外してから新 here を付ける。同一トランザクション（1 回の書き出し）で行う。`tree_here` が印付きのノード（`done` / `important` / `abandoned`）を指したら `E_BAD_INPUT`（「先に `tree_mark(id, 'none')` で印を外すか、別のノードを選ぶ」）。`tree_add` の新ノードは印なしなので常に置ける。
- `tree_mark(here のノード, done|abandoned)`：here は自動で移る。候補は印のない祖先・兄弟に限る。
  1. 親が印なしなら親へ。
  2. そうでなければ、文書順でそれより後ろにある兄弟のうち最初の印なしのものへ。
  3. それも無ければ、さらに上の祖先のうち最も近い印なしのものへ。
  4. 無ければ here なし。
  結果に `here moved to <id>` または `here: none` を書き、Claude が次の `tree_here` を判断できるようにする。
- `tree_mark(here のノード, important)`：印は 1 つしか持てないため here が消える。これは `E_BAD_INPUT`（「先に `tree_here` で移してから」）とする。`none` は here を外すだけ（here なしになる）。
- `tree_mark(here の祖先, done|abandoned)`：here は動かさない（here の仕事が終わったとは限らない）。結果に `note: <id> は here の祖先。here は <here id> のまま` を 1 行添える。Pane では path 上の done はたたまない（§7.2）。
- 人間の編集で here が複数：文書順で最後を採用し、他の印を落とす。ファイルには次にツールが書くときに反映される。
- here がない：エラーにしない。Pane は最上位を展開して表示し、見出しに `here なし` を出す。

## 7. Pane の描画

### 7.1 開閉

- `/tree`（引数なし）でトグル。引数 `e` / `a` の扱いは §7.5.4。開いているかは module 変数で持たず、`await $.ui.panes()` に `id === 'yak-tree'` があるかで判定する（engine の記録が真実で、リロードや人間の操作で閉じた後も正しい。`ref/cc.d.ts` `$.ui.panes`、`UiPane`）。あれば `await $.ui.close({ id })`、なければ `await $.ui.open({ id: 'yak-tree', title: 'yak-tree', rows: 14 })`（`ref/plugins_mods_interface.md`「Open a pane at the right time」、`ref/cc.d.ts` `PaneOpenArgs`）。`ui.close` フックは持たない。
- ユーザー操作で開いた Pane は幅に関わらず表示される（同「When a pane waits for a wider terminal」）。自動では開かない（要件）。
- 配置は engine が決める。fullscreen で 110 列以上なら `dock`（右サイドバー）、それ以外は `inline`（プロンプト上の枠）。`e.props.placement` で判る（`ref/cc.d.ts` `Pane.placement`「the terminal in fullscreen from 110 columns」）。tmux 系や `CLAUDE_CODE_NO_FLICKER=0` では fullscreen にならず常に inline（`ref/cc.d.ts` `CommandPresentation` のコメント）。
- 人間は engine の閉じる印か ctrl+x x で閉じる（`ref/cc.d.ts` `Pane` のコメント）。Esc で閉じるのは `closeOnEscape: true` のときだけで、本設計では付けない。`focus` も付けない。ツリーは読むだけで操作する要素がなく、キーボードはプロンプトに置きたい。

### 7.2 表示モデル（`view.js` の `layout(doc, { bodyColumns, bodyRows }) → { lines, omitted, hereId }`）

`bodyRows` は見出し 1 行を含む総行数。使える行数は `bodyRows - 1`。`omitted` は落とした行数（見出しの `(+N 行省略)` に使う）。

表示する集合 V を次で決める（要件「根から here までの経路とその兄弟。done / abandoned は 1 行にたたむ。important は常に表示」）：

1. `path` = here とその祖先。
2. V に `path` の各ノードと、その兄弟をすべて入れる。
3. V に here の子（次の一手）を入れる。
4. V の各ノードのうち `path` 外のもの（兄弟と here の子）は「たたみ線」として描く：1 行、本文の後ろに `(+N)`。here の子は `done` でなくても子孫を隠して `(+N)` を出す。`path` 上のノードは印が `done` / `abandoned` でもたたまない（たたむと here が隠れる）。
5. たたんだノードの子孫に `important` があれば、たたみ線の直下にその important だけを（深さどおりの字下げで）出す。`(+N)` の N は「たたんだ子孫のうち表示しなかった数」。これで「important は常に表示」と「done はたたむ」が両立する。
6. `path` 上や here の子自身が important なら、そのまま印付きで出る。here の子の下の important は、子の印にかかわらず手順 5 と同じく常に出す（要件「important は常に表示」を優先）。

行の書式（表示モード e。a は §7.5.2）：`{字下げ線}{記号} {本文}{(+N)}`。字下げ線は 1 段につき `│ `（2 列）で、エディタの字下げ線と同じく各段の先頭の列に縦線を引く。
`layout` は字下げ線を `guide`、記号から後ろを `text` に分けて返す。register.js は `guide` を本文の装飾にかかわらず `dimColor` で描き、幅が足りないときは `text` の側だけを切り詰める。

| 状態 | 記号 | 色・装飾 |
|---|---|---|
| here | `▶` | `bold`、`color: 'green'` |
| done | `✓` | `dimColor` |
| abandoned | `✗` | `dimColor` |
| important | `★` | `color: 'yellow'` |
| 印なし | `·` | なし |

（`Text` の `color` はテーマキーか `'red'` のような色名：`ref/plugins_mods_interface.md`「Build a tree from elements」の表。テーマキー名は一次資料に一覧がないので色名を使う。）

### 7.3 幅と高さ

- 幅は `e.props.bodyColumns` を使い、`viewport.columns` は使わない（`ref/plugins_mods_reference.md`「Render sites」）。各行は `Text({ wrap: 'truncate-end' })` で切る（同「Elements」、`ref/cc.d.ts` の `wrap` 候補に `'truncate-end'`）。幅による段階分けはしない。各行は記号や線、時刻の部分と本文の `Text` を横に並べた `Box` にし、それを `Box({ flexDirection: 'column' })` に入れる（行の組み立ては §7.5）。`Markdown` 要素は使わない（切り詰めと記号の制御ができないため）。
- 高さは `dock` / `inline` とも `e.props.scroll.bodyRows`（同「Render sites」、`ref/cc.d.ts` `SiteScroll`）。`focus` を付けないのでスクロールは使えない前提で、見出し 1 行を除いた行数に収まらなければ優先度の低い行から落とす：兄弟（here から遠い順。同距離なら文書順で後ろから。兄弟と一緒にその下の important も落とす）→ たたみ線の下の important → here の子（末尾から）。`path` と here は必ず残す。落とした行数は見出しに `(+N 行省略)` と出す。inline の `bodyRows` は「今見えている行数」なので、`rows: 14` の要求に対して engine が与えた分に合わせる。
- 見出し行：`{ツリーの名前（issue キー、名前、ブランチ名、session 3f2a…）}  {要約} {省略行数}  {モード表示}`（P1 の実装：ファイルがあれば `tree: {スコープ名}`、無ければサンプルで `sample tree (no tree file yet)`。session スコープの名前は `this session`。文言は `i18n.js`。ブランチ名・名前付きの表示は、いまは名前そのまま）。`dimColor` の 1 行で、幅が足りないときは末尾（モード表示）から切れる。
  - 要約は `★N · open N`（ja は `★N · 未着手 N`）。0 の項目は出さず、両方 0 なら要約ごと出さない。数の部分に色は付けない。
  - `★N` はツリー全体の important のノード数で、表示されているかに関係しない。
  - `open N` は印のないノードのうち、here とその祖先を除いた数。まだ手を付けていない戻り先・候補を表す。
  - 集計は純関数 `summarize(doc)`（`views.js`）。将来 `ask` / `question` の印が入ったら、ここに数を足す。
  - モード表示は `mode: e  (/tree e|a)`（ja は `表示: e  (/tree e|a)`）。例：`sample tree (no tree file yet)  ★1 · open 4  mode: e  (/tree e|a)`。`/yak-tree` に逃がしたときは `(/yak-tree e|a)` と、登録できた名前で案内する。

### 7.4 再描画

- データが変わったら `$.ui.invalidate('ui.render')`。10 回/秒（端末で表示中の Pane は 30 回/秒）に間引かれ、連打しても最後の状態で 1 回描かれる（`ref/plugins_mods_reference.md`「Limits」、`ref/plugins_mods_interface.md`「How often a site can redraw」）。
- 端末幅の変化と props の変化では engine が勝手に再描画する（同「When Claude Code redraws without being asked」）。
- `ui.render` フックは `e.requestId !== 'yak-tree'` なら `next(e)` で他 Mod の Pane を邪魔しない（同「Pick where to draw」）。
- `e.props.view.agentId` が付いているとき（人間が tasks 一覧からサブエージェントの transcript を見ている）も同じツリーを描く。ツリーはメインの作業の地図なので切り替えない。

### 7.5 表示モード（`views.js` の `renderView(mode, ui, doc, ctx)`）

表示する行の選び方と `(+N)`、高さへの当てはめは §7.2・§7.3 のまま（`views.js` は `view.js` の `selectRows` / `layout` を使う）。モードは行の書式と装飾だけを変える。
どのモードも、各行の本文を 1 `Text`（`wrap: 'truncate-end'`）にして本文側だけ切り詰める。時刻の `Box` は `flexShrink: 0` で、幅が足りなくても切らない。

#### 7.5.1 e（アウトライナー風）

- 行の書式：`{▎ か空白 2 つ}{│ を深さの数}{記号} {本文}` を左に、`{(+N) }{hh:mm}{ · 経過}` を右端に出す（`justifyContent: 'space-between'`）。
- `▎` は here と `path` の行だけに付け、`color: 'green'`。字下げ線 `│ ` は `dimColor`。
- 記号と色は §7.2 の表のとおり。右端は `dimColor`。here の行だけ時刻の前に経過時間を `(47m) ` の形で付ける。時刻が右端の同じ列にそろうように、`(+N)` と経過時間はどちらも時刻の前に置く。

#### 7.5.2 a（git のグラフ風）

- 行の書式：`{ }{枝}{記号}{ 本文}{(+N)}` を左に、`hh:mm` を右端に出す。枝は深さ 1 段につき 2 列で、後ろに同じ深さの兄弟があれば `├─`（祖先の段は `│ `）、なければ `└─`（祖先の段は空白 2 つ）。枝は `dimColor`。
- 「後ろに同じ深さの兄弟があるか」は、高さのために行を落とす前の全行（`selectRows` の結果）で判定する。落とした兄弟がいても `├─` になる。
- たたみ線の下の important は、たたんだ行（所有者）の 1 つ下の深さの行として枝を引く。表示されない親を指す枝にはしない。
- 記号：done `◉`、here `●`、印なし `○`、abandoned `✗`、important `★`、`path` 上の祖先 `◎`。色と装飾は §7.2 の表と同じ。
- here の行は本文の後ろに `  ◀ here 47m`（`bold`・`green`）を付ける。

#### 7.5.3 時刻と経過時間

- 行の `hh:mm` と here の経過時間は仮の値。ファイル形式に時刻が入るまでは、サンプルだけに出す。サンプルの時刻は `SAMPLE_TIMES`、経過時間は module を読み込んだ時刻の 47 分前に here になったものとして数える。実ファイルのツリーには時刻も経過時間も出さない（`renderView` に `times: {}` を渡し、`hereElapsedMs` を渡さない。e は右端が空、a は `◀ here` だけになる。P1 で決定）。ファイル形式に時刻が入ったら差し替える。
- 経過時間は `47m`、1 時間以上は `1h05m`。サンプルを描いているあいだ、here の経過時間は 2 秒ごとの poll（§8.1）が分の変わり目で `$.ui.invalidate` して進める（専用の 60 秒タイマーは持たない）。

#### 7.5.4 モードの選び方と保存

- `/tree e`・`/tree a`：選んだモードを `$.store.set('view', mode)` で保存する。Pane が閉じていれば開き、開いていれば再描画だけする。引数なしの `/tree` は従来どおり開閉のトグル。
- 不正な引数（`/tree x`、`/tree c` を含む）：何も変えず（開閉も保存もしない）、`$.ui.toast` で `unknown view 'x'; use /tree e or /tree a` と知らせる（`/yak-tree` に逃がしたときは `/yak-tree e or /yak-tree a`）。toast は `ref/cc.d.ts` の `$.ui.toast` で確認できる。
- 起動時（`session.start`）の優先順位：`$.store` の `view`（e / a のときだけ有効。c など他の値は無効）→ userConfig の `view` → `e`。`config.js` の `resolveOptions` が userConfig の `view` を検証し、e / a 以外は `e` にする。
- 現在のモードは module 変数に持つ（`$.state` は使わない。§8.2）。モジュールのリロードでも `session.start` が再び走るので、保存値から復元される。

## 8. ファイルの定期確認と状態の持ち方

### 8.1 定期確認（読むだけ）

- `session.start` で `$.clock.every(2000, poll)`。モジュールのリロードでタイマーは止まり、`session.start` が再度走るので作り直される（`ref/mods_api.md`「Stop background work」、`ref/plugins_mods_reference.md`「Session」）。二重起動を避けるため module 変数に timer を持ち、作る前に `cancel()` する。
- `poll()`：
  0. 実行中フラグが立っていれば何もしない（前回の poll が git や read で詰まっているとき重ねない）。立てて始め、`finally` で下ろす。
  1. `session.start` の最初の 1 回と、その後は 5 回に 1 回 `resolveScope`（register.js の `lookupScope`）を呼ぶ（git 実行を 10 秒に 1 回に抑える）。`$.session.id/repo/cwd`、`$.env.get('HOME')`、`git branch --show-current`、`git symbolic-ref --short refs/remotes/origin/HEAD`、`$.store.get('promoted:<id>' / 'sessionPath:<id>')`（読むだけ）から `scope.js` の `resolveScope` に渡す。git の失敗は空のブランチ（session スコープ）。パスが変わったら `(mtimeMs, size)` のキャッシュと前のツリーを捨てて読み直す（新しいファイルが読めないあいだ、前のツリーを新しい見出しで出さないため）。
  2. `await $.fs.stat(path)` → `{ mtimeMs, size }` をキャッシュと比較（`ref/cc.d.ts` `FsStat`）。`ENOENT` は「ファイルなし」状態に。
  3. 変わっていれば `await $.fs.read` → `parseTree` → キャッシュ更新 → `$.ui.invalidate('ui.render')`。
  4. 表示：ファイルがあればそのツリー、**無いときだけ**組み込みのサンプルを描く（2026-10-15、ユーザー決定）。ファイルが後から現れたらサンプルから実ツリーに、消えたらサンプルに戻る。stat が ENOENT 以外で失敗した（権限など）ときは直前のツリーを残し、デバッグログに残す。ファイルが無いとき `$.fs.stat` は reject し、メッセージに `ENOENT: no such file or directory` が入ることを実機で確かめた（2026-10-15。`err.code` に入るかは未確認なので、`isMissingError` は code とメッセージの両方を見る）。
- poll はファイルを書かない（§4.4）。
- タイマーのコールバックはイベントの外で走り、throw してもデバッグログに出て次回また走る（`ref/mods_api.md`「Run work in the background」）。`try/catch` で包み、失敗は `$.ui.log(msg, { to: 'debug' })` に残す（`ref/mods_troubleshoot.md`「Read the debug log」）。
- Pane が閉じていても stat だけは続ける（2 秒に 1 回の stat は安い）。read は変化時だけ。
- `classic.FileChanged` は使わない。設定フックの `FileChanged` の `matcher` は作業ディレクトリ内のファイル名リテラルしか監視せず（`ref/hooks.md`「FileChanged」）、作業ディレクトリ外の絶対パスに必要な `watchPaths` を mod から返して watcher が動くかは未確認のため。

### 8.2 状態

| 値 | 置き場 | 理由 |
|---|---|---|
| parse 済みツリー、`(mtimeMs, size)`、`issues`、スコープ、ターン内カウンタ、poll 実行中フラグ、書き込みキュー（§11）、tmp 名カウンタ | module 変数 | リロードで消えてよい。消えても次の poll で復元できる |
| `promotedCache[sessionId]`、`sessionPathCache[sessionId]` | module 変数＋`$.store`（`promoted:<sessionId>`、`sessionPath:<sessionId>`） | `/clear` `/branch` で ID が変わっても昇格先と session ツリーを引き継ぐため両方に持つ（§3.2） |
| 表示モード（e / a） | module 変数＋`$.store`（`view`） | 選んだモードを次のセッションでも使うため。起動時に `$.store` から読み戻す（§7.5.4） |
| 直前のセッション ID | module 変数（`session.end` で控える） | `classic.SessionStart` でのキー引き継ぎに使う |

`$.state` を使わない理由：`$.state` は `/clear` でリセットされ、型宣言ファイルと manifest の `types` が要る（`ref/plugins_mods_interface.md`「Keep state」「Declare the values」）。描画の元データはファイルで、再読込で復元できるので、反応的な状態管理の利点が小さい。

## 9. `turn.complete` の警告

```
turn.start   (agentId なし)       → toolCalls = 0, treeWritten = false
tool.call    (agentId なし, tool が mcp__yak-tree__ 以外) → toolCalls += 1
tool.call    (tree_add/here/mark/edit/promote が成功)      → treeWritten = true
turn.complete:
  r = await next(e)
  if e.agentId || e.isAborted || e.reason !== 'answer' → return r
  if treeWritten || toolCalls < warnAfterToolCalls(既定 3) → return r
  scope = await resolveScope()
  if scope.kind === 'session' && !(await $.fs.exists(scope.path)) → return r   // まだ木を始めていないセッションでは黙る
  return { ...r, text: `yak-tree: このターンでツールを ${toolCalls} 回使ったがツリーは未更新（tree_* の書き込み）` }
```

- カウント用の `tool.call` フックは各ツールの処理フックより先に `on` する（§5）。

- 数えるのは全ツール（読み取り専用も含む）。しきい値 `warnAfterToolCalls` は userConfig で変更可。
- issue スコープと名前付きスコープではファイルが無くても出す（そのツリーで作業している以上、木を始めるべき）。session スコープでファイルが無いときは出さない。ブランチスコープの扱いは未決（暫定：session と同じ＝ファイルが無ければ出さない。2026-10-05、P3 で決める）。
- `tool.call` のカウントは `next(e)` の前に行う（フック自身は観察のみ。`ref/mods_events.md`「Observe an event」）。拒否された呼び出しも「使おうとした」として数える。
- `tree_read` は書き込みではないので `treeWritten` にしない。
- バックグラウンドのサブエージェントの `turn.complete` は `agentId` 付きで来るので無視する（§1.3）。
- 中断（`isAborted`）や API エラーでは出さない。人間が止めたターンに警告を重ねるのは煩い。
- 一次資料上の注意：`turn.start` は「サブエージェントの実行では発火しない」（`ref/cc.d.ts` `TurnCompleteFields.turnId` のコメント）。メインの `turn.start` でだけリセットすれば、サブエージェントの活動でカウンタが乱れない。
- `ui.status`（プロンプト下の常駐 1 行）は使わない。要件は「回答の下に 1 行」であり、常駐させると消すタイミングの設計が要る。

## 10. `tree_promote(name)` の挙動

前提：ブランチ名から issue キーが取れていないこと（`issueKeyPattern` が一致するブランチにいれば `E_BAD_INPUT: on issue branch <ISSUE>; promote is not needed`）。引数は issue キーに限らず任意の名前（2026-10-05 更新。旧：`tree_promote(issue)`）。

1. `name` を検証（§3.1 の文字種。パス区切りや `..` は `E_BAD_INPUT`）。
2. 昇格先 `<base>/<repo>/<name>.md` が `await $.fs.exists` で既にあれば `E_EXISTS`。統合は人間が手で行う（マージ規則を Mod に持たせない）。
3. session ファイルが無ければ（まだ何も書いていない）、記録だけ行う（手順 5）。
4. あれば `await $.process.run(['mv', '-n', src, dst])`。成功の判定は `exitCode === 0 && (await $.fs.exists(dst)) && !(await $.fs.exists(src))` の 3 条件。macOS の `mv -n` は移動先が既にあると何もせずに exit 0 で終わる（実測）ので、exitCode だけでは判定できない。満たさなければ `E_IO`（src が残っていて dst もあれば「昇格先が先に作られた」旨を添える）。`-n` は手順 2 と手順 4 の間に誰かが作った場合の上書きを防ぐ（`$.fs` に rename / delete はない：`ref/plugins_mods_reference.md`「Mods API methods」の `$.fs` 行）。
5. `promotedCache[sessionId] = name` と `await $.store.set('promoted:' + sessionId, name)`。以後このセッションは名前付きスコープ（ブランチから issue キーが取れればそちらが優先。§3.2）。
6. キャッシュを捨てて再読込、`$.ui.invalidate`。
7. 結果：`ok promote <name>` と新パス。

## 11. 同時書き込み（人間の編集とツール）

### 11.1 書き込み手順（全ツール共通、`tree_read` の ID 補正も同じ）

module 変数 `writeChain`（Promise）に `.then` でつないで直列化する。同じターン内で Claude が複数の `tree_*` を並列に呼んでも、poll の read と重なっても、書き込みは 1 件ずつ進む。

```
async writeThrough(mutate, { readOnly }):                     // キューに入ってから呼ばれる
  scope  = await resolveScope()                                 // パスの確定はキューの中で
  path   = scope.path
  for attempt in 1..3:
    before = await $.fs.stat(path).catch(() => null)          // null = まだ無い（ENOENT 以外の失敗は E_IO、リンクも E_IO）
    text   = before ? await $.fs.read(path) : ''
    doc    = parseTree(text); out = serializeTree(mutate(doc))
    if readOnly || out === text || (!before && mutate は tree_read の補正のみ):
      return doc                                                // 変化なし／ファイル無しの tree_read／サブエージェントの tree_read は書かない
    tmp    = `<path のディレクトリ>/.tmp/<乱数 12 文字>.tmp`
    await $.fs.write(tmp, out)
    now    = await $.fs.stat(path).catch(() => null)
    if (sameStat(before, now)):                                 // 読んでから誰も書いていない
      r = await $.process.run(['mv', '-f', tmp, path])
      if r.exitCode !== 0 → E_IO
      cache を更新、$.ui.invalidate → return
    // 外部変更があった。tmp は捨てて読み直す
  → E_CONFLICT
```

- `$.fs.write` は原子的でなく、書きかけを他プロセスが読める（`ref/plugins_mods_reference.md`「Mods API methods」の `$.fs` 行）。エディタや別セッションの poll に書きかけを見せないため tmp + `mv` にする。`mv` は `$.process.run` の argv 形式で、シェルを介さない。同一ファイルシステム内なので rename になり原子的。
- 注意：`mv` は `path` がシンボリックリンクなら、リンク先ではなくリンクそのものを実ファイルで置き換える。ツリーファイルをリンクにしない。
- tmp 名にカウンタと乱数を入れるのは、直列化しても再試行や別セッションと同名にならないようにするため。失敗した tmp は `$.fs` では消せないので、`mv` 失敗時に `$.process.run(['rm', '-f', tmp])` で片付ける（単一の一時ファイルの削除であり、再帰削除ではない）。

### 11.2 残る競合と割り切り

| 状況 | 結果 | 対処 |
|---|---|---|
| ツールが読んだ後、`stat` を取り直すまでに人間が保存 | 検知して読み直し、人間の変更の上にツールの変更を載せる（最大 3 回） | 3 回とも外れたら `E_CONFLICT`。Claude は `tree_read` からやり直す |
| `stat` の取り直しから `mv` までの数 ms に人間が保存 | **人間の変更が消える**（ツール版が上書き） | 窓が極めて短いので受け入れる。`$.fs` に排他的作成がなく、確実なロックは作れない |
| エディタが未保存の古い内容を保持したまま、ツールが書き込み、その後エディタが保存 | ツールの変更がまとめて消える | VS Code は外部変更を検知して再読込／衝突警告を出す。これに頼る。設計で防げない |
| 2 つの Claude セッション（同 issue の worktree）が交互に書く | here が取り合いになる | 最後に書いた方が勝つ（既知の制約）。見出しに他セッションの書き込みを示す手段はない（未対応） |
| ツールの書き込みと poll の read が同時 | poll が書きかけを読むことはない（`mv` が原子的） | poll は次回の stat で新しい内容を拾う |

## 12. テスト方針

`claude plugin test` は dir 以下の `*.test.ts` をすべて実行し、`claude-code/testing` 以外の import（`node:test` など）を拒否する。そのため node:test の単体テストは `tests/unit/*.spec.ts`（`npm test`）に置き、`*.test.ts` は `claude plugin test` 専用にする（2026-10-05、P0 で確認）。

出典：https://code.claude.com/docs/en/plugins/mods/test （2026-10-05 取得）、`ref/mods_create.md`「Test the mod」。

### 12.1 層

| 層 | 対象 | 道具 |
|---|---|---|
| 純関数 | `tree.js`（parse / serialize / 操作）、`view.js`（表示モデル）、`scope.js` | `claude plugin test` の `test()` 内で直接 import（テストファイルは mod 自身のファイルを import できる）。`node` でも動く純 ESM にしておき、Mod の機構が止まっていても回せるようにする（§15 の経験から） |
| フック | `register.js` の各フック | テストキットの `$`（`$.session.start`、`$.tool.call`、`$.command.run`、`$.turn.start`、`$.turn.complete`、`$.classic.SessionStart`）と `on` によるスタブ |
| 描画 | `ui.render`（Pane） | `$.ui.mount({ component: 'Pane', requestId: 'yak-tree', props: { bodyColumns, placement, scroll, ... }, surface })` → `ui.find({ type: 'Text', text: /▶ .../ })` |
| タイマー | poll | `mock.clock(on)` → `clock.advance(2000)` |
| 実機 | 配置、色、幅、ホットリロード、`CLAUDE_CODE_PLUGIN_DIRS` | 手動。herdr 内の VS Code ターミナルで `claude --plugin-dir` と `--debug-file`。描画テストは「木が妥当か」だけで見た目は検証しないと明記されている |

### 12.2 スタブの対応表（本 Mod が呼ぶもの）

| 呼び出し | スタブ |
|---|---|
| `$.tool.register`、`$.command.register`、`$.ui.open`、`$.ui.close`、`$.ui.log`、`$.store.set` | `() => ({ value: undefined })`（`ui.open` は `{ value: { isPlaced: true } }`） |
| `$.ui.panes` | `() => ({ value: [] })` または `[{ id: 'yak-tree', ... }]` でトグルの両側を試す |
| `$.fs.stat` | メモリ上の `Map<path, { text, mtimeMs }>` から `{ value: { kind: 'file', size, mtimeMs, isLink: false } }`、無いときは `{ deny: 'ENOENT' }` |
| `$.fs.read` / `$.fs.write` / `$.fs.exists` | 同じ Map で応答。`e.path` は絶対パスで来るので `endsWith` で比較 |
| `$.process.run` | `e.argv` が `git branch ...` なら `{ value: { exitCode: 0, stdout: 'PAD-193/design\n', stderr: '' } }`、`mv` なら Map 内で移す（`-n` で移動先が既にあるときは macOS の実測どおり exitCode 0 で何もしない）、`rm` なら消す |
| `$.session.id` / `$.session.cwd` / `$.session.repo` / `$.env.get` / `$.store.get` | 固定値（`repo` は `{ root: '/w/my-repo', remote: null, internal: false, name: null }` か `null`） |
| `session.start` / `turn.start` / `turn.complete` / `tool.call` / `classic.SessionStart` / `session.end` の `next` 先 | `{ cwd }` / `{ turnId }` / `{ text: '' }` / `{ result: 'ok' }` / `{}` / `{ sessionId }` |

規則：スタブは最初の `$` 呼び出しの前に全部登録する。`session.start` は自動では走らないので明示的に発火する。各テスト 5 秒制限。

### 12.3 主なテストケース

1. parse：ID なし／重複／規定外、here 複数、`*` 箇条書き、冪等性。字下げは 2 スペース・3 スペース・4 スペース・タブ・混在のそれぞれで同じ木になること。
2. 往復不変：散文行、コードフェンス（内側の `- ` 行がノードにならない）、本文中や付随行の HTML コメント、先頭の見出しが、parse → serialize で位置も内容も変わらないこと。
3. 操作：add（最上位／子／`here: true`）、here の付け替え、`tree_here` が done / important のノードを指すと `E_BAD_INPUT`、here ノードを done にしたとき印なしの親へ移る／親が done なら後続の印なし兄弟へ／親が important で兄弟も無ければさらに上の印なし祖先へ／無ければ here なし（移動先の印が消えないこと）、here の祖先を done にしても here は動かず注意が 1 行返る、important を here に付けると `E_BAD_INPUT`、`none` で印が外れる、edit で印と ID が保持される。
4. ID の持続：ID の無い行を含むファイルに `tree_read` → 返った ID で `tree_here` がそのまま通る（E_NOT_FOUND にならない）。`tree_read` の後にファイルが補正済みで書かれている。
5. scope：`issueKeyPattern` 設定済みでブランチ `PAD-193/design` → issue、未設定なら同じブランチでもブランチスコープ、`main` → session、`feature/x` → ブランチ（パスは `branches/feature_2fx.md`）、origin/HEAD が `develop` なら `develop` → session で `main` → ブランチ、git 失敗（ブランチ空）→ session、`repo` が null → `_nogit`、`promoted` あり＋`main` → 名前付き、`promoted` あり＋パターン一致のブランチ → issue（ブランチ優先）。
6. `/clear` 後の引き継ぎ：`session.end({ sessionId: A })` → `classic.SessionStart({ source: 'clear' })` の後、`$.session.id` が B を返す状態で `promoted:B` が store に書かれ、スコープが issue のまま。promote していない session スコープでは `sessionPath:B` に A のパスが記録され、B の `tree_read` が A のツリーを返す。`source: 'resume'` ではコピーが起きず、B のキーだけを読む。
7. フック：`session.start` でツール 6 つと `/tree` が登録される（`/tree` が reject したら `/yak-tree`）。書き込み系が `agentId` 付きで deny、`tree_read` は `agentId` 付きでも通り、そのとき `fs.write` が呼ばれない。登録順：`tree_add` を呼んだ後に `turn.complete` を発火し、`tree_*` 以外のツール呼び出しが `toolCalls` に数えられ `tree_*` が数えられていないこと（カウントフックがツール処理より先に走っている証拠）。`turn.complete` が警告を出す／出さない（しきい値未満、tree_* 呼び出し後、`isAborted`、サブエージェントのターン、session スコープでファイル無し、issue スコープでファイル無し）。
8. 同時書き込み：`tree_add` を 2 件 `await` せずに同時に呼ぶ → 両方のノードが残る。`tree_add` の最中に `clock.advance(2000)` で poll を走らせる → 書きかけを読まず、両方の結果が整合する。`tree_promote` と `tree_add` を同時に呼ぶ → add のノードが昇格先のファイルに入る（旧パスに書かれない）。
9. 外部変更時の再試行：`fs.read` のスタブで「1 回目の read の後に Map の内容と mtime を変える」→ ツールが読み直して人間の行とツールの行の両方が残る。3 回連続で変えると `E_CONFLICT`。
10. poll：`mock.clock` で 2 秒進めると `fs.stat` が呼ばれ、mtime を変えると `fs.read` → 再描画。変えなければ `fs.write` は一度も呼ばれない。
11. 描画：幅 80 / 30、`bodyRows` 5 と 20 のときの行の落とし方と見出しの省略表示、here なし、たたみ線の下に important だけ出て `(+N)` が表示しなかった数になる。
12. promote：issue ブランチで `E_BAD_INPUT`、昇格先ありで `E_EXISTS`、session ファイル無しで記録だけ、通常は `mv -n` と記録。手順 2 と 4 の間に昇格先が作られたケース（`mv -n` スタブが exit 0 で何もしない）で `E_IO` になり src が残る。

## 13. 実装の段階分け

| 段階 | 内容 | 完了条件 |
|---|---|---|
| P-1 動作確認 | この環境で Mod が動くことの確認 | 対話セッションの `/plugin` に「mods active」行が出る。試作（§15）の `claude plugin test` が 1 本通る |
| P0 最小版 | `plugin.json`、`hooks.json`、`register.js`。`/tree` で Pane を開閉し、固定のサンプルツリー（家の鍵を探す例。元記事のリスト 2 と同じ形で、試した場所、いま調べている所とその下の疑問、次の候補、別案、見つけた場所の下の important、やめた案を含む。本文は `i18n.js`、構造と id と時刻は `views.js`）を §7 の記号で描く。`claude plugin validate` が通る | 実機で Pane が出る。fullscreen レイアウトなら幅を変えると dock / inline が切り替わるのを目で見る（herdr が fullscreen になるかをここで確かめる）。`CLAUDE_CODE_PLUGIN_DIRS` でも読み込める |
| P1 読むだけ（実装済み、PAD-196） | `scope.js`、`tree.js` の parse、`poll.js`、register.js の `lookupScope` と poll、実ファイルの描画（ファイルが無いときだけサンプル。実ツリーに時刻は出さない） | 手でファイルを編集すると 2 秒以内に Pane が変わる。`claude plugin test` の poll / scope のテストと、実機（2026-10-15、herdr。ファイルなし→サンプル、作成→実ツリー、編集→2.5 秒後に反映、モード a、削除→サンプル）で確認 |
| P2 書く（実装済み、PAD-196） | `tree_add` / `tree_here` / `tree_mark` / `tree_edit` / `tree_read`、直列化と再試行つきの書き込み手順、`tree_read` の ID 補正書き戻し、エラー | Claude に作業させるとツリーが育つ。人間の編集と交互に行っても壊れない。§12.3 の 4・8・9 が通る。`claude plugin test` と、実機（2026-11-12、`claude -p --plugin-dir`。add 3 回、here、mark done で here が親へ移る、read）で確認 |
| P3 忘れ対策 | `turn.start` / `tool.call` / `turn.complete` の警告、userConfig | ツリー未更新のターンで 1 行出る。サブエージェントのターンでは出ない |
| P4 仕上げ | `tree_promote`、`/clear` 後の引き継ぎ、見出しの issues 表示、行の省略 | §12.3 のケースが全部通る |
| P5 実験 | `$.ui.scroll` で here を見える位置へ | 動けば行の省略を緩められる。動かなくても困らない |

Desktop app は対象外とする。`$.process` は「CLI only」（`ref/cc.d.ts` `process` 名前空間のコメント）で、git と `mv` に依存する本設計は Desktop では動かない。要件の環境（VS Code 統合ターミナル内の herdr）は CLI なので問題ない。

各段階で `claude plugin validate` と `claude plugin test` を回し、デバッグログ（`claude --debug-file ./mod-debug.log --plugin-dir .`）を確認する。

## 14. 決定事項とレビュー対応

### 14.1 ユーザーの判断（2026-10-05）

| # | 論点 | 決定 | 反映箇所 |
|---|---|---|---|
| 1 | here ノードを done / abandoned にしたとき | 自動で親へ。最上位なら次の未完了の兄弟、無ければ here なし。要件書を「here は最大1つ。行き場が無いときだけ0個」に更新 | §6、`docs/requirements.md` |
| 2 | `tree_mark` の `none` | 追加する | §5、`docs/requirements.md` |
| 3 | `tree_add` の `here: true` | 追加する | §5、§6、`docs/requirements.md` |
| 4・5 | 警告の対象と条件 | 全ツールを数える。しきい値の既定 3（userConfig で変更可）。session スコープでファイルが無ければ出さない。issue スコープでは無くても出す | §9、`docs/requirements.md` |
| 6 | `/tree` 衝突時 | 代替名 `/yak-tree`、`try/catch` は残す | §1.1 |
| 7 | サブエージェント | 書き込み系は deny、`tree_read` は許す。`agent.spawn` による間接策は削除 | §1.4、§5 |
| 8 | promote 記録とブランチの優先 | issue 形式のブランチではブランチ優先。promote は issue ブランチでないときの手段 | §3.2、§10 |
| 9 | 印の表記 | 行頭 `__here__` を正規形とする | §4.1 |
| 削減 | §1.4 補助案、同名リポジトリ対策のハッシュ、userConfig `baseDir`、`lastHere` キャッシュ、幅 3 段階、promote 先が既にあるときのマージ、FileChanged 実験、字下げの正規化書き戻し | すべて削除 | 各節 |

### 14.2 設計レビュー（Opus reviewer）への対応

| ID | 指摘 | 対応 | 反映箇所 |
|---|---|---|---|
| H1 | 深さを固定 4 で割ると 2/3 スペースやタブ混在で壊れる | 祖先の実際の字下げ幅と比較して深さを決める。読み取り時は丸めるだけで、正規化はツールが書くときに自然に起きる。字下げ混在をテストに追加 | §4.1、§4.2、§4.3、§12.3-1 |
| H2 | ID 無し行は parse のたびに ID が変わり、`tree_read` の ID が次で `E_NOT_FOUND` になる | ID を Claude に渡すツール（`tree_read` 含む）が、その場で補正済みファイルを書き戻す（`stat` が読んだときと同じなら書く）。P2 に入れ、poll 側の正規化書き戻しは廃止 | §4.4、§5、§11.1、§13 |
| H3 | 並列書き込みの競合 | module 変数の Promise 連鎖で直列化。poll に実行中フラグ。tmp 名にカウンタと乱数 | §8.1、§11.1 |
| H4 | `$.session.*` / `$.store.get` / `$.env.get` は Promise | 擬似コードに `await`。`repo()` が null なら `_nogit` | §0、§3 |
| M1 | 書き込み直前の外部変更 | `mv` の直前に `stat` を取り直し、違えば読み直して最大 3 回（初回＋再試行 2 回）。§11.2 の表で「人間の変更が消える」場合を正確に記述 | §11.1、§11.2 |
| M2 | `/clear` `/branch` でセッション ID が変わり promoted が失われる | module 変数にも持ち、`classic.SessionStart` の clear / fork で新 ID のキーにコピー。`/resume` は未確認と明記 | §1.2、§3.2、§8.2 |
| M3 | inline でも focus なしではスクロールできない | inline でも `scroll.bodyRows` に合わせて優先度の低い行から落とす | §7.3 |
| M4 | Mod が動くことの確認が先 | P-1 を追加 | §13 |
| M5 | important とその祖先の展開 vs done のたたみの矛盾 | たたみ線の下に important だけ出し、`(+N)` は表示しなかった数 | §7.2 |
| M6 | コードフェンスと ID 正規表現 | フェンス内は散文扱い。ID は空白なし 6 文字固定 | §4.1、§4.2 |
| M7 | promote で session ファイルが無い場合、`mv` の結果確認 | 無ければ記録だけ。`mv -n` にして exitCode と `exists` を確認 | §10 |
| L1 | 字下げの正規化書き戻し | 削除（読み取り時は丸めるだけ、ツールが書くときにだけ正規化） | §4.3、§4.4、§8.1 |
| L2 | tmp + mv とシンボリックリンク | 注意書きを追加 | §11.1 |
| L3 | `dup-id` と `no-id` の二重報告 | 1 件に | §4.2 |
| L4 | `paneOpen` 変数と `ui.close` フック | `$.ui.panes()` でトグル判定し、どちらも廃止 | §7.1 |
| L5 | `~` の根拠の記述 | `stat` のコメントと `fs` 冒頭の記述を正確に引用 | §3.1 |
| L6 | 末尾の人間の見出しの後ろに最上位 `tree_add` が並ぶ | 既知の制約として記載 | §4.1 |

### 14.3 再レビュー（別の Opus reviewer）への対応

| ID | 指摘 | 対応 | 反映箇所 |
|---|---|---|---|
| 再高1 | here の自動移動と `tree_here` で移動先の done / important が消える | 方針 (a)：自動移動の候補は印のない祖先・兄弟に限り、無ければ here なし。`tree_here` で印付きノードを指したら `E_BAD_INPUT`。親が done / important のケースをテストに追加 | §6、§12.3-3 |
| 再高2 | `tool.call` フックの登録順が未記載。ツール処理が `next` を呼ばず打ち切るので後から `on` したフックが走らない | `agentId` 拒否は各ツール処理の共通前処理に一本化し、正規表現マッチャのフックを削除。カウントフックはツール処理より先に `on` すると明記し、登録順のテストを追加 | §1.4、§5、§9、§12.3-7 |
| 再中1 | path 上の done 祖先がたたまれ here が隠れる | path 上は done でもたたまない。祖先を done / abandoned にしても here は動かさず、`tree_mark` の結果に注意を 1 行返す | §6、§7.2 |
| 再中2 | サブエージェントの `tree_read` の書き戻しが「サブエージェントは書かない」に反する | (a) `agentId` 付きの `tree_read` は書き戻さない。返す ID の有効性保証はメインに限ると明記 | §1.4、§4.4、§5、§11.1 |
| 再中3 | `resolveScope` がキューの外 | `writeThrough` の冒頭（キューの中）へ。promote と add の同時呼び出しをテストに追加 | §3.2、§5、§11.1、§12.3-8 |
| 再中4 | `/resume` でも promoted をコピーしていた | コピーは clear / fork のときだけ。resume は新 ID のキーを読むだけ | §3.2、§12.3-6 |
| 再中5 | macOS の `mv -n` は移動先が既にあると exit 0 | 判定に `!(await $.fs.exists(src))` を加える。テストのスタブも exit 0 で何もしない形に | §10、§12.2、§12.3-12 |
| 再中6 | `requirements.md` が決定前のまま | ツール一覧、忘れ対策、再描画上限、未確認 4 点を更新。§14.1 の反映先に追加 | `docs/requirements.md`、§14.1 |
| 再低1 | 対応表に L1 が無い | 追加 | §14.2 |
| 再低2 | 警告文の括弧 | 「tree_* の書き込み」に | §9 |
| 再低3 | 変化なし／ファイル無しの `tree_read` でも書いていた | 擬似コードに「書かずに返す」を追加 | §11.1 |
| 再低4 | `/clear` 後に session ツリーが旧 ID のファイルに残る | clear / fork で旧パスを `sessionPath:<newId>` に記録して引き継ぐ（コピーしない） | §3.2、§8.2、§12.3-6 |
| 再低5 | 正規表現フックに関する指摘 | 再高2 で当該フックを削除したため不要 | — |

### 14.4 実装中の判断（2026-10-05、ユーザー承認）

| # | 論点 | 決定 | 反映箇所 |
|---|---|---|---|
| 1 | `tree_add` / `tree_edit` の本文が `__done__ ` など印の記法で始まる、`<!--` から `-->` までを含む、改行を含む | `E_BAD_INPUT`（再 parse で印や ID に解釈されるため） | §5 |
| 2 | git リポジトリ外で issue スコープ | `<base>/_nogit/<ISSUE>.md`（2026-10-05 の PAD-197 で `_nogit/<name>.md` に一般化。§14.5） | §3.1 |
| 3 | `layout` の返り値 | `{ lines, omitted, hereId }`。`bodyRows` は見出し 1 行を含む | §7.2 |
| 4 | here の子の子孫 | done でなくても隠して `(+N)`。important は常に表示 | §7.2 |
| 5 | 行を落とす同順位 | here から同じ距離なら文書順で後ろを先に。兄弟と一緒にその下の important も落とす | §7.3 |

### 14.5 公開可能化（2026-10-05、PAD-197、ユーザー指示）

目的：他の人がすぐ使える状態にする。配布は「自分専用」から「公開」に変わった（`docs/requirements.md` の「配布」。公開は P2 の完成後。2026-11-12 更新）。

| # | 論点 | 決定 | 反映箇所 |
|---|---|---|---|
| 1 | ツリーの単位 | 決定順：issueKeyPattern → 名前付き（promote）→ ブランチ → session。`[A-Z][A-Z0-9]*-[0-9]+` の決め打ちを既定から外す（README の例だけに残す）。既定ブランチは `git symbolic-ref --short refs/remotes/origin/HEAD` を優先し、無ければ main / master | §3.1、§3.2、§12.3-5 |
| 2 | `tree_promote` の引数 | issue キーに限らず任意の名前（英数字・`-`・`_`・`.`。パス区切りと `..` は `E_BAD_INPUT`）。引数名は `name` | §5、§10 |
| 3 | ブランチ名のファイル名化 | 英数字・`-`・先頭以外の `.` 以外を UTF-8 バイトごとに `_xx`。変換後 200 バイト以内で単射。超えたら先頭 182 文字＋`_h`＋SHA-256 先頭 16 桁（PR レビュー対応）。大小文字を区別しないファイルシステムでは大小違いのブランチが同じファイルになる（既知の制約） | §3.1 |
| 4 | 表示の言語 | 人に見える文字列は `hooks/i18n.js` に集約。英語が既定、userConfig `language` が `ja` なら日本語。ツールの description は英語のみ | §2、`docs/requirements.md` |
| 5 | userConfig | `issueKeyPattern`（既定なし）、`language`（`en`、`ja`）、`warnAfterToolCalls`（既定 3、min 1）。値は `register(on, options)` の `options`。未設定のキーが `options` に無いのか空文字なのかは未確認（推測：無い）なので、`config.js` は両方を未設定として扱う | §2、`hooks/config.js` |
| 6 | 公開用の文書 | LICENSE（MIT）、README.md（英語）、README.ja.md、plugin.json に displayName / homepage / repository / license / keywords。サンプルのツリーと見出しは特定の issue に見えない日常の例に（language が ja なら日本語、それ以外は英語） | §2 |
| 7 | 暫定（P3 で決める） | `turn.complete` の警告で、ブランチスコープでファイルが無いときに出すか。暫定は session と同じ（出さない） | §9 |

### 14.6 P1 読むだけ（2026-10-15、PAD-196。1 と 2 はユーザー決定、3 と 4 は実装中の判断）

| # | 論点 | 決定 | 反映箇所 |
|---|---|---|---|
| 1 | サンプルをいつ出すか | ツリーのファイルが無いときだけ。ファイルがあればそのツリー。見出しでどちらかが分かるようにする（`sample tree (no tree file yet)` / `tree: {スコープ名}`） | §7.2、§8.1 |
| 2 | 実ファイルの時刻 | ファイル形式に時刻が入るまで、実ツリーには `hh:mm` も here の経過時間も出さない。時刻はサンプルだけ | §7.5.3 |
| 3 | サンプルの経過時間を進める仕組み | 60 秒タイマーをやめ、2 秒の poll が分の変わり目で再描画する（タイマーを 1 本に保つため） | §7.5.3 |
| 4 | テストでできないこと | `claude plugin test` では userConfig の値をテストから渡せないので、`issueKeyPattern` つきのスコープ決定は `scope.spec.ts`（純関数）で確かめ、フックのテストは `issueKeyPattern` 未設定の経路を確かめる | §12 |

### 14.7 P2 書く（2026-11-12、PAD-196。実装中の判断）

| # | 論点 | 決定 | 反映箇所 |
|---|---|---|---|
| 1 | tmp の置き場所と名前 | ツリーのファイルと同じディレクトリの `.tmp/`。`/clear` で引き継いだ session ファイルのように `<base>/<repo>/` の直下でないパスでも、同じファイルシステム内の rename になる。名前は乱数 12 文字だけにする（ブランチ名は 200 バイトまであり、セッション ID などを足すとファイル名の上限 255 バイトを超えうる） | §11.1 |
| 2 | `tree_read` が書き戻す条件 | `issues`（ID の欠落・重複、複数の here）があるときだけ。字下げだけが違うファイルは書き換えない（§4.4「読むだけでは直さない」） | §5 |
| 3 | ツールを登録できないとき | 1 つずつ `try/catch` で登録し、断られてもデバッグログに残して続ける。`/tree` と poll は動く | §5 |
| 4 | 書き込み後の Pane | 次の poll を待たず、書いた内容で再描画する。poll の署名は未確認に戻し、次の poll にファイルを読み直させる（`mv` の直後に人が保存した内容を見落とさないため）。poll が読んでいる最中やスコープを判定している最中にツールが書いたら、poll はその回の結果を捨てる（古い内容で Pane を上書きしないため） | §8.2 |
| 5 | ツールのフックが投げたとき | `.catch` で `E_IO` の deny を返す。`next` には流さない | §5 |
| 6 | 書き出し後の大きさ | 4 MiB を超えるなら書かずに `E_TOO_LARGE` | §5 |
| 7 | 受け付けない入力 | 本文の U+2028 / U+2029（改行と同じく、次の parse でノードでなくなる）、文字列でない本文、真偽値でない `here` は `E_BAD_INPUT`。ツリーのファイルがシンボリックリンクなら `E_IO`（`mv` がリンクそのものを置き換えるため） | §5、§11.1 |
| 8 | CRLF のファイル | 行末の `\r` を落として読む。ツールが書くと LF にそろう | §4.2 |
| 9 | P2 に入れないもの | `tree_promote`（P4）。ツールの説明にも書かない | §13 |

## 15. 試作で確認したこと（scratchpad、リポジトリには入れない）

場所：セッション用の一時ディレクトリ（リポジトリ外）の `task-tree-proto/`（`task-tree` は旧名。セッション終了で消える。必要なら P0 の出発点としてコピーする。試作のパーサは固定 4 スペース割りのままで、H1 の方式には未更新）

- `claude plugin validate .` → `Validation passed`。検出されたフック：`session.start, command.run{command=tree|task-tree}, tool.call{tool=mcp__task-tree__tree_add}, tool.call, turn.start, turn.complete, ui.render{component=Pane}`。呼び出し：`$.command.register, $.tool.register, $.ui.close, $.ui.open, $.ui.resolve`。`try/catch` での代替名登録、配列マッチャ、`tool.call` の二重登録（マッチャあり＋なし）が静的解析を通ることを確認。
- `tree.js`（parse / serialize）を `node` で実行：ID なし 3 行・重複 1 行・here 2 つ・字下げ飛び 1 行・タブ字下げの散文行を含む入力で、`issues` が期待どおりに出て、書き出し後の再パースで `issues` が空、`serialize(parse(out)) === out`（冪等）。
- `claude plugin test` は、この時点では実行できなかった。`hooks modules are turned off in this process: the rollout switch was saved off by an earlier session and is not refreshed yet. Start claude once with network access, then run the tests again` と出た。`ref/mods_troubleshoot.md`「Check whether mods can load」ではこのメッセージは「Anthropic が遠隔で mod を無効化している」に分類されるが、本文は「前のセッションが保存した値が未更新」と言っており、対話セッションを 1 回起動すれば更新される可能性がある。その後、対話セッションを起動したあとは `claude plugin test` が動くようになった（P0 以降は毎回実行している）。

### 15.1 敵対的検証（別エージェント、2026-10-05）

§1 の 8 件の断定を verifier サブエージェントに反証させた。結果：§1.2〜§1.3、`$.fs` の性質、Pane の配置、`turn.complete` の `{ text }`、`watchPaths` の型は支持。§1.4 は「直接の手段なし」が正しく、間接策（`agent.spawn` で自前エージェント型へ差し替え）が存在すると指摘されたが、ユーザー判断で採らないことにした。ほかに Esc での閉じ方、再描画上限の 30 回/秒、`await` 漏れ、fullscreen でないと dock にならない点、`$.process` が CLI 専用である点を修正した。

## 16. 出典一覧

- `ref/mods_api.md`：「Add a command」「Add a tool」「Run work in the background」「Stop background work」「Reach files, processes, and the network」
- `ref/mods_events.md`：「Observe an event」「Filter which events a hook handles」「Guard or change a tool call」「Rewrite or add to a prompt」「Follow a turn」「Handle the settings hook events」
- `ref/plugins_mods_interface.md`：「Pick where to draw」「Open a pane at the right time」「Build a tree from elements」「Redraw a site」「Keep state」「Load a saved value again after /clear」「Save from more than one session」
- `ref/plugins_mods_reference.md`：「Files」「Events」（Tools / Turns / Session / Interface）「Mods API methods」「Render sites」「Elements」「Limits」「Settings and environment variables」「Commands」
- `ref/mods_create.md`：「Get type definitions for your version」「Check what Claude Code reads from your mod」「Test the mod」「Share your mod」
- `ref/mods_troubleshoot.md`：「Check whether mods can load」「Read the debug log」
- `ref/hooks.md`：「FileChanged」「SessionStart decision control」
- `ref/cc.d.ts`（2.1.277）：`CommandSpec`、`ToolSpec`、`ToolCallInput`、`AgentLoop`、`AgentSpawnInput`、`ToolDescribeInput`、`TurnStartInput`、`TurnCompleteFields`、`TurnCompleteResult`、`TurnStepResult`、`SessionStartInput`、`SessionEndInput`、`SessionRepo`、`session` 名前空間、`FsStat`、`$.fs.stat` のコメント、`PaneOpenArgs`、`Pane` の props、`CommandPresentation`、`UiPane`、`SiteScroll`、`ClassicResultFields`、`ToolCallResult`、`process` 名前空間、グローバル `crypto` 宣言
- https://code.claude.com/docs/en/plugins/mods/test（2026-10-05 取得）
- https://gihyo.jp/dev/serial/01/continue-power/0009（2026-10-05 取得。印の記法の確認）
