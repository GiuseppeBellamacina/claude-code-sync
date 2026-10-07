# setup-sync — move your whole Claude Code setup to a new machine in two commands

> `/setup-sync:push` on the old machine. `/setup-sync:pull` on the new one. Settings, plugins, MCP servers, skills, agents, hooks and LSP servers come with you — and Claude installs the awkward external tools for you.

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
| Global `CLAUDE.md` | ✅ | Copied if absent; otherwise left for you to merge |
| **LSP servers** | ✅ | The `*-lsp` plugins come with the plugin list; the language server binaries (e.g. `pyright`, `typescript-language-server`) are installed by the agent |
| External tools (CLIs, `uv`/`npm` globals, tools with their own installer) | ✅ | Documented on push, executed on pull by the agent |
| Secrets (API keys, tokens) | ❌ | Replaced by `<REDACTED>`; you re-enter them. See [Security](#security) |
| claude.ai account connectors (Microsoft 365, ...) | ❌ | They belong to your account, not the machine |
| Credentials (`.credentials.json`), history, per-project state | ❌ | Never copied. Log in again with `/login` |

## Install

```text
/plugin marketplace add GiuseppeBellamacina/claude-code-sync
/plugin install setup-sync@setup-sync
```

Requires Claude Code with plugin support and [Node.js](https://nodejs.org) 18+ (the scripts use only the Node standard library — nothing to `npm install`).

Prefer the CLI?

```bash
claude plugin marketplace add GiuseppeBellamacina/claude-code-sync
claude plugin install setup-sync@setup-sync
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

## Security

- **Secrets are never written to the snapshot.** Any `env` or `headers` value whose key looks like a secret (`key`, `token`, `secret`, `password`, `auth`, `credential`) becomes `<REDACTED>`. MCP servers that need one are skipped on pull and listed, so you add them by hand; settings entries containing a redacted value are left untouched.
- **Redaction is name-based, so review the snapshot** (`manifest.json`) before sharing it anywhere. A token stuffed into a command-line argument or an oddly-named variable won't be caught.
- **Treat the folder as private.** It lists your tools, paths and configuration. Don't push it to a public repo.
- **Pull never overwrites.** Existing skills, agents, commands, MCP servers and `CLAUDE.md` are kept; `settings.json` is backed up to `~/.claude/backups/` and merged (objects one level deep, scalars overwritten by the snapshot).
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
