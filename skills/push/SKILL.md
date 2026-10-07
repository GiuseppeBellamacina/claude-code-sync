---
name: push
description: Save this machine's personal Claude Code setup (settings, plugins, MCP, skills, agents, hooks, LSP) into a local sync folder, plus instructions for the external tools. Use when the user runs /setup-sync:push.
disable-model-invocation: true
argument-hint: "[folder] [what to sync or skip, in plain words] [--exclude <sel>] [--only <sel>] [--add <path>]"
---

# Sync push

Target folder: `$ARGUMENTS` if given, otherwise `~/.claude-sync`.

## 0. Understand what the user asked

`$ARGUMENTS` may hold, besides the folder, a request in plain words, in any language: *"everything except MCP"*, *"only plugins and settings"*, *"skip hooks and my CLAUDE.md"*, *"also include ~/.gitconfig and ~/notes"*, *"also note that I use ripgrep"*. Turn it into flags for the scripts:

- leave something out: `--exclude <selectors>`; sync only some things: `--only <selectors>`; add files or folders outside `~/.claude`: `--add <path>` (repeatable; only paths inside the home folder).
- Categories: `plugins`, `marketplaces`, `mcp`, `settings` (top-level setting names), `hooks`, `skills`, `agents`, `commands`, `output-styles`, `themes`, `workflows`, `mods`, `claude-md`, `keybindings`, `extra`. A selector is a category or `category:name` for one item (`mcp:docs-langchain`, `plugin:ponytail`, `settings:theme`, `agents:reviewer.md`).
- What flags cannot express is yours to handle: an extra tool or command to install goes into `externals.md`; "don't document external tools" means skip step 2 and say so in the report.
- **Secrets are never included**, whatever the request: redaction stays on. If the user asks to sync a secret, explain and offer to document where to get it again.
- Before adding a file with `--add`, look at its name and, if in doubt, its content. Refuse or ask for anything that looks like credentials (`.env`, private keys, token files, `credentials*`).

Say your interpretation in one line before running (*"Syncing everything except MCP servers, plus ~/.gitconfig."*). Ask (AskUserQuestion) only when the request is really ambiguous. With no request, sync everything.

