# Examples

All outputs below are illustrative: names, versions and paths will differ on your machine.

## 1. Replace your laptop

```text
# old laptop
/setup-sync:push D:\transfer\cc-setup

# copy D:\transfer\cc-setup to the new laptop, then on the new laptop:
/plugin marketplace add GiuseppeBellamacina/claude-code-sync
/plugin install setup-sync@setup-sync
/setup-sync:pull C:\Users\me\Desktop\cc-setup
```

When Claude asks *"Delete the sync folder?"*, answer yes once the report is clean.

## 2. Keep two machines in sync through a private repo

```bash
# machine A: push straight into a clone of your private repo
git clone git@github.com:you/my-claude-setup.git ~/my-claude-setup
# in Claude Code:
#   /setup-sync:push ~/my-claude-setup
cd ~/my-claude-setup && git add -A && git commit -m "sync" && git push
```

```bash
# machine B
git clone git@github.com:you/my-claude-setup.git ~/my-claude-setup
# in Claude Code:
#   /setup-sync:pull ~/my-claude-setup
```

The push script only empties a folder that already holds a previous snapshot (it has a `manifest.json`), and it recreates its contents, so keep `.git` out of the way by pushing into a **subfolder** of the repo (e.g. `~/my-claude-setup/snapshot`) rather than the repo root.

> Keep that repository **private**.

## 3. Back up before experimenting

```text
/setup-sync:push ~/cc-backup
# ...try a dozen plugins, change settings...
/setup-sync:pull ~/cc-backup      # re-applies the plugin list and settings
```

Pull never removes plugins you added afterwards; it re-applies what the snapshot contains. For a full reset, uninstall the extras by hand.

## 4. A pull report with a secret to fill in

```json
{
  "ok": [
    "marketplace ponytail",
    "plugin frontend-design@claude-plugins-official",
    "plugin typescript-lsp@claude-plugins-official",
    "mcp docs-langchain",
    "skills/my-skill",
    "settings.json merged"
  ],
  "skipped": [
    "plugin context7@claude-plugins-official (already installed)",
    "CLAUDE.md (exists, merge by hand from the sync folder)"
  ],
  "failed": [
    "mcp my-server: needs a secret, add by hand"
  ]
}
```

Fix the failed entry with the real value:

```bash
claude mcp add-json --scope user my-server '{"command":"npx","args":["my-mcp-server"],"env":{"API_KEY":"<your key>"}}'
```

## 5. What `externals.md` looks like

Written by the agent on push, executed by the agent on pull:

````markdown
# External setup

## Prerequisites
- Node.js ≥ 20 (found: v24.x), npm, Python ≥ 3.11, git, uv, gh
- Verify: `node -v && uv --version && gh --version`

## Language servers (needed by the pyright-lsp / typescript-lsp plugins)
```bash
npm install -g pyright
npm install -g typescript typescript-language-server
```
Verify: `typescript-language-server --version`

## graphify (tool + skill)
```bash
uv tool install graphifyy
graphify install     # installs the skill and writes the "# graphify" block into ~/.claude/CLAUDE.md
```
Verify: `graphify --version`
Per-project (not synced): run `/graphify .` inside each repo you want a graph for.

## Hooks with machine-specific paths
- `statusLine` runs `C:\old-machine\tools\statusline.ps1` → recreate the script or drop the setting.

