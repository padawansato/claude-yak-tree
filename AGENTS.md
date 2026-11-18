# claude-yak-tree: AI エージェント向けルール

Claude Code / Codex などの AI エージェントが最初に読む。
要件は `docs/requirements.md`、設計は `docs/design.md`。
タスクは Linear のプロジェクト「claude-yak-tree」で管理する。issue なしで作業を始めない。

## Linear とドキュメントの更新

人間と AI エージェントが、最小の手間で現状を把握できるようにする。

- 判断や状態が変わったら、同じ作業の中で Linear の該当 issue と関連ドキュメント（`docs/requirements.md`、`docs/design.md`、この AGENTS.md）を更新する。後回しにしない
- 文書を新しく足す前に、既存文書の該当箇所を直せないか確かめる。古くなった記述は消すか書き換え、同じ内容を二か所に書かない

## ブランチと PR（2026-10-05 決定）

1. 作業を始める前に `gh pr list --state open` で、他のセッションが同じ範囲を触っていないか確かめる
2. 最新の `origin/main` から `PAD-<番号>/<slug>` ブランチを切る（worktree 名も同じ）
3. 最初のコミットができたらすぐ `git push -u origin <branch>` し、`gh pr create --draft --title "PAD-<番号>: <目的>"` で draft PR を開く。他のセッションから進行中の作業が見えるようにするため
4. 区切りごとにコミットして push する。ローカルにコミットを溜めない
5. 完成したら `/code-review`（medium 以上）を通し、`gh pr ready` で draft を外す
6. マージは GitHub 側で `gh pr merge --squash --delete-branch`。ローカルで main に直接マージ・push しない
7. マージを拒否されたら、ブランチ側で最新の main を取り込んでから再試行する。force-push はしない

コミットメッセージは `カテゴリ: 説明（PAD-<番号>）`。

## バージョン

`.claude-plugin/plugin.json` と `package.json` の `version` をそろえる。
段階（P0〜P4）の完成など区切りで上げ、main にマージした後に注釈付きタグ `v<version>` を付けて push する。

## テスト

- 純関数の単体テスト：`npm test`（`tests/unit/*.spec.ts`、node:test）
- Mod のテスト：`claude plugin test`（`tests/*.test.ts`）
- テストを先に書いてから実装する

## 禁止事項

- 再帰削除コマンドは使わず `~/.Trash/` へ移動する
- `ref/`（公式ドキュメントの写し）、ログ、秘密情報ファイルはコミットしない
