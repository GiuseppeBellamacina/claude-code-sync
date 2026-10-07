---
name: push
description: Save this machine's personal Claude Code setup (settings, plugins, MCP, skills, agents, hooks, LSP) into a local sync folder, plus instructions for the external tools. Use when the user runs /setup-sync:push.
disable-model-invocation: true
argument-hint: "[folder, default ~/.claude-sync]"
---

# Sync push

Target folder: `$ARGUMENTS` if given, otherwise `~/.claude-sync`.

## 1. Snapshot the simple parts (deterministic)

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/export.mjs" --dir "<folder>"
```

If `${CLAUDE_PLUGIN_ROOT}` was not expanded, the script is under `~/.claude/plugins/cache/setup-sync/`. It writes `manifest.json` (settings incl. hooks/enabledPlugins/skillOverrides, user MCP servers, marketplaces, tool inventory) and `files/` (hand-made skills, agents, commands, CLAUDE.md). Secret-looking env/header values are already replaced by `<REDACTED>`.

## 2. Write `<folder>/externals.md` (your job)

Everything that is not a plain Claude Code command needs written instructions so the pull side can replay it. Read `manifest.json` (`inventory`, `settings`, `mcpServers`) and the real machine, then document each item in install order:

- **Prerequisites**: node/npm, python, uv, git, gh (with the versions found).
- **LSP servers**: the `*-lsp` plugins only register a command; list the binaries they need (check each plugin's `.lsp.json`/manifest under `~/.claude/plugins/cache/`) and the exact install command (e.g. `npm install -g pyright typescript typescript-language-server`), taken from `inventory.npmGlobals`.
- **External tools with their own skill/CLAUDE.md block** (graphify, hf CLI, etc.): install command, the follow-up command (e.g. `graphify install`), a verify command, and what is per-project and therefore NOT part of the sync.
- **Hooks and statusLine** in `settings.json`: for each `command`, say which script/binary it runs, whether it lives in a plugin (then nothing to do) or at a machine-specific absolute path (then say what must be recreated or adapted).
- **MCP servers**: for each one in `redacted`, name the secret needed and where to obtain it. Never write secret values.
- **Not syncable**: claude.ai account connectors (Microsoft 365 etc.) are tied to the account, mention them as informational only.

Use this shape per item: `## <name>` / what and why / commands (one block, in order) / verify / needs user (login, secret, confirmation). Verify every command against what is actually installed; do not invent steps.

## 3. Report

Tell the user the folder path, what was captured, the redacted secrets, and that the folder can be moved to another machine (USB, cloud drive, private repo) before running `/setup-sync:pull`. Warn that the folder contains personal config: do not put it in a public repo.
