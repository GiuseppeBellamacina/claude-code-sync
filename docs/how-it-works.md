# How it works

`setup-sync` is a regular Claude Code plugin: two skills (`push`, `pull`) and zero-dependency Node scripts. It is **not** a mod and registers no hooks, so it does nothing until you invoke a command.

```text
setup-sync/
├── .claude-plugin/
│   └── plugin.json         # plugin manifest (listed in the cosmic-plugins marketplace)
├── skills/
│   ├── push/SKILL.md       # /setup-sync:push
│   └── pull/SKILL.md       # /setup-sync:pull
└── scripts/
    ├── export.mjs          # deterministic snapshot
    ├── select.mjs          # --exclude / --only selectors shared by the scripts
    ├── common.mjs          # cross-platform helpers (paths, copy, OS warnings)
    ├── verify.mjs          # push verification
    ├── pack.mjs            # --cloud: snapshot folder -> one HTML page (Artifact)
    ├── unpack.mjs          # --cloud: that page -> snapshot folder
    └── apply.mjs           # deterministic restore (+ --plan, --verify)
```

## The sync folder

Default location: `~/.claude-sync/`. Pass any path as the skill argument to use another one.

```text
~/.claude-sync/
├── manifest.json     # settings, MCP servers, marketplaces, tool inventory
├── files/            # hand-made skills/, agents/, commands/ and CLAUDE.md
└── externals.md      # written by the agent: how to rebuild everything else
```

It is plain files with no database and no daemon. Delete the folder and the plugin leaves nothing behind.

## Push

1. **`scripts/export.mjs`** reads:
   - `~/.claude/settings.json`
   - `~/.claude.json` → user-level `mcpServers`
   - `~/.claude/plugins/known_marketplaces.json`
   - `~/.claude/{skills,agents,commands,output-styles,themes,workflows}`, `~/.claude/CLAUDE.md` and `keybindings.json`
   - mods: plugin folders in `~/.claude/dev-mods/*/*` and in `CLAUDE_CODE_PLUGIN_DIRS` (deduplicated by plugin name, newest wins; `node_modules` and `.claude-plugin/types` excluded)
   - the output of `npm ls -g`, `uv tool list` and a few `--version` calls (the *inventory*)

   Secret-looking values are redacted (see below), then everything is written to the folder. Skills installed by an external tool (e.g. graphify) or managed by the app are skipped on purpose: they are rebuilt from `externals.md`.
2. **The agent** reads `manifest.json` and the real machine and writes `externals.md`: prerequisites first, then LSP binaries, then tools with their own installer, plus notes for hooks with absolute paths, MCP secrets and things that cannot be synced.

## Pull

`apply.mjs` compares the snapshot with this machine item by item. An item is a marketplace, a plugin, an MCP server, a file or folder (skills, agents, commands, output styles, themes, workflows, mods, `CLAUDE.md`, keybindings), or a settings entry (one per top-level key, or per sub-key for objects such as `env`, `hooks`, `enabledPlugins`; `statusLine` is kept whole). Each gets a status:

| Status | Meaning | `overwrite` | `replace` |
| --- | --- | --- | --- |
| `same` | identical | nothing | nothing |
| `new` | only in the snapshot | add | add |
| `conflict` | both, different (files compared by content hash, MCP servers after normalizing defaults) | snapshot wins | snapshot wins |
| `localOnly` | only on this machine | keep | **remove** |
| `secret` | snapshot value was redacted | keep local, report | keep local, report |

`--plan` prints the non-identical items as JSON and changes nothing. `--decisions <file>` takes `{"<item id>": "snapshot" | "local" | "remove" | "both"}` and overrides the mode for those items (`both` = keep local, save the snapshot copy as `<name>.synced`). This is how the agent runs the *ask* mode: it reads the plan, asks you targeted questions, writes the decisions file and runs the script.

Never removed, in any mode: the `setup-sync` plugin and marketplace, the `claude-plugins-official` marketplace, skills owned by external tools (graphify, ...), credentials. A full backup is written to `~/.claude/backups/pre-sync-<timestamp>/` before anything changes.

Then the script applies the result in a fixed order:

