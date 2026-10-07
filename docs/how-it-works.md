# How it works

`setup-sync` is a regular Claude Code plugin: two skills (`push`, `pull`) and two zero-dependency Node scripts. It is **not** a mod and registers no hooks, so it does nothing until you invoke a command.

```text
setup-sync/
├── .claude-plugin/
│   ├── plugin.json         # plugin manifest
│   └── marketplace.json    # makes this repo its own marketplace
├── skills/
│   ├── push/SKILL.md       # /setup-sync:push
│   └── pull/SKILL.md       # /setup-sync:pull
└── scripts/
    ├── export.mjs          # deterministic snapshot
    └── apply.mjs           # deterministic restore
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

## Redaction

Under `env` and `headers` (in `settings.json` and in each MCP server), any key matching `/key|token|secret|password|auth|credential/i` has its value replaced with `<REDACTED>`, and the path is listed in `manifest.json` → `redacted` and in the push report. This is a name-based heuristic: review `manifest.json` before sharing the folder.

## What is deliberately not handled

- claude.ai account connectors (they live in your account).
- Credentials, history, caches, per-project state.
- Project-scoped (`.mcp.json`, `.claude/`) configuration.
- Data a mod keeps in `$.store`.
- Plugin versions: plugins are installed at whatever version your marketplaces serve today.
