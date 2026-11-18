# yak-tree

[日本語](README.ja.md)

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that keeps a tree of what you are working on in a pane beside your session, so you do not lose the thread of a long conversation.

> **Status: P2.** Claude writes the tree with its own tools and the pane shows it. You can also edit the tree file by hand. The warning for a turn that forgot the tree and named trees (P3 and later) are in development. See [Development status](#development-status).

## Idea

The idea comes from "第9回 ログのすすめ" by higepon ([gihyo.jp](https://gihyo.jp/dev/serial/01/continue-power/0009)): write your work as a nested bullet list, split a task into smaller ones, record the dead ends too, and mark where you are with a few words.

yak-tree uses the same marks:

| Mark | Symbol in the pane | Meaning |
|---|---|---|
| `done` | `✓` | Finished. Folded into one line. |
| `here` | `▶` | Where you are now. At most one per tree. |
| `important` | `★` | Always shown, even inside a folded branch. |
| `abandoned` | `✗` | A path you gave up. Folded into one line. |

The tree is a Markdown bullet list with a hidden id at the end of each line, so you can also edit the file by hand:

```markdown
- __done__ Gather requirements <!--k3f9a2-->
    - __important__ Must work offline <!--m8t2qa-->
- Build the feature <!--z51hhc-->
    - __here__ Write the parser <!--j4qaq2-->
        - Handle tabs and spaces <!--b6xav2-->
    - __abandoned__ Try a regex-only approach <!--dddd44-->
```

## Install

```sh
claude plugin marketplace add padawansato/claude-yak-tree
claude plugin install yak-tree@claude-yak-tree
```

Requires Claude Code 2.1.287 or later, the version that documents mods.

To try it from a clone without installing:

```sh
claude --plugin-dir /path/to/claude-yak-tree
```

## Use

Type `/tree` to open the pane, and type it again to close it. `/tree e` and `/tree a` switch the view (e: outline, a: git-graph style) and the choice is remembered. If `/tree` is refused, for example because a built-in command has that name, the mod registers `/yak-tree` instead and leaves `/tree` to whoever owns it. The pane never opens by itself.

The pane reads the tree file for the current session (see below) every 2 seconds and redraws when it changes, so an edit by hand shows up within 2 seconds. The pane itself only reads the file; only the tools described next write it. Until that file exists, the pane shows a built-in sample tree, and its heading says "sample tree". Once the file exists, the heading shows which tree it is (`tree: <issue, name or branch>`, or `tree: this session`). Trees from the file do not show times or how long you have been at the here node, because the file format has no timestamps yet.

Claude writes the tree with five tools:

| Tool | What it does |
|---|---|
| `tree_add` | Adds a node. The first call creates the tree file. |
| `tree_here` | Moves the current position (`here`) to another node. |
| `tree_mark` | Sets or clears a mark (`done`, `important`, `abandoned`). |
| `tree_edit` | Changes a node's text. |
| `tree_read` | Reads the whole tree with its ids. |

Claude decides when to call them from the tool descriptions alone, so ask for it when you want the tree used, for example "keep the yak-tree up to date as you work". Only the main conversation can write; a subagent can call `tree_read` only.

If you edit the file by hand between a tool's read and its write, the tool reads again and applies its change on top of yours. An editor that still holds the old content and saves it later does overwrite what the tool wrote.

Where the pane appears depends on your terminal. In fullscreen mode with enough width (the type definitions in Claude Code say 110 columns or more), the pane docks as a right sidebar. Otherwise it is a frame above the prompt. A pane you open with `/tree` is shown whatever the width; on a narrow terminal it appears above the prompt.

## Where trees are stored

Trees live outside your repository, under `~/.claude/yak-tree/<repo>/`, where `<repo>` is the name of the repository's main working tree. A worktree shares the tree of its repository. The tree is chosen in this order:

1. **Issue tree** `<repo>/<ISSUE>.md`: you set `issueKeyPattern` (see below) and the branch name matches it.
2. **Named tree** `<repo>/<name>.md`: this session was promoted with `tree_promote` (planned; this version never uses a named tree). A name may use letters, digits, `-`, `_` and `.`.
3. **Branch tree** `<repo>/branches/<branch>.md`: you are on a branch other than the default branch. Characters such as `/` in the branch name are escaped as `_2f`, so two branches do not share a file. A name that is longer than 200 bytes after escaping is cut short and ends with `_h` and 16 hex digits of its SHA-256. On a file system that ignores case (the macOS default, for one), branches whose names differ only in case, such as `Feature` and `feature`, share one file.
4. **Session tree** `<repo>/sessions/<session id>.md`: everything else, such as the default branch, a detached HEAD, or a directory outside git.

Outside a git repository, trees go under `~/.claude/yak-tree/_nogit/`: a session tree is `_nogit/<directory name>/sessions/<session id>.md`, and a named tree is `_nogit/<name>.md`.

A tree name (an issue key or a name given to `tree_promote`) must start with a letter or digit, may then use letters, digits, `-`, `_` and `.`, must not contain `..`, and may be at most 100 characters long. Path separators are not allowed.

The default branch is the one `git symbolic-ref --short refs/remotes/origin/HEAD` names. If that fails, `main` and `master` count as default.

## Settings

yak-tree declares four options in its `userConfig`.

| Option | Default | Meaning |
|---|---|---|
| `issueKeyPattern` | none | A regular expression that pulls an issue key out of the branch name. Example: `^([A-Z][A-Z0-9]*-[0-9]+)(/\|$)` matches `PAD-193/design` and gives `PAD-193`. The first capture group is the key; with no group, the whole match is. A key may use only letters, digits, `-`, `_` and `.`. |
| `language` | `en` | `en` or `ja`. The language of the pane heading and of the tools' error messages. Tool descriptions that Claude reads are always English. |
| `view` | `e` | `e` or `a`. The default view of the pane. A view chosen with `/tree e` or `/tree a` is remembered and wins over this setting. |
| `warnAfterToolCalls` | `3` | A turn that runs this many tool calls without updating the tree gets a one-line warning under the answer. (Planned; see Development status.) |

### How to set them

Claude Code stores the answers to a plugin's `userConfig` under `pluginConfigs` in your **user** settings (`~/.claude/settings.json`). Project and local settings are ignored for this key. You can set the values in any of these ways:

- Answer the configuration dialog, if Claude Code shows it when you enable the plugin.
- Open `/config`. Each non-sensitive option of an enabled plugin has a row there (Claude Code 2.1.269 or later, per the plugin reference).
- Edit `~/.claude/settings.json` by hand:

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

The key is `<plugin name>@<marketplace name>`, which is `yak-tree@claude-yak-tree` here. A plugin loaded with `--plugin-dir` uses `yak-tree@inline`. In JSON, write each backslash in a pattern twice. Whether a running session picks up an edit to the file is not verified, so start a new session after you change it.

Settings that you leave out fall back to the defaults. A pattern that is not a valid regular expression is ignored.

## Development status

- **P0:** `/tree` toggles a pane that shows a fixed sample tree.
- **P1:** the pane reads your tree file (scope chosen as above), refreshes within 2 seconds when it changes, and shows the sample only while the file does not exist.
- **P2 (this release):** the tools Claude uses to write the tree (`tree_add`, `tree_here`, `tree_mark`, `tree_edit`, `tree_read`).
- **P3 and later (in development):** a warning when a turn used tools but did not update the tree; `tree_promote`, which gives a tree a name.

The design is in [docs/design.md](docs/design.md) and the requirements are in [docs/requirements.md](docs/requirements.md). Both are written in Japanese.

## Development

```sh
npm test                    # unit tests for the pure functions (node:test)
claude plugin validate --strict .
claude plugin test          # hook and pane tests
```

`tsconfig.json` extends `.claude-plugin/types/`, which Claude Code generates when it loads the plugin with `claude --plugin-dir`. It is not in the repository.

## License

[MIT](LICENSE)
