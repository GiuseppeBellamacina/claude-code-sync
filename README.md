# setup-sync — move your whole Claude Code setup to a new machine in two commands

> `/setup-sync:push` on the old machine. `/setup-sync:pull` on the new one. Settings, plugins, MCP servers, skills, agents, hooks, LSP servers and your own mods come with you — and Claude installs the awkward external tools for you.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](https://code.claude.com/docs/en/plugins)

Claude Code has [no native way to sync your configuration across machines](https://github.com/anthropics/claude-code/issues/36693). Your `~/.claude` folder ends up holding a dozen plugins, MCP servers, skill overrides, model settings, hooks, a language server or two, and a few CLI tools you installed by hand. Rebuilding that on a new laptop means an afternoon of remembering what you did.

`setup-sync` turns that afternoon into a conversation:

```text
# old machine
/setup-sync:push

# ...copy the folder (USB stick, cloud drive, private repo)...

# new machine
/setup-sync:pull
```

## Why it's different

Most sync tools just copy files. That works for JSON, but half of a real setup is *not* JSON: a language server needs `npm install -g`, graphify-style tools need an installer plus a follow-up command, hooks point at scripts that only exist on one machine.

`setup-sync` splits the job in two:

| Kind of thing | Who handles it | How |
| --- | --- | --- |
| Settings, plugins, marketplaces, MCP servers, skills, agents, commands, `CLAUDE.md` | **Deterministic scripts** | Plain `claude plugin install`, `claude mcp add-json`, JSON merge. No AI guesswork, reproducible. |
| External tools: LSP binaries, CLIs, tools with their own installer, machine-specific hook scripts | **The agent** | On push it writes step-by-step instructions (`externals.md`). On pull it executes them, verifies each step, and asks before anything risky. |

And it cleans up after itself: the sync folder is a plain local folder, and after a successful pull Claude offers to delete it.

## What gets synced

| Item | Synced | Notes |
| --- | :-: | --- |
| `settings.json` (model, effort, theme, permissions, **hooks**, `skillOverrides`, ...) | ✅ | Merged into the target, with a backup |
| Plugin marketplaces | ✅ | `claude plugin marketplace add` |
| Plugins (enabled **and** disabled) | ✅ | `claude plugin install`, then the on/off state is restored |
| MCP servers (user scope) | ✅ | `claude mcp add-json --scope user` |
| Custom skills, **agents**, commands | ✅ | Copied, never overwriting existing ones |
| **Mods** (made with `/plugin-authoring`) and plugins loaded from a folder | ✅ | Copied to `~/.claude/mods/` and registered through `CLAUDE_CODE_PLUGIN_DIRS`. See [Mods](#mods) |
| Output styles, themes, workflows, `keybindings.json` | ✅ | Copied, never overwriting |
| Global `CLAUDE.md` | ✅ | Copied if absent; otherwise left for you to merge |
| Extra files/folders you choose (`~/.gitconfig`, notes, ...) | ✅ | With `--add`, see [Tell it what to sync](#tell-it-what-to-sync) |
| **LSP servers** | ✅ | The `*-lsp` plugins come with the plugin list; the language server binaries (e.g. `pyright`, `typescript-language-server`) are installed by the agent |
| External tools (CLIs, `uv`/`npm` globals, tools with their own installer) | ✅ | Documented on push, executed on pull by the agent |
| Secrets (API keys, tokens) | ❌ | Replaced by `<REDACTED>`; you re-enter them. See [Security](#security) |
| claude.ai account connectors (Microsoft 365, ...) | ❌ | They belong to your account, not the machine |
| Credentials (`.credentials.json`), history, per-project state | ❌ | Never copied. Log in again with `/login` |

## Install

```text
/plugin marketplace add GiuseppeBellamacina/cosmic-plugins
/plugin install setup-sync@cosmic-plugins
```

Requires Claude Code with plugin support and [Node.js](https://nodejs.org) 18+ (the scripts use only the Node standard library — nothing to `npm install`).

Prefer the CLI? (Also the way to go where `/plugin` isn't available, e.g. the VS Code extension: run these two commands in a terminal, then `/reload-plugins` in the session.)

```bash
claude plugin marketplace add GiuseppeBellamacina/cosmic-plugins
claude plugin install setup-sync@cosmic-plugins
```

## Usage

### 1. Push (old machine)

```text
/setup-sync:push                 # saves to ~/.claude-sync
/setup-sync:push D:\backup\cc    # or to a folder of your choice
```

Claude snapshots your setup, then inspects the machine and writes `externals.md`: what each external tool is, the exact commands to reinstall it, how to verify it, and what needs you (a login, a secret). Example of what it reports:

```text
Pushed to C:\Users\you\.claude-sync
settings keys: model, effortLevel, enabledPlugins, skillOverrides, modelSettings, ...
plugins: 18, marketplaces: claude-plugins-official, ponytail
mcp servers: docs-langchain, reference-langchain
hooks in settings: (none)
copied: skills/my-skill, agents/reviewer.md, CLAUDE.md
redacted secrets (set again by hand on the new machine): mcp.my-server.env.API_KEY
```

### 2. Move the folder

Anything works: a USB stick, a synced cloud folder, a **private** git repo. The folder contains your personal configuration — see [Security](#security).

### 3. Pull (new machine)

Install `setup-sync` on the new machine first (two commands above), then:

```text
/setup-sync:pull                 # reads ~/.claude-sync
/setup-sync:pull D:\backup\cc    # or from another folder
```

Fresh install or a Claude Code you already use: both work, see [merge modes](#already-have-a-setup-merge-modes).

You get a report like this:

```json
{
  "ok": ["marketplace ponytail", "plugin frontend-design@claude-plugins-official", "mcp docs-langchain", "agents/reviewer.md", "settings.json merged"],
  "skipped": ["plugin context7@claude-plugins-official (already installed)"],
  "failed": ["mcp my-server: needs a secret, add by hand"]
}
```

Then Claude works through `externals.md` — installing prerequisites, language servers and tools, verifying each one — and finally asks whether to delete the sync folder. It only deletes after an explicit "yes", and keeps the folder if anything failed or was skipped so you can re-run the pull.

Run `/reload-plugins` to apply plugin changes right away; new MCP servers start with your next session.

More walkthroughs, including a full `externals.md`, are in [docs/examples.md](docs/examples.md). How it works under the hood: [docs/how-it-works.md](docs/how-it-works.md).

## Tell it what to sync

You don't have to sync everything. Add a request in plain words, in any language, after the command. Claude turns it into precise filters, tells you how it understood it, and runs.

```text
/setup-sync:push everything except MCP servers
/setup-sync:push only plugins and settings
/setup-sync:push skip hooks and my CLAUDE.md
/setup-sync:push also include ~/.gitconfig and my ~/notes folder
/setup-sync:push also note in externals.md that I use ripgrep
/setup-sync:pull don't touch my MCP servers
/setup-sync:pull only restore plugins, keep everything else as it is
```

Under the hood these are flags you can also type yourself (`--exclude`, `--only`, `--add`):

| You want | Flag | Example |
| --- | --- | --- |
| Leave something out | `--exclude <selectors>` | `--exclude mcp,hooks` |
| Sync only some things | `--only <selectors>` | `--only plugins,settings` |
| Add files or folders from outside `~/.claude` | `--add <path>` (repeatable) | `--add ~/.gitconfig --add ~/notes` |

A selector is a **category** or `category:name` for a single item. Categories: `plugins`, `marketplaces`, `mcp`, `settings`, `hooks`, `skills`, `agents`, `commands`, `output-styles`, `themes`, `workflows`, `mods`, `claude-md`, `keybindings`, `extra`. Examples: `mcp:docs-langchain`, `plugin:ponytail`, `settings:theme`, `skills:my-skill`.

Good to know:

- **The snapshot remembers what you left out.** If you pushed with `--exclude mcp`, a later `pull --replace` will not delete the MCP servers of the target machine: replace only touches what the snapshot covers.
- **Extra files** (`--add`) must be inside your home folder, are restored to the same place there, go through the same conflict handling and verification as everything else, and are listed with their target path for your confirmation before a pull writes them. Claude refuses or asks about anything that looks like credentials (`.env`, private keys, token files).
- **Secrets stay out, whatever you ask.** Redaction cannot be switched off.
- Anything the filters can't express (an extra tool to install, a note to leave for the other machine) is handled by Claude in `externals.md`.

## Already have a setup? Merge modes

On a clean install there is nothing to merge. On a machine that is already configured, `pull` first runs a read-only comparison and tells you how many items are new, identical, in conflict, or only local. Then you choose:

| Mode | Flag | What happens |
| --- | --- | --- |
| **Overwrite** (default) | `--overwrite` | The snapshot wins on conflicts. Things that exist only on this machine are kept. |
| **Replace everything** | `--replace` | This machine ends up exactly like the snapshot: plugins, MCP servers, skills, agents and settings keys that are not in it are removed. Claude lists what will be removed and asks you to confirm first. |
| **Ask** | `--ask` | Claude asks specific questions about each doubt (*"Your `model` is `opus`, the snapshot says `sonnet`: which one?"*) and applies your answers. |

```text
/setup-sync:pull --replace
/setup-sync:pull D:\backup\cc --ask
```

Without a flag, Claude describes the situation and asks which mode you want. In **Ask** mode every conflict can be resolved as *use snapshot*, *keep local* or, for files, *keep both*, which saves the snapshot version next to yours as `<name>.synced`; Claude can then merge the two files with you, for example your `CLAUDE.md`. Local-only items can be *kept* or *removed*.

**Safety net:** before changing anything, `pull` writes a full backup to `~/.claude/backups/pre-sync-<timestamp>/` (settings, `CLAUDE.md`, keybindings, skills, agents, commands, mods, MCP servers, marketplaces, plugin list). It never touches `setup-sync` itself, Anthropic's default marketplace, skills owned by external tools or credentials. Items whose snapshot value was redacted are never overwritten.

## Mods

Mods are plugins, and the ones you make with `/plugin-authoring` live in a per-session hot-reload folder (`~/.claude/dev-mods/<session>/<mod>`) that a new machine knows nothing about. `setup-sync` finds them, plus any folder listed in `CLAUDE_CODE_PLUGIN_DIRS`, and on pull:

1. copies each one to `~/.claude/mods/<name>` (skipping any that already exist),
2. adds those folders to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (the documented way to load plugin folders permanently), keeping whatever was there,
3. lets the agent install anything a mod depends on and validate it with `claude plugin validate`.

Restart Claude Code (or `/reload-plugins`) and the mods are active. `node_modules` and the engine-generated `.claude-plugin/types` are left out; if a mod has dependencies, the agent reinstalls them from `externals.md`. If your organization's managed settings set `disableSideloadFlags`, folder-loaded plugins are blocked on that machine. Data a mod keeps in `$.store` is not synced.

## Reports and verification

Both commands end with a **verification step** and a **report with a checklist**, so you know what actually happened instead of trusting a "done".

- **Push** re-exports your machine into a temp folder and diffs it against the snapshot (`scripts/verify.mjs`), scans the snapshot for secret-looking values (it reports the file and the pattern, never the value), and checks that `externals.md` exists and covers the tools found on the machine. The report is saved as `push-report.md` in the sync folder.
- **Pull** recomputes the comparison against the machine *after* applying (`apply.mjs --verify`): anything that was meant to change but still differs is listed as a failure, what you chose to keep is listed as kept, and secrets you must enter are listed separately. Claude then runs the real checks the script can't (each external tool's verify command, `claude plugin validate` on every mod). The report is saved as `pull-report.md` inside the backup folder, so it survives deleting the sync folder.

The report always has the same shape:

```text
## Synced       counts by kind (plugins, MCP servers, skills, mods, settings entries, ...)
## Kept         chosen to stay local
## Removed      removed by replace/ask
## Not synced   each item + the error + how to fix it
## Needs you    secrets, logins, a new session
## Checklist    [x] only with evidence from a check, [ ] with the reason otherwise
```

A box is ticked only if a verification output or a command backs it up. Anything unverified stays unticked with the reason, and the sync folder is kept (not offered for deletion) while anything is under *Not synced* or *Needs you*.

## Security

- **Secrets are never written to the snapshot.** Any `env` or `headers` value whose key looks like a secret (`key`, `token`, `secret`, `password`, `auth`, `credential`) becomes `<REDACTED>`. Items containing one are never written or overwritten on pull: they are listed so you add them by hand, and an existing local value is kept.
- **Redaction is name-based, so review the snapshot** (`manifest.json`) before sharing it anywhere. A token stuffed into a command-line argument or an oddly-named variable won't be caught.
- **A snapshot is code, only pull ones you trust.** Pulling installs plugins from the marketplaces it lists, registers MCP servers (which run commands) and follows the shell instructions in `externals.md`. Claude shows you the commands and asks for one confirmation before running them, but a folder taken from a stranger, or from a shared drive someone else can write to, can still be hostile. Read `manifest.json` and `externals.md` first.
- **Treat the folder as private.** It lists your tools, paths and configuration. Don't push it to a public repo.
- **Pull is reversible.** Everything is backed up to `~/.claude/backups/pre-sync-<timestamp>/` before any change, and nothing is removed unless you pick *replace* (after seeing the list) or answer *remove* in *ask* mode.
- **The agent asks first** before logins, secrets, `curl | sh` installers and system-wide installs, and skips an instruction rather than guess when it looks stale.
- The push script refuses to write into a non-empty folder that isn't a previous snapshot, so it can't wipe an unrelated directory.

## FAQ

**Does it need internet?** The scripts don't. Pull installs plugins and tools, so the new machine needs a connection for that.

**Can I sync between Windows, macOS and Linux?** The simple parts, yes. `externals.md` is written for the OS it was created on; on pull the agent adapts commands to the new OS (e.g. `winget` ↔ `brew`) and tells you when it does.

**What about hooks?** Hooks defined in `settings.json` travel with the settings. Hooks that come from a plugin return with the plugin. Hooks calling a script at an absolute path on the old machine are flagged by the agent so you can recreate or adapt them.

**Project-level setup?** Out of scope: this syncs your *user-level* setup. Per-project steps (like building a graph in a repo) are mentioned in `externals.md` but not run.

**Why not just git-track `~/.claude`?** You can, and for pure config it's great. But the folder also holds credentials, caches and per-machine state, plugin cache paths differ between machines, and git can't install your language servers. `setup-sync` copies only what's portable and replays the rest.

**Why is the plugin called `setup-sync` and not `claude-sync`?** Claude Code reserves plugin names starting with `claude-` for Anthropic's own plugins.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Ideas that would help most: more redaction heuristics, macOS/Linux test reports, and recipes for popular tools in `externals.md`.

## License

[MIT](LICENSE)
