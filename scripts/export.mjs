// Push, deterministic part: snapshot the user-level Claude Code setup into a folder.
// Usage: node export.mjs [--dir <folder>] [--exclude <sel,...>] [--only <sel,...>] [--add <path-in-home>]...
//   (default folder ~/.claude-sync; selectors: see select.mjs)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { selection } from './select.mjs'

const home = os.homedir()
const claudeDir = path.join(home, '.claude')
const i = process.argv.indexOf('--dir')
const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(home, '.claude-sync'))

const fail = msg => { console.error(msg); process.exit(1) }
const sel = selection(process.argv)
if (sel.unknown.length) fail(`Unknown category in --exclude/--only: ${sel.unknown.join(', ')}`)

// Extra files/folders the user asked for (--add). Only paths inside the home folder are portable.
const extraSpecs = process.argv.flatMap((a, i) => (a === '--add' && process.argv[i + 1] ? [process.argv[i + 1]] : []))
  .map(p0 => {
    const abs = path.resolve(p0.replace(/^~(?=$|[\\/])/, home))
    const rel = path.relative(home, abs).split(path.sep).join('/')
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail(`--add ${p0}: only paths inside your home folder can be synced`)
    if (abs === out || abs.startsWith(out + path.sep)) fail(`--add ${p0}: that is the sync folder itself`)
    if (!fs.existsSync(abs)) fail(`--add ${p0}: not found`)
    return { abs, rel, isDir: fs.statSync(abs).isDirectory() }
  })
  .filter(x => sel.allowed('extra', x.rel))

const readJson = (p, d = {}) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const sh = c => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }

// Secrets never leave the machine: env/header values with secret-looking names become a placeholder.
const SECRET = /key|token|secret|password|auth|credential/i
const redacted = []
const scrub = (obj, where) => {
  for (const f of ['env', 'headers']) for (const [k, v] of Object.entries(obj?.[f] ?? {}))
    if (SECRET.test(k)) { obj[f][k] = '<REDACTED>'; redacted.push(`${where}.${f}.${k}`) }
  return obj
}

const settings = readJson(path.join(claudeDir, 'settings.json'))
// What to sync: object-valued categories are filtered entry by entry, the rest by top-level key.
for (const k of Object.keys(settings)) {
  const cat = { enabledPlugins: 'plugins', extraKnownMarketplaces: 'marketplaces', hooks: 'hooks' }[k]
  if (!cat) { if (!sel.allowed('settings', k)) delete settings[k]; continue }
  for (const n of Object.keys(settings[k])) if (!sel.allowed(cat, n)) delete settings[k][n]
  if (!Object.keys(settings[k]).length) delete settings[k]
}
scrub(settings, 'settings')
// Absolute, machine-specific: rebuilt on pull from the mods copied below.
const pluginDirsVar = settings.env?.CLAUDE_CODE_PLUGIN_DIRS ?? process.env.CLAUDE_CODE_PLUGIN_DIRS ?? ''
if (settings.env) {
  delete settings.env.CLAUDE_CODE_PLUGIN_DIRS
  if (!Object.keys(settings.env).length) delete settings.env
}

const mcpServers = Object.fromEntries(Object.entries(readJson(path.join(home, '.claude.json')).mcpServers ?? {})
  .filter(([n]) => sel.allowed('mcp', n)))
for (const [n, s] of Object.entries(mcpServers)) scrub(s, `mcp.${n}`)

const marketplaces = Object.fromEntries(Object.entries(
  readJson(path.join(claudeDir, 'plugins', 'known_marketplaces.json'))).filter(([n]) => sel.allowed('marketplaces', n)).map(([n, m]) => [n, m.source]))

// Only ever wipe a previous snapshot, never an unrelated folder.
if (fs.existsSync(out) && fs.readdirSync(out).length && !fs.existsSync(path.join(out, 'manifest.json'))) {
  console.error(`${out} exists and is not a setup-sync snapshot; pick another folder or empty it.`)
  process.exit(1)
}
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'files'), { recursive: true })

