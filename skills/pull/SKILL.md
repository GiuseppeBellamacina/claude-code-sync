---
name: pull
description: Restore a personal Claude Code setup from a local sync folder created by push, on a new OR an already configured machine (overwrite, replace everything, or ask item by item), then run the external-tool instructions. Use when the user runs /setup-sync:pull.
disable-model-invocation: true
argument-hint: "[folder] [--overwrite | --replace | --ask]"
---

# Sync pull

Parse `$ARGUMENTS`: an optional folder (default `~/.claude-sync`) and an optional mode flag. If the folder has no `manifest.json`, stop and say so. In the commands below `<script>` is `${CLAUDE_PLUGIN_ROOT}/scripts/apply.mjs` (if `${CLAUDE_PLUGIN_ROOT}` was not expanded, it is under `~/.claude/plugins/cache/setup-sync/`).

## 1. Look before touching anything

```
node "<script>" --dir "<folder>" --plan
```

It changes nothing and prints `counts` and the non-identical items, each with an `id`, a `status` and short `snapshot`/`local` values:

- `new`: only in the snapshot. `same`: identical (not listed). `conflict`: both sides, different.
- `localOnly`: only on this machine. `secret`: the snapshot value was redacted, never overwritten.

Item ids: `marketplace:<n>`, `plugin:<id>`, `mcp:<n>`, `<dir>/<name>` (skills, agents, commands, output-styles, themes, workflows, mods), `file:CLAUDE.md`, `file:keybindings.json`, `settings.<key>[.<subkey>]`.

## 2. Pick the mode

- **Fresh machine** (no `conflict` and no `localOnly` items): no question, use overwrite.
- A flag in the arguments decides: `--overwrite`, `--replace`, `--ask`.
- Otherwise tell the user how many items are new / conflicting / local-only, and ask with AskUserQuestion:
  1. **Overwrite (default, recommended)**: the snapshot wins on conflicts, everything only on this machine is kept.
  2. **Replace everything**: this machine ends up exactly like the snapshot; local-only items are removed.
  3. **Ask me item by item**: specific questions for each doubt.

  Mention that a full backup is taken automatically either way.

### Replace
List every `localOnly` item that would be removed (plugins, MCP servers, skills, settings keys...) and get one more explicit confirmation. Never remove anything the user did not see listed. `setup-sync` itself, the `claude-plugins-official` marketplace and skills owned by external tools are always kept.

### Ask
Turn `conflict` and `localOnly` items into a few concrete questions (AskUserQuestion, at most 4 per call, repeat as needed). Each question names the item and shows both values, with options such as **Use snapshot** / **Keep local**; for files add **Keep both** (puts the snapshot copy next to the local one as `<name>.synced`); for `localOnly` use **Keep** / **Remove**. Group long homogeneous lists (e.g. many `settings.enabledPlugins.*`) into one question first, and drill down only if the user wants. `new` items are applied unless the user says otherwise (answer `local` to skip one). For text files with conflicts (`CLAUDE.md`), offer to merge: pick **Keep both**, then merge the two files yourself, show the result, and delete the `.synced` copy only after the user agrees.

Write the answers to a JSON file outside the sync folder, `{"<id>": "snapshot" | "local" | "remove" | "both"}`; items not mentioned follow the overwrite rule.

## 3. Apply

```
node "<script>" --dir "<folder>" [--mode replace] [--decisions <file>]
```

It backs up first (`~/.claude/backups/pre-sync-<timestamp>/`: settings, CLAUDE.md, keybindings, skills/agents/commands/mods..., MCP servers, marketplaces, plugin list), then adds marketplaces, installs plugins, adds/replaces user MCP servers, copies files, copies mods to `~/.claude/mods/<name>` and registers them in `CLAUDE_CODE_PLUGIN_DIRS`, and writes `settings.json` last. Show the user the report (ok / skipped / failed) and the backup path, and say that restoring means copying files back from it.

## 4. Run `<folder>/externals.md` (your job)

Execute each item in order, prerequisites first, and run its verify command after each one. On a machine that already has some of these tools, check first and skip what is already installed and working.

- Ask the user before anything needing login, a secret, `curl | sh`/`iex` style installers, or a system-wide install. Skip an item rather than guess when its instructions look stale or wrong, and say why.
- Never invent secrets: for items reported as `secret`, ask the user for the value or leave it for them.
- Check hooks/statusLine entries that point at machine-specific absolute paths and fix or report them.
- For each mod, run the setup its entry lists (dependencies, binaries), then `claude plugin validate ~/.claude/mods/<name>` and report the result.
- Per-project steps (e.g. `/graphify .`) are only mentioned, not run.

## 5. Wrap up

Summarize: done, skipped, failed, still needs the user. Remind that `/reload-plugins` applies plugin changes now, but new MCP servers and newly registered mods need a new session (mods load through `CLAUDE_CODE_PLUGIN_DIRS`, read at startup).

Then ask whether to delete the sync folder. Delete it only after an explicit yes, only the exact folder used, and keep it if anything failed or was skipped so the pull can be re-run. The backup folder in `~/.claude/backups/` is separate and is never deleted by this skill.
