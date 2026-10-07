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
   - `~/.claude/{skills,agents,commands}` and `~/.claude/CLAUDE.md`
   - the output of `npm ls -g`, `uv tool list` and a few `--version` calls (the *inventory*)

   Secret-looking values are redacted (see below), then everything is written to the folder. Skills installed by an external tool (e.g. graphify) or managed by the app are skipped on purpose: they are rebuilt from `externals.md`.
2. **The agent** reads `manifest.json` and the real machine and writes `externals.md`: prerequisites first, then LSP binaries, then tools with their own installer, plus notes for hooks with absolute paths, MCP secrets and things that cannot be synced.

## Pull

1. **`scripts/apply.mjs`** runs in a fixed order:

   | Step | Command / action |
   | --- | --- |
   | 1. Marketplaces | `claude plugin marketplace add <source>` |
   | 2. Plugins | `claude plugin install <plugin@marketplace>` for every entry in `enabledPlugins` (skips installed ones) |
   | 3. MCP servers | `claude mcp add-json --scope user <name> <json>` (skips existing; skips servers with redacted secrets) |
   | 4. Files | copy skills / agents / commands / `CLAUDE.md`, never overwriting |
   | 5. Settings | back up `settings.json`, then merge |

   Settings come **last** on purpose: `plugin install` rewrites `enabledPlugins`, and the final on/off state must be the one from your snapshot.
2. **The agent** follows `externals.md` in order, verifying each step, asking before anything risky.
3. It offers to delete the folder. Only on an explicit yes, only that exact folder, and only if nothing failed or was skipped.

### Settings merge rule

For each top-level key in the snapshot: if both the snapshot and the target value are objects, they are merged one level deep (snapshot wins on conflicts); otherwise the snapshot value replaces the target's. Keys that contain a redacted value are left untouched. Keys only present in the target are kept.

## Redaction

Under `env` and `headers` (in `settings.json` and in each MCP server), any key matching `/key|token|secret|password|auth|credential/i` has its value replaced with `<REDACTED>`, and the path is listed in `manifest.json` → `redacted` and in the push report. This is a name-based heuristic: review `manifest.json` before sharing the folder.

## What is deliberately not handled

- claude.ai account connectors (they live in your account).
- Credentials, history, caches, per-project state.
- Project-scoped (`.mcp.json`, `.claude/`) configuration.
- Plugin versions: plugins are installed at whatever version your marketplaces serve today.
