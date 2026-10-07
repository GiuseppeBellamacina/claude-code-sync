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
