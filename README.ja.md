# yak-tree

[English](README.md)

長い会話で話の筋を見失わないように、いま取り組んでいることのツリーをセッションの横のPaneに出し続ける[Claude CodeのMod](https://code.claude.com/docs/en/plugins/mods/overview)です。

> **開発状況: P2。** Claudeが専用のツールでツリーを書き、Paneがそれを表示します。ツリーのファイルは手でも直せます。ツリーの更新を忘れたターンへの警告と、ツリーに名前を付ける機能（P3以降）は開発中です。詳しくは[開発状況](#開発状況)を見てください。

## 考え方

ひげぽん「第9回 ログのすすめ」（[gihyo.jp](https://gihyo.jp/dev/serial/01/continue-power/0009)）の考え方を元にしています。作業を入れ子の箇条書きで書き、タスクを小さく分け、行き止まりも記録し、いまの位置を短い印で示します。

yak-treeも同じ印を使います。次の表は、印とPaneに出る記号の対応です。

| 印 | Paneの記号 | 意味 |
|---|---|---|
| `done` | `✓` | 終わった。1行にたたむ。 |
| `here` | `▶` | いまの位置。1つのツリーに最大1つ。 |
| `important` | `★` | たたんだ枝の中でも常に表示する。 |
| `abandoned` | `✗` | 諦めた道筋。1行にたたむ。 |

ツリーは、各行の末尾に隠しIDを付けたMarkdownの箇条書きです。ファイルを手で直すこともできます。

```markdown
- __done__ Gather requirements <!--k3f9a2-->
    - __important__ Must work offline <!--m8t2qa-->
- Build the feature <!--z51hhc-->
    - __here__ Write the parser <!--j4qaq2-->
        - Handle tabs and spaces <!--b6xav2-->
    - __abandoned__ Try a regex-only approach <!--dddd44-->
```

## インストール

```sh
claude plugin marketplace add padawansato/claude-yak-tree
claude plugin install yak-tree@claude-yak-tree
```

Modを扱えるClaude Code 2.1.287以降が必要です。

インストールせずに、クローンから試すこともできます。

```sh
claude --plugin-dir /path/to/claude-yak-tree
```

## 使い方

`/tree` と入力するとPaneが開き、もう一度入力すると閉じます。`/tree e`、`/tree a` で表示を切り替えられ（e：アウトライナー風、a：gitのグラフ風）、選んだ表示は保存されます。組み込みコマンドと同じ名前であるなどの理由で `/tree` を登録できない場合は、代わりに `/yak-tree` を登録します。このとき `/tree` には反応しないので、同じ名前の他のコマンドを妨げません。Paneは自動では開きません。

Paneは、いまのセッションのツリーのファイル（次の節）を2秒ごとに確認し、変わっていれば表示し直します。手で編集すると、2秒以内にPaneに反映されます。Pane自身はファイルを読むだけで、書き込むのは次に述べるツールだけです。ファイルが無いあいだは、組み込みのサンプルツリーを出し、見出しに「サンプルのツリー」と出ます。ファイルができると、見出しにどのツリーかが出ます（`ツリー: <issue・名前・ブランチ>`、または `ツリー: このセッション`）。ファイルの形式にはまだ時刻がないので、ファイルのツリーでは時刻と、hereにいる時間は出しません。

Claudeは次の5つのツールでツリーを書きます。

| ツール | 働き |
|---|---|
| `tree_add` | ノードを足します。最初の呼び出しでツリーのファイルを作ります。 |
| `tree_here` | いまの位置（`here`）を別のノードへ移します。 |
| `tree_mark` | 印（`done`、`important`、`abandoned`）を付けるか、外します。 |
| `tree_edit` | ノードの本文を直します。 |
| `tree_read` | ツリー全体をIDつきで読みます。 |

Claudeは、ツールの説明だけを手がかりに、いつ呼ぶかを決めます。ツリーを使ってほしいときは、「作業をyak-treeに記録して」のように頼んでください。書き込めるのはメインの会話だけで、サブエージェントが呼べるのは `tree_read` だけです。

ツールがファイルを読んでから書くまでのあいだに人がファイルを編集した場合、ツールはファイルを読み直し、人の編集の上に自分の変更を加えます。ただし、エディターが古い内容を開いたまま後から保存すると、ツールの変更は消えます。

Paneの位置は端末によって異なります。fullscreenで幅が十分なとき（Claude Codeの型定義では110列以上）は右側のサイドバー、それ以外はプロンプトの上の枠です。`/tree` で開いたPaneは幅に関係なく表示され、狭い端末ではプロンプトの上に出ます。

## ツリーの保存先

ツリーはリポジトリの外の `~/.claude/yak-tree/<repo>/` に置きます。`<repo>` はリポジトリのmain working treeの名前です。worktreeは、元のリポジトリと同じツリーを共有します。どのツリーを使うかは、次の順で決めます。

1. issueツリー `<repo>/<ISSUE>.md`：`issueKeyPattern`（後述）を設定していて、ブランチ名が一致したとき。
2. 名前付きツリー `<repo>/<name>.md`：このセッションを `tree_promote` で昇格したとき（`tree_promote` は実装予定で、今の版ではこのツリーは使われません）。名前には英数字、`-`、`_`、`.` を使えます。
3. ブランチツリー `<repo>/branches/<branch>.md`：既定ブランチ以外のブランチにいるとき。ブランチ名の `/` などは `_2f` のように置き換えるので、別のブランチが同じファイルになることはありません。ただし、変換後に200バイトを超える名前は、先頭を切り詰め、末尾に `_h` と元の名前のSHA-256の先頭16桁を付けます。大文字と小文字を区別しないファイルシステム（macOSの既定など）では、`Feature` と `feature` のように大小だけが違うブランチが同じファイルを共有します。
4. セッションツリー `<repo>/sessions/<session id>.md`：上のどれでもないとき。既定ブランチ、detached HEAD、git管理外のディレクトリがこれにあたります。

git管理外のディレクトリでは、`~/.claude/yak-tree/_nogit/` の下に置きます。セッションツリーは `_nogit/<ディレクトリ名>/sessions/<session id>.md`、名前付きツリーは `_nogit/<name>.md` です。

ツリーの名前（issueキー、または `tree_promote` に渡す名前）は、先頭を英数字にし、続けて英数字、`-`、`_`、`.` を使えます。`..` とパス区切りは使えません。長さは100文字までです。

既定ブランチは `git symbolic-ref --short refs/remotes/origin/HEAD` が返すブランチです。取得できなければ `main` と `master` を既定ブランチとみなします。

## 設定

yak-treeは `userConfig` に4つの設定を宣言しています。

| 設定 | 既定値 | 意味 |
|---|---|---|
| `issueKeyPattern` | なし | ブランチ名からissueキーを取り出す正規表現。例：`^([A-Z][A-Z0-9]*-[0-9]+)(/\|$)` は `PAD-193/design` から `PAD-193` を取り出します。最初のキャプチャグループがキーで、グループがなければ一致した部分全体がキーです。キーに使えるのは英数字、`-`、`_`、`.` だけです。 |
| `language` | `en` | `en` か `ja`。Paneの見出しと、ツールのエラーメッセージの言語です。Claudeが読むツールの説明は常に英語です。 |
| `view` | `e` | `e`、`a` のいずれか。Paneの既定の表示です。`/tree e`、`/tree a` で選んだ表示は保存され、この設定より優先されます。 |
| `warnAfterToolCalls` | `3` | ツリーを更新しないままこの回数のツールを使ったターンの回答の下に、警告を1行出します（実装予定。開発状況を見てください）。 |

### 設定の方法

Claude Codeは、プラグインの `userConfig` への回答を、ユーザー設定（`~/.claude/settings.json`）の `pluginConfigs` に保存します。このキーは、プロジェクト設定とローカル設定では無視される点に注意してください。設定の方法は次のとおりです。

- プラグインを有効にしたときに設定ダイアログが出れば、そこで答える。
- `/config` を開く。有効なプラグインの機密でない設定は、ここに1行ずつ出ます（プラグインのリファレンスによるとClaude Code 2.1.269以降）。
- `~/.claude/settings.json` を手で編集する。

```json
{
  "pluginConfigs": {
    "yak-tree@claude-yak-tree": {
      "options": {
        "issueKeyPattern": "^([A-Z][A-Z0-9]*-[0-9]+)(/|$)",
        "language": "ja"
      }
    }
  }
}
```

キーは `<プラグイン名>@<マーケットプレイス名>` で、ここでは `yak-tree@claude-yak-tree` です。`--plugin-dir` で読み込んだときは `yak-tree@inline` になります。JSONに書くときは、パターン中のバックスラッシュを2つ重ねてください。起動中のセッションがファイルの変更を拾うかは確認していないので、変更後は新しいセッションを始めてください。

書かなかった設定は既定値になります。正規表現として正しくないパターンは無視します。

## 開発状況

- P0：`/tree` で、固定のサンプルツリーを出すPaneを開閉します。
- P1：ツリーのファイル（スコープの決め方は上のとおり）を読み、変更から2秒以内にPaneを更新します。サンプルを出すのは、ファイルがまだ無いあいだだけです。
- P2（このリリース）：Claudeがツリーを書くためのツール（`tree_add`、`tree_here`、`tree_mark`、`tree_edit`、`tree_read`）。
- P3以降（開発中）：ツールを使ったのにツリーを更新しなかったターンへの警告。ツリーに名前を付ける `tree_promote`。

設計は [docs/design.md](docs/design.md)、要件は [docs/requirements.md](docs/requirements.md) にあります（どちらも日本語です）。

## 開発

```sh
npm test                    # 純関数の単体テスト（node:test）
claude plugin validate --strict .
claude plugin test          # フックと Pane のテスト
```

`tsconfig.json` が参照する `.claude-plugin/types/` は、`claude --plugin-dir` で読み込んだときにClaude Codeが生成します。リポジトリには含めていません。

## ライセンス

[MIT](LICENSE)
