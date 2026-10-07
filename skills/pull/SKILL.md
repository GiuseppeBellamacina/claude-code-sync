---
name: pull
description: Restore a personal Claude Code setup from a local sync folder created by push, then run the external-tool instructions. Use when the user runs /setup-sync:pull.
disable-model-invocation: true
argument-hint: "[folder, default ~/.claude-sync]"
---

# Sync pull

Source folder: `$ARGUMENTS` if given, otherwise `~/.claude-sync`. If it has no `manifest.json`, stop and say so.

## 1. Apply the simple parts (deterministic)

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/apply.mjs" --dir "<folder>"
```

If `${CLAUDE_PLUGIN_ROOT}` was not expanded, the script is under `~/.claude/plugins/cache/setup-sync/`. It adds marketplaces, installs plugins, adds user MCP servers, copies skills/agents/commands/output styles/themes/workflows/CLAUDE.md/keybindings (never overwriting), copies mods into `~/.claude/mods/<name>` and registers them in `CLAUDE_CODE_PLUGIN_DIRS`, backs up and merges `settings.json` (backup in `~/.claude/backups/`). Show the user its report (ok / skipped / failed).

## 2. Run `<folder>/externals.md` (your job)

Execute each item in order, prerequisites first, and run its verify command after each one.

- Ask the user before anything needing login, a secret, `curl | sh`/`iex` style installers, or a system-wide install. Skip an item rather than guess when its instructions look stale or wrong, and say why.
- Never invent secrets: for MCP servers marked as needing a secret, ask the user for it or leave it for them.
- Check hooks/statusLine entries that point at machine-specific absolute paths and fix or report them.
- For each mod, run the setup its `externals.md` entry lists (dependencies, binaries), then run `claude plugin validate ~/.claude/mods/<name>` and report the result.
- Per-project steps (e.g. `/graphify .`) are only mentioned, not run.

## 3. Wrap up

Summarize: done, skipped, failed, still needs the user. Remind that `/reload-plugins` applies plugin changes now, but new MCP servers and newly registered mods need a new session (mods load through `CLAUDE_CODE_PLUGIN_DIRS`, which is read at startup).

Then ask whether to delete the sync folder. Delete it only after an explicit yes, only the exact folder used, and keep it if anything failed or was skipped so the pull can be re-run.