// Hand-made user-level content. Skills installed by an external tool (graphify...) or managed
// by the app (synced, uuid buckets) are rebuilt by the agent from externals.md, not copied.
const SKIP_SKILL = /^(graphify|synced|\.?(bucket-)?[0-9a-f]{8}-[0-9a-f-]{27,})$/
const copied = []
for (const d of ['skills', 'agents', 'commands', 'output-styles', 'themes', 'workflows']) {
  const src = path.join(claudeDir, d)
  if (!fs.existsSync(src)) continue
  for (const e of fs.readdirSync(src)) {
    if (d === 'skills' && SKIP_SKILL.test(e)) continue
    if (!sel.allowed(d, e)) continue
    fs.cpSync(path.join(src, e), path.join(out, 'files', d, e), { recursive: true })
    copied.push(`${d}/${e}`)
  }
}
for (const f of ['CLAUDE.md', 'keybindings.json']) {
  const src = path.join(claudeDir, f)
  if (!sel.allowed(f === 'CLAUDE.md' ? 'claude-md' : 'keybindings')) continue
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(out, 'files', f)); copied.push(f) }
}

// Mods (and any plugin loaded from a folder): the hot-reload folders ~/.claude/dev-mods/<session>/<mod>
// plus every folder listed in CLAUDE_CODE_PLUGIN_DIRS. Deduped by plugin name, newest wins.
const isPlugin = d => fs.existsSync(path.join(d, '.claude-plugin', 'plugin.json'))
const candidates = []
const devMods = path.join(claudeDir, 'dev-mods')
if (fs.existsSync(devMods)) for (const sess of fs.readdirSync(devMods))
  for (const mod of fs.readdirSync(path.join(devMods, sess), { withFileTypes: true }))
    if (mod.isDirectory()) candidates.push(path.join(devMods, sess, mod.name))
candidates.push(...pluginDirsVar.split(path.delimiter).filter(Boolean))
const mods = new Map()
for (const d of candidates.filter(isPlugin)) {
  const name = readJson(path.join(d, '.claude-plugin', 'plugin.json')).name ?? path.basename(d)
  const mtime = fs.statSync(path.join(d, '.claude-plugin', 'plugin.json')).mtimeMs
  if (sel.allowed('mods', name) && (!mods.has(name) || mods.get(name).mtime < mtime)) mods.set(name, { dir: d, mtime })
}
for (const [name, { dir }] of mods) {
  fs.cpSync(dir, path.join(out, 'files', 'mods', name.replace(/[^\w.-]/g, '_')), {
    recursive: true,
    // node_modules is reinstallable; .claude-plugin/types is regenerated by the engine
    filter: f => !/[\\/](node_modules|\.claude-plugin[\\/]types)([\\/]|$)/.test(f),
  })
  copied.push(`mods/${name}`)
}

// Extra files/folders (--add), restored to the same place relative to the home folder.
const extras = []
for (const { abs, rel, isDir } of extraSpecs) {
  fs.cpSync(abs, path.join(out, 'files', 'extra', rel.replaceAll('/', '__')), {
    recursive: true, filter: f => !/[\\/]node_modules([\\/]|$)/.test(f),
  })
  extras.push({ rel, isDir })
  copied.push(`extra:${rel}`)
}

// Raw inventory of external tools; the agent decides what matters (LSP binaries, graphify, hf...).
const inventory = {
  node: sh('node -v'), npm: sh('npm -v'), uv: sh('uv --version'), gh: sh('gh --version')?.split('\n')[0],
  npmGlobals: (() => { try { return JSON.parse(sh('npm ls -g --depth=0 --json')).dependencies } catch { return null } })(),
  uvTools: sh('uv tool list'),
}

const manifest = {
  version: 1, createdAt: new Date().toISOString(), platform: process.platform,
  settings, mcpServers, marketplaces, copied, redacted, inventory,
  selection: { exclude: sel.exclude, only: sel.only }, extras,
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))

console.log(`Pushed to ${out}`)
console.log(`settings keys: ${Object.keys(settings).join(', ')}`)
console.log(`plugins: ${Object.keys(settings.enabledPlugins ?? {}).length}, marketplaces: ${Object.keys(marketplaces).join(', ')}`)
console.log(`mcp servers: ${Object.keys(mcpServers).join(', ') || '(none)'}`)
console.log(`hooks in settings: ${Object.keys(settings.hooks ?? {}).join(', ') || '(none)'}`)
console.log(`mods/plugin folders: ${[...mods.keys()].join(', ') || '(none)'}`)
console.log(`selection: ${sel.exclude.length || sel.only.length ? `exclude [${sel.exclude}] only [${sel.only}]` : '(everything)'}`)
console.log(`extra files: ${extras.map(x => x.rel).join(', ') || '(none)'}`)
console.log(`copied: ${copied.join(', ') || '(nothing)'}`)
console.log(`redacted secrets (set again by hand on the new machine): ${redacted.join(', ') || '(none)'}`)