## 1. Snapshot the simple parts (deterministic)

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/export.mjs" --dir "<folder>" [--exclude ...] [--only ...] [--add ...]
```

If `${CLAUDE_PLUGIN_ROOT}` was not expanded, the script is under `~/.claude/plugins/cache/cosmic-plugins/setup-sync/`. It writes `manifest.json` (settings incl. hooks/enabledPlugins/skillOverrides, user MCP servers, marketplaces, tool inventory) and `files/` (hand-made skills, agents, commands, output styles, themes, workflows, CLAUDE.md, keybindings.json, and **mods**: every plugin folder found in `~/.claude/dev-mods/*/` or listed in `CLAUDE_CODE_PLUGIN_DIRS`, without `node_modules` or the generated `.claude-plugin/types`). Secret-looking env/header values are already replaced by `<REDACTED>`.

## 2. Write `<folder>/externals.md` (your job)

Everything that is not a plain Claude Code command needs written instructions so the pull side can replay it. Read `manifest.json` (`inventory`, `settings`, `mcpServers`) and the real machine, then document each item in install order:

- **Prerequisites**: node/npm, python, uv, git, gh (with the versions found).
- **LSP servers**: the `*-lsp` plugins only register a command; list the binaries they need (check each plugin's `.lsp.json`/manifest under `~/.claude/plugins/cache/`) and the exact install command (e.g. `npm install -g pyright typescript typescript-language-server`), taken from `inventory.npmGlobals`.
- **External tools with their own skill/CLAUDE.md block** (graphify, hf CLI, etc.): install command, the follow-up command (e.g. `graphify install`), a verify command, and what is per-project and therefore NOT part of the sync.
- **Hooks and statusLine** in `settings.json`: for each `command`, say which script/binary it runs, whether it lives in a plugin (then nothing to do) or at a machine-specific absolute path (then say what must be recreated or adapted).
- **Mods**: for each mod copied, read its hooks module and manifest. If it shells out (`$.process`), calls external binaries or MCP servers, reads files at absolute paths, or declares `userConfig`/`pluginConfigs` values, document that here. If it has a `package.json` with dependencies, add the install command. Mods keep cross-session data in `$.store`; that data is not synced, say so if a mod relies on it.
- **MCP servers**: for each one in `redacted`, name the secret needed and where to obtain it. Never write secret values.
- **Not syncable**: claude.ai account connectors (Microsoft 365 etc.) are tied to the account, mention them as informational only.

Use this shape per item: `## <name>` / what and why / commands (one block, in order) / verify / needs user (login, secret, confirmation). Verify every command against what is actually installed; do not invent steps.

## 3. Verify (do not skip)

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs" --dir "<folder>"
```

It re-exports the machine into a temp folder and diffs it against the snapshot, scans the snapshot for secret-looking values (pattern names only), and checks `externals.md`. Exit code 2 means something is wrong. Act on the output before reporting:

- `differences`: something changed since the export or was not captured. Re-run step 1 (and update `externals.md` if needed), then verify again.
- `possibleSecrets`: find the value in the named file, remove or redact it, and verify again. Never print the matched text.
- `unmentionedInventory`: tools found on the machine that `externals.md` does not mention. Add them, or tell the user you left them out on purpose.
- `externals.md` check failed: write it.

Also confirm by hand what the script cannot see: every command in `externals.md` was checked against the machine, and every `statusLine`/hook command with an absolute path is flagged.

## 4. Report and checklist

Write `<folder>/push-report.md` with the full detail below, then show the user the compact chat version (see *Chat format* after the checklist):

```
# Setup Sync, push report (<date>, <OS>)
## Synced        counts by kind (marketplaces, plugins, MCP servers, skills, agents, commands, styles, themes, workflows, mods, settings entries, externals documented)
## Not synced    each item, why (not syncable / redacted secret / failed), and how to fix it
## Needs you     secrets to re-enter, logins, decisions
## Checklist
- [x] snapshot written and manifest valid
- [x] snapshot matches this machine (verify: no differences)
- [x] no secret-looking values in the snapshot
- [x] externals.md written; every external tool documented with a verified command
- [x] hooks/statusLine with machine-specific paths flagged
- [x] mods copied, their dependencies documented
```

Tick a box only with evidence from the verify output or a command you ran; otherwise leave it `[ ]` with the reason.
### Chat format (what the user reads)

The file is the full record; in chat give a compact, scannable version, not the file pasted. Use this shape, omitting any block that would be empty:

```
## Setup Sync · {push|pull} {✅ done | ⚠️ done with N issues | ❌ failed}
`<folder>` · <date> · <OS>{ · mode: <mode>}

| Synced | |
| --- | --: |
| Marketplaces | 3 |
| Plugins | 19 |
| ... one row per kind that has items | n |

**Verification**
| Check | Result |
| --- | --- |
| Snapshot matches this machine | ✅ 0 differences |
| Secrets scan | ✅ 0 hits |
| ... one row per check that ran | ✅ / ⚠️ / ❌ + a few words |

**⚠️ Needs attention**
- `<item>`: <reason>. Fix: <one line>

**Next:** <the one thing to do now>
```

Rules: status emoji ✅ ⚠️ ❌ only; counts live in the table, not in prose; one line per issue, always with its fix; list kinds that have nothing in a single line ("None on this machine: skills, agents, mods"); never ✅ for something not verified (use ⚠️ and say why); no paragraphs, no repeating the checklist verbatim, end with the file path of the full report.

End with the folder path, a reminder that it can be moved to another machine (USB, cloud drive, private repo) before `/setup-sync:pull`, and a warning that it holds personal config: never put it in a public repo.