## Needs you
- MCP server `my-server`: requires `API_KEY` (from your provider's dashboard).
- Not syncable: claude.ai connectors (Microsoft 365) — they follow your account.
````

On pull, Claude asks before anything that needs a login, a secret or a risky installer, and runs the verify line after each step.

## 6. Check the snapshot before sharing it

```bash
node scripts/export.mjs --dir ./snapshot      # same script the skill runs
```

Then open `snapshot/manifest.json` and search for anything sensitive. Redacted values show as `<REDACTED>`; everything else is verbatim.

## 7. Bring your own mods

You built a status-line mod and a prompt-rewriting mod with `/plugin-authoring`. On the old machine:

```text
/setup-sync:push
```

```text
mods/plugin folders: statusline-ticker, prompt-polish
copied: mods/statusline-ticker, mods/prompt-polish, ...
```

On the new machine, after `/setup-sync:pull`:

```text
~/.claude/mods/statusline-ticker
~/.claude/mods/prompt-polish
~/.claude/settings.json  →  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "<home>/.claude/mods/statusline-ticker;<home>/.claude/mods/prompt-polish" }
```

Start a new Claude Code session: both mods load. `/plugin` shows a line like `2 mods active`. If a mod needed an npm package or a binary, the agent installed it from `externals.md` and ran `claude plugin validate` on the mod.

## 8. Pull onto a machine you already use

```text
/setup-sync:pull
```

```text
This machine already has a setup. Compared with the snapshot:
  new: 7   same: 31   conflict: 4   only here: 5
```

Claude asks which mode you want (overwrite / replace / ask). If you pick **ask**, you get concrete questions, for example:

```text
settings.model       snapshot: "sonnet"        local: "opus"      -> Use snapshot / Keep local
settings.env.FOO     snapshot: "snap"          local: "local"     -> Use snapshot / Keep local
file:CLAUDE.md       differs                                       -> Use snapshot / Keep local / Keep both
skills/localskill    only on this machine                          -> Keep / Remove
mcp:local-srv        only on this machine                          -> Keep / Remove
```

Your answers become a decisions file and are applied:

```json
{
  "settings.model": "local",
  "settings.env.FOO": "local",
  "file:CLAUDE.md": "both",
  "skills/localskill": "remove"
}
```

`both` leaves your `CLAUDE.md` untouched and writes the snapshot's version as `CLAUDE.md.synced`; Claude then offers to merge the two into one file with you.

Everything is backed up first, for example to `~/.claude/backups/pre-sync-2026-10-07T10-28-06-795Z/`.

## 9. Make a machine identical to the snapshot

```text
/setup-sync:pull --replace
```

Claude lists everything that exists only on this machine and would be removed (plugins, MCP servers, skills, settings keys), asks for one explicit confirmation, takes the backup, then makes the machine match the snapshot exactly. `setup-sync` itself and Anthropic's default marketplace are always kept.

## 10. What a report looks like

`pull-report.md` after pulling onto a machine you already use (ask mode):

````markdown
# Setup Sync, pull report (2026-10-07, Windows 11, mode: ask)

## Synced
marketplaces 2 · plugins 18 · MCP servers 2 · skills 3 · agents 1 · mods 2 · settings entries 14 · externals installed 3

## Kept
- settings.model (kept local: "opus")
- file:CLAUDE.md (kept both, merged with you; CLAUDE.md.synced deleted)

## Removed
- skills/old-experiment (you answered "remove")

## Not synced
- mcp:my-server: needs a secret (API_KEY). Fix: `claude mcp add-json --scope user my-server '{...}'`
- external `hf` CLI: install failed (`uv tool install` exited 1: no network). Fix: re-run `/setup-sync:pull` when online

## Needs you
- Enter the API_KEY for `my-server`
- Start a new session so MCP servers and mods load

## Checklist
- [x] backup taken: ~/.claude/backups/pre-sync-2026-10-07T10-35-37Z
- [x] marketplaces and plugins installed, on/off state matches the snapshot
- [x] MCP servers present (1 of 2, see Not synced)
- [x] files, agents, skills copied
- [x] mods copied, registered in CLAUDE_CODE_PLUGIN_DIRS, `claude plugin validate` passed (2/2)
- [x] settings.json written and parses
- [ ] every external tool installed and verified: hf failed (see Not synced)
- [x] verify run: no unexpected leftovers
- [ ] new session started so MCP servers and mods load
````

Because *Not synced* is not empty, Claude keeps the sync folder instead of offering to delete it.
