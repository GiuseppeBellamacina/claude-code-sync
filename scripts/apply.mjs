// Pull, deterministic part: apply a pushed snapshot with plain Claude Code commands.
// Usage: node apply.mjs [--dir <folder>]   (default ~/.claude-sync)
// Order matters: marketplaces -> plugins -> MCP -> files -> settings last (installs would otherwise
// overwrite enabledPlugins). Existing local files/servers are never overwritten.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const home = os.homedir()
const claudeDir = path.join(home, '.claude')
const i = process.argv.indexOf('--dir')
const dir = path.resolve(i > 0 ? process.argv[i + 1] : path.join(home, '.claude-sync'))

const readJson = (p, d = {}) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const claude = args => spawnSync('claude', args, { encoding: 'utf8', shell: process.platform === 'win32' })
const m = readJson(path.join(dir, 'manifest.json'), null)
if (!m) { console.error(`No manifest.json in ${dir}`); process.exit(1) }

const report = { ok: [], skipped: [], failed: [] }
const run = (label, args) => {
  const r = claude(args)
  if (r.status === 0) report.ok.push(label)
  else report.failed.push(`${label}: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`)
}

// 1. marketplaces
for (const [name, s] of Object.entries(m.marketplaces)) {
  const src = s.source === 'github' ? s.repo : s.url ?? s.path
  if (!src) { report.failed.push(`marketplace ${name}: unknown source ${JSON.stringify(s)}`); continue }
  run(`marketplace ${name}`, ['plugin', 'marketplace', 'add', src])
}

// 2. plugins (installed even if disabled in the source; settings below sets the final on/off)
const installed = readJson(path.join(claudeDir, 'plugins', 'installed_plugins.json')).plugins ?? {}
for (const id of Object.keys(m.settings.enabledPlugins ?? {})) {
  if (installed[id]) report.skipped.push(`plugin ${id} (already installed)`)
  else run(`plugin ${id}`, ['plugin', 'install', id])
}

// 3. MCP servers (user scope)
const local = readJson(path.join(home, '.claude.json')).mcpServers ?? {}
for (const [name, s] of Object.entries(m.mcpServers)) {
  if (local[name]) report.skipped.push(`mcp ${name} (already present)`)
  else if (JSON.stringify(s).includes('<REDACTED>')) report.failed.push(`mcp ${name}: needs a secret, add by hand`)
  else run(`mcp ${name}`, ['mcp', 'add-json', '--scope', 'user', name, JSON.stringify(s)])
}

// 4. skills / agents / commands / styles / themes / workflows / CLAUDE.md / keybindings, never overwriting.
// Mods go to ~/.claude/mods/<name> and are loaded through CLAUDE_CODE_PLUGIN_DIRS (step 5).
const files = path.join(dir, 'files')
const modDirs = []
if (fs.existsSync(files)) for (const d of fs.readdirSync(files)) {
  const src = path.join(files, d)
  if (fs.statSync(src).isFile()) {
    const dst = path.join(claudeDir, d)
    if (fs.existsSync(dst)) report.skipped.push(`${d} (exists, merge by hand from the sync folder)`)
    else { fs.copyFileSync(src, dst); report.ok.push(d) }
    continue
  }
  for (const e of fs.readdirSync(src)) {
    const dst = path.join(claudeDir, d, e)
    if (d === 'mods') modDirs.push(dst)
    if (fs.existsSync(dst)) { report.skipped.push(`${d}/${e} (exists)`); continue }
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.cpSync(path.join(src, e), dst, { recursive: true })
    report.ok.push(`${d}/${e}`)
  }
}

// 5. settings: backup, then merge. Objects merge one level deep, scalars/arrays overwrite.
// hooks, modelSettings, skillOverrides, enabledPlugins, extraKnownMarketplaces all ride along here.
const sp = path.join(claudeDir, 'settings.json')
const cur = readJson(sp)
if (fs.existsSync(sp)) {
  fs.mkdirSync(path.join(claudeDir, 'backups'), { recursive: true })
  fs.copyFileSync(sp, path.join(claudeDir, 'backups', `settings.json.pre-sync.${Date.now()}`))
}
const next = { ...cur }
const plain = o => o && typeof o === 'object' && !Array.isArray(o)
for (const [k, v0] of Object.entries(m.settings)) {
  let v = v0
  if (plain(v)) {
    // Drop individual redacted entries (the secret must be set by hand), keep the rest.
    v = Object.fromEntries(Object.entries(v).filter(([sub, val]) => {
      const hit = JSON.stringify(val).includes('<REDACTED>')
      if (hit) report.failed.push(`settings.${k}.${sub}: secret, set by hand`)
      return !hit
    }))
  } else if (JSON.stringify(v).includes('<REDACTED>')) { report.failed.push(`settings.${k}: contains redacted secret, left untouched`); continue }
  next[k] = plain(v) && plain(cur[k]) ? { ...cur[k], ...v } : v
}
if (modDirs.length) {
  const have = (cur.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(path.delimiter).filter(Boolean)
  next.env = { ...next.env, CLAUDE_CODE_PLUGIN_DIRS: [...new Set([...have, ...modDirs])].join(path.delimiter) }
  report.ok.push(`CLAUDE_CODE_PLUGIN_DIRS set for ${modDirs.length} mod(s); restart Claude Code or run /reload-plugins`)
}
fs.writeFileSync(sp, JSON.stringify(next, null, 2))
report.ok.push('settings.json merged')

console.log(JSON.stringify(report, null, 2))
console.log('Machine-specific values (hook/statusLine commands, absolute paths) may still need fixing.')