1. **`scripts/apply.mjs`**:

   | Step | Command / action |
   | --- | --- |
   | 1. Marketplaces | `claude plugin marketplace add <source>` (`remove` for replaced or local-only ones) |
   | 2. Plugins | `claude plugin install <plugin@marketplace>` for every entry in `enabledPlugins`; `claude plugin uninstall` for removed ones |
   | 3. MCP servers | `claude mcp add-json --scope user <name> <json>`, `claude mcp remove --scope user <name>` |
   | 4. Files | copy skills / agents / commands / styles / themes / workflows / `CLAUDE.md` / keybindings; copy mods to `~/.claude/mods/<name>` |
   | 5. Settings | apply the queued edits on a fresh read of `settings.json`; set the copied mods to `env.CLAUDE_CODE_PLUGIN_DIRS` (the snapshot's own value is dropped on push, because it holds absolute paths of the old machine) |

   Settings come **last** on purpose: `plugin install` rewrites `enabledPlugins`, and the final on/off state must be the one from your snapshot.
2. **The agent** follows `externals.md` in order, verifying each step, asking before anything risky.
3. It offers to delete the folder. Only on an explicit yes, only that exact folder, and only if nothing failed or was skipped.

### Settings

Settings are resolved entry by entry (see the status table), so a conflict on `env.FOO` never affects `env.BAR`. Arrays and other values are replaced as a whole. In `replace` mode local-only entries are deleted and emptied objects are cleaned up.

## Cloud transport (`--cloud`)

The Artifact is only a transport for the sync folder; `apply.mjs` never knows about it.

- **`scripts/pack.mjs`** walks the snapshot folder and writes one HTML page (a fragment: the Artifact publisher adds `<html>`, `<head>` and `<body>`). Every file, including `externals.md` and `push-report.md`, goes into a `<script type="application/json" id="setup-sync-data">` block as `{path, size, sha256, encoding, data, exec?}`: valid UTF-8 is stored as text, anything else as base64. `<` is escaped as `\u003c`, so file content cannot close the script tag. A small inline script renders the same data for humans (counts, secrets to re-enter, install instructions, every file in a collapsible block, a copy button for the pull command). It refuses pages above 12 MB (the Artifact limit is 16 MB) and lists the largest files.
- **`scripts/unpack.mjs`** reads that block back. Before writing anything it checks the format version, that every path is `manifest.json`, `externals.md`, `push-report.md` or under `files/` with no `..`, `.`, empty parts, `\` or `:`, and that size and SHA-256 match. It only replaces a folder that already is a snapshot, restores the executable bit and prints a summary.
- The skills do the Artifact calls: push lists/publishes/updates (title `Setup Sync Snapshot`, private), pull lists/reads (`path: "index.html"`) and, on the user's yes, deletes it after the pull.

## Cross-platform helpers

`common.mjs` is shared by `export.mjs` and `apply.mjs`:

- `claudeDir` / `claudeJson`: honor `CLAUDE_CONFIG_DIR`; the MCP state file is read from inside it if present, else from the home folder.
- `copyTree`: `fs.cpSync` with `dereference: true` (symlinks are followed so links to absolute paths of the old machine never dangle), then on macOS/Linux every file starting with `#!` gets LF line endings and the executable bit. `export.mjs` wraps it so one unreadable entry (a dangling symlink) is recorded in `manifest.json` → `warnings` instead of aborting; `apply.mjs` treats an unreadable local entry as different from the snapshot.
- `platformWarning(snapshotPlatform, value)`: compares the OS recorded in the snapshot (`manifest.json` → `platform`) with this machine's. Across Windows and POSIX it flags values with PowerShell/`.cmd`/`.bat`/drive-letter paths/`cmd /c` (from Windows) or `/home`, `/Users`, `/usr`, `.sh`, `bash` (from POSIX); between macOS and Linux it flags home paths. `apply.mjs` attaches the reason to settings and MCP items (`warning` in `--plan`, `warnings` in the apply report) and applies them as usual; Claude asks what to do with each.
- `apply.mjs` runs `claude` without a shell. If the command is not found it says so (`claude` must be in `PATH`; a shell alias is not enough); on Windows only, a `.cmd` shim falls back to a shell with quoted arguments.

## Selection

`select.mjs` implements `--exclude`, `--only` and the matching rules shared by `export.mjs` and `apply.mjs`:

- A selector is `category` or `category:name`. A name matches an item exactly, or as a prefix followed by `.`, `@` or `/` (so `plugin:ponytail` matches `ponytail@ponytail`, `settings:env` matches `env.FOO`).
- `--only` keeps just the listed selectors; `--exclude` always wins over it; aliases such as `plugin`, `mcp-servers`, `skill`, `claude.md` are accepted; unknown categories abort with an error.
- **Push** applies the filters while collecting (settings are filtered per top-level key, and `enabledPlugins`, `extraKnownMarketplaces` and `hooks` per entry), and records them in `manifest.json` under `selection`.
- **Pull** merges the snapshot's `selection` with its own flags and drops every excluded item before planning. So an excluded item is never compared, changed, removed or reported, and `replace` cannot delete local data the snapshot deliberately does not cover (`CLAUDE_CODE_PLUGIN_DIRS` is kept as is when mods are excluded).
- **`--add <path>`** copies a file or folder (without `node_modules`) to `files/extra/` and records `{rel, isDir}` in `manifest.json` under `extras`, where `rel` is the path relative to the home folder. Paths outside the home folder, or inside the sync folder, are refused on push. On pull each extra becomes an item `extra:<rel>` with the usual statuses; a `rel` that is absolute or contains `..` is refused, so a tampered snapshot cannot write outside the home folder.
- `verify.mjs` re-exports with the selection and extras recorded in the manifest, so verification checks exactly what was meant to be synced.

## Verification

- **`scripts/verify.mjs`** (push): exports the machine again into a temp folder and compares `settings`, `mcpServers`, `marketplaces`, the copied list, the redaction list and every file under `files/` with the snapshot; scans every snapshot file for secret patterns (OpenAI/Anthropic-style keys, GitHub, Slack and AWS tokens, bearer tokens, private keys) and reports `{file, pattern}` only; checks `externals.md` is present and lists inventory tools it does not mention. Exit code 2 on any failure.
- **`apply.mjs --verify`** (pull): same flags as the pull. Recomputes the plan against the machine and reports `mismatches` (should have changed, still differs), `intentionallyKept`, `needsUser` (redacted secrets), and checks that `settings.json` parses, mods are registered in `CLAUDE_CODE_PLUGIN_DIRS` and a backup exists. Exit code 2 on any failure.
- The agent then runs what scripts can't: external tools' verify commands, `claude plugin validate` for mods, existence of hook/statusLine paths, and writes the checklist report.

## Redaction

Under `env` and `headers` (in `settings.json` and in each MCP server), any key matching `/key|token|secret|password|auth|credential/i` has its value replaced with `<REDACTED>`, and the path is listed in `manifest.json` → `redacted` and in the push report. This is a name-based heuristic: review `manifest.json` before sharing the folder.

## What is deliberately not handled

- claude.ai account connectors (they live in your account).
- Credentials, history, caches, per-project state.
- Project-scoped (`.mcp.json`, `.claude/`) configuration.
- Data a mod keeps in `$.store`.
- Plugin versions: plugins are installed at whatever version your marketplaces serve today.
