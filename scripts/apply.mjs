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

// 4. skills / agents / commands / CLAUDE.md, never overwriting
const files = path.join(dir, 'files')
if (fs.existsSync(files)) for (const d of fs.readdirSync(files)) {
  const src = path.join(files, d)
  if (d === 'CLAUDE.md') {
    const dst = path.join(claudeDir, d)
    if (fs.existsSync(dst)) report.skipped.push('CLAUDE.md (exists, merge by hand from the sync folder)')
    else { fs.copyFileSync(src, dst); report.ok.push('CLAUDE.md') }
    continue
  }
  for (const e of fs.readdirSync(src)) {
    const dst = path.join(claudeDir, d, e)
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
for (const [k, v] of Object.entries(m.settings)) {
  if (JSON.stringify(v).includes('<REDACTED>')) { report.failed.push(`settings.${k}: contains redacted secret, left untouched`); continue }
  const plain = o => o && typeof o === 'object' && !Array.isArray(o)
  next[k] = plain(v) && plain(cur[k]) ? { ...cur[k], ...v } : v
}
fs.writeFileSync(sp, JSON.stringify(next, null, 2))
report.ok.push('settings.json merged')

console.log(JSON.stringify(report, null, 2))
console.log('Machine-specific values (hook/statusLine commands, absolute paths) may still need fixing.')
