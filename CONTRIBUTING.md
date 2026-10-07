# Contributing

Thanks for helping! The project is intentionally small: four Node scripts (no dependencies) and two skills.

## Ground rules

- Keep the scripts dependency-free (Node standard library only).
- Pull must back up before changing anything and never remove data unless the user chose replace or answered remove; push must never write secrets.
- Anything that can't be done with a plain `claude ...` command belongs in the agent instructions (`skills/*/SKILL.md`), not in the scripts.

## Develop

```bash
git clone https://github.com/GiuseppeBellamacina/claude-code-sync
claude plugin validate ./claude-code-sync
claude --plugin-dir ./claude-code-sync       # try it in a session
```

Test the scripts without touching your real config by pointing the home directory elsewhere (`USERPROFILE` on Windows, `HOME` on macOS/Linux) and running `node scripts/export.mjs --dir <tmp>` / `node scripts/apply.mjs --dir <tmp>`.

## Pull requests

- One topic per PR; describe the OS you tested on.
- Run `claude plugin validate .` before opening it.
- Update `README.md` / `docs/` when behavior changes.
