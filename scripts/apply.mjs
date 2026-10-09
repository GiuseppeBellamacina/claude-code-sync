// Pull, deterministic part: apply a pushed snapshot onto this machine, new or not.
//
//   node apply.mjs [--dir <folder>] [--mode overwrite|replace] [--plan] [--verify] [--decisions <file>]
//                  [--exclude <sel,...>] [--only <sel,...>]   (selectors: see select.mjs)
//
// Every item (marketplace, plugin, MCP server, file/folder, settings key) is compared with the local
// one and gets a status: new | same | conflict | localOnly | secret. What happens to it:
//   overwrite (default)  new -> add, conflict -> snapshot wins, localOnly -> kept
//   replace              same, but localOnly -> removed (the machine ends up exactly as the snapshot)
//   decisions file       {"<item id>": "snapshot" | "local" | "remove" | "both"} overrides the above
// --plan prints the items and changes nothing. A full backup is always taken before changing anything.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { selection } from './select.mjs'
import { home, claudeDir, claudeJson, copyTree, platformWarning } from './common.mjs'

const argv = process.argv
const arg = n => { const i = argv.indexOf(n); return i > 0 ? argv[i + 1] : undefined }
const dir = path.resolve(arg('--dir') ?? path.join(home, '.claude-sync'))
const mode = arg('--mode') ?? 'overwrite'
const planOnly = argv.includes('--plan')
if (!['overwrite', 'replace'].includes(mode)) { console.error(`Unknown --mode ${mode}`); process.exit(1) }

const readJson = (p, d = {}) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const decisions = arg('--decisions') ? readJson(path.resolve(arg('--decisions'))) : {}
const m = readJson(path.join(dir, 'manifest.json'), null)
if (!m) { console.error(`No manifest.json in ${dir}`); process.exit(1) }

// What to touch: the pull's own flags plus what the push left out on purpose (so `replace` never
// deletes local data the snapshot simply doesn't cover, e.g. MCP servers after `--exclude mcp`).
const sel = selection(argv, m.selection)
if (sel.unknown.length) { console.error(`Unknown category in --exclude/--only: ${sel.unknown.join(', ')}`); process.exit(1) }

// No shell by default: a shell would strip the quotes inside JSON arguments. npm-style installs ship
// claude.cmd, which needs a shell, so only then retry with every argument quoted.
const claude = args => {
  const r = spawnSync('claude', args, { encoding: 'utf8' })
  if (r.error?.code !== 'ENOENT' || process.platform !== 'win32') return r
  return spawnSync('claude', args.map(a => `"${a.replace(/"/g, '\\"')}"`), { encoding: 'utf8', shell: true })
}
const must = args => {
  const r = claude(args)
  if (r.error?.code === 'ENOENT') throw new Error('the `claude` command was not found in PATH (a shell alias is not enough)')
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || r.error?.message || '').trim().split('\n')[0] || `exit ${r.status}`)
}
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)
const eq = (a, b) => stable(a) === stable(b)
const short = v => (v === undefined ? undefined : (stable(v) ?? '').slice(0, 120))
const plain = o => o && typeof o === 'object' && !Array.isArray(o)
const REDACTED = v => JSON.stringify(v ?? null).includes('<REDACTED>')
const noModules = f => !/[\\/]node_modules([\\/]|$)/.test(f)
const copy = (src, dst) => copyTree(src, dst, noModules)
const hash = p => {
  const h = crypto.createHash('sha1')
  const walk = (f, rel) => {
    if (fs.statSync(f).isDirectory()) { for (const e of fs.readdirSync(f).sort()) if (e !== 'node_modules') walk(path.join(f, e), `${rel}/${e}`) }
    else h.update(`${rel}\0`).update(fs.readFileSync(f))
  }
  try { walk(p, '') } catch { return 'unreadable' } // e.g. a dangling symlink: never equal to the snapshot
  return h.digest('hex')
}

// ---------------------------------------------------------------- plan
let items = []
const add = (id, kind, status, snap, loc, run) => items.push({ id, kind, status, snap, loc, run })
const ops = [] // queued settings edits, applied at the end on a fresh read
const modDirs = []

// never touched on removal: this plugin, its marketplace, and Anthropic's default marketplace
const KEEP_MARKETPLACE = new Set(['cosmic-plugins', 'setup-sync', 'claude-plugins-official'])
const KEEP_PLUGIN = id => id.startsWith('setup-sync@')

// marketplaces
const localMk = Object.fromEntries(Object.entries(readJson(path.join(claudeDir, 'plugins', 'known_marketplaces.json')))
  .map(([n, v]) => [n, v.source]))
const mkArg = s => (s.source === 'github' ? s.repo : s.url ?? s.path)
for (const [name, s] of Object.entries(m.marketplaces)) {
  const status = !(name in localMk) ? 'new' : eq(localMk[name], s) ? 'same' : 'conflict'
  add(`marketplace:${name}`, 'marketplace', status, short(s), short(localMk[name]), {
    snapshot: () => {
      if (!mkArg(s)) throw new Error(`unknown source ${JSON.stringify(s)}`)
      if (status === 'conflict') must(['plugin', 'marketplace', 'remove', name])
      must(['plugin', 'marketplace', 'add', mkArg(s)])
    },
  })
}
for (const name of Object.keys(localMk))
  if (!(name in m.marketplaces) && !KEEP_MARKETPLACE.has(name))
    add(`marketplace:${name}`, 'marketplace', 'localOnly', undefined, short(localMk[name]), {
      remove: () => must(['plugin', 'marketplace', 'remove', name]),
    })

// plugins (installed even when disabled in the snapshot; the on/off state is a settings item)
const installed = readJson(path.join(claudeDir, 'plugins', 'installed_plugins.json')).plugins ?? {}
const snapPlugins = Object.keys(m.settings.enabledPlugins ?? {})
for (const id of snapPlugins)
  add(`plugin:${id}`, 'plugin', installed[id] ? 'same' : 'new', 'in snapshot', installed[id] ? 'installed' : undefined, {
    snapshot: () => must(['plugin', 'install', id]),
  })
for (const id of Object.keys(installed))
  if (!snapPlugins.includes(id) && !KEEP_PLUGIN(id) && (installed[id] ?? []).some(x => x.scope === 'user'))
    add(`plugin:${id}`, 'plugin', 'localOnly', undefined, 'installed', { remove: () => must(['plugin', 'uninstall', id]) })

// MCP servers (user scope). `claude mcp add-json` stores defaults (args: [], type: stdio), so compare normalized.
const normMcp = s => {
  const o = { ...s }
  if (Array.isArray(o.args) && !o.args.length) delete o.args
  for (const k of ['env', 'headers']) if (plain(o[k]) && !Object.keys(o[k]).length) delete o[k]
  if (o.type === 'stdio') delete o.type
  return o
}
const localMcp = readJson(claudeJson).mcpServers ?? {}
for (const [name, s] of Object.entries(m.mcpServers)) {
  const status = REDACTED(s) ? 'secret' : !(name in localMcp) ? 'new' : eq(normMcp(localMcp[name]), normMcp(s)) ? 'same' : 'conflict'
  add(`mcp:${name}`, 'mcp', status, short(s), short(localMcp[name]), {
    snapshot: () => {
      if (name in localMcp) must(['mcp', 'remove', '--scope', 'user', name])
      must(['mcp', 'add-json', '--scope', 'user', name, JSON.stringify(s)])
    },
  })
  items.at(-1).warning = platformWarning(m.platform, s)
}
for (const name of Object.keys(localMcp))
  if (!(name in m.mcpServers))
    add(`mcp:${name}`, 'mcp', 'localOnly', undefined, short(localMcp[name]), {
      remove: () => must(['mcp', 'remove', '--scope', 'user', name]),
    })

// files and folders. Same skip rule as export for skills owned by external tools or the app.
const SKIP_SKILL = /^(graphify|synced|\.?(bucket-)?[0-9a-f]{8}-[0-9a-f-]{27,})$/
const files = path.join(dir, 'files')
const MANAGED = ['skills', 'agents', 'commands', 'output-styles', 'themes', 'workflows', 'mods']
const fileItem = (id, kind, src, dst, isMod) => {
  const status = !src ? 'localOnly' : !fs.existsSync(dst) ? 'new' : hash(src) === hash(dst) ? 'same' : 'conflict'
  add(id, kind, status, src ? 'in snapshot' : undefined, fs.existsSync(dst) ? 'present' : undefined, {
    snapshot: () => { fs.rmSync(dst, { recursive: true, force: true }); copy(src, dst) },
    remove: () => fs.rmSync(dst, { recursive: true, force: true }),
    both: () => copy(src, `${dst}.synced`), // keep local, put the snapshot version next to it to merge by hand
    isMod,
    dst,
  })
}
const top = fs.existsSync(files) ? fs.readdirSync(files) : []
for (const d of top) {
  if (d === 'extra') continue // handled below, restored relative to the home folder
  const src = path.join(files, d)
  if (fs.statSync(src).isFile()) { fileItem(`file:${d}`, 'file', src, path.join(claudeDir, d)); continue }
  const base = d === 'mods' ? path.join(claudeDir, 'mods') : path.join(claudeDir, d)
  for (const e of fs.readdirSync(src).filter(x => !x.startsWith('.'))) fileItem(`${d}/${e}`, d === 'mods' ? 'mod' : 'file', path.join(src, e), path.join(base, e), d === 'mods')
}
for (const f of ['CLAUDE.md', 'keybindings.json'])
  if (!top.includes(f) && fs.existsSync(path.join(claudeDir, f))) fileItem(`file:${f}`, 'file', null, path.join(claudeDir, f))
for (const d of MANAGED) {
  const local = path.join(claudeDir, d)
  const inSnap = fs.existsSync(path.join(files, d)) ? fs.readdirSync(path.join(files, d)) : []
  if (fs.existsSync(local)) for (const e of fs.readdirSync(local))
    if (!e.startsWith('.') && !inSnap.includes(e) && !(d === 'skills' && SKIP_SKILL.test(e)) && !e.endsWith('.synced'))
      fileItem(`${d}/${e}`, d === 'mods' ? 'mod' : 'file', null, path.join(local, e), d === 'mods')
}

// extra files/folders the user asked to sync (--add on push): same place relative to the home folder
const unsafeExtras = []
for (const { rel } of m.extras ?? []) {
  if (!rel || path.isAbsolute(rel) || rel.split('/').includes('..')) { unsafeExtras.push(rel); continue }
  fileItem(`extra:${rel}`, 'extra', path.join(files, 'extra', rel.replaceAll('/', '__')), path.join(home, rel))
}

// settings: one item per top-level key, or per sub-key for objects (so hooks/env/enabledPlugins
// are resolved entry by entry). statusLine stays whole: its parts only make sense together.
const locS = readJson(path.join(claudeDir, 'settings.json'))
const ATOMIC = new Set(['statusLine'])
const settingsItem = (p, hasS, sv, hasL, lv) => {
  const id = `settings.${p.join('.')}`
  if (id === 'settings.env.CLAUDE_CODE_PLUGIN_DIRS') return // computed from the mods, see below
  const status = hasS && REDACTED(sv) ? 'secret' : hasS && !hasL ? 'new' : !hasS ? 'localOnly' : eq(sv, lv) ? 'same' : 'conflict'
  add(id, 'settings', status, hasS ? short(sv) : undefined, hasL ? short(lv) : undefined, {
    snapshot: () => ops.push(['set', p, sv]),
    remove: () => ops.push(['del', p]),
    path: p,
  })
  if (hasS) items.at(-1).warning = platformWarning(m.platform, sv)
}
for (const k of new Set([...Object.keys(m.settings), ...Object.keys(locS)])) {
  const sv = m.settings[k], lv = locS[k]
  if (!ATOMIC.has(k) && (plain(sv) || plain(lv)) && (plain(sv) || !(k in m.settings)) && (plain(lv) || !(k in locS))) {
    for (const sub of new Set([...Object.keys(sv ?? {}), ...Object.keys(lv ?? {})]))
      settingsItem([k, sub], sub in (sv ?? {}), sv?.[sub], sub in (lv ?? {}), lv?.[sub])
  } else settingsItem([k], k in m.settings, sv, k in locS, lv)
}

// ---------------------------------------------------------------- select
const keyOf = it => {
  const id = it.id
  if (id.startsWith('marketplace:')) return ['marketplaces', id.slice(12)]
  if (id.startsWith('plugin:')) return ['plugins', id.slice(7)]
  if (id.startsWith('mcp:')) return ['mcp', id.slice(4)]
  if (id === 'file:CLAUDE.md') return ['claude-md']
  if (id === 'file:keybindings.json') return ['keybindings']
  if (id.startsWith('extra:')) return ['extra', id.slice(6)]
  if (it.run.path) {
    const [k, n] = it.run.path
    const cat = { enabledPlugins: 'plugins', extraKnownMarketplaces: 'marketplaces', hooks: 'hooks' }[k]
    return cat ? [cat, n] : ['settings', it.run.path.join('.')]
  }
  const [d, e] = id.split('/')
  return [d, e]
}
const before = items.length
items = items.filter(it => sel.allowed(...keyOf(it)))
const excludedCount = before - items.length

// ---------------------------------------------------------------- decide
const choiceOf = it => {
  if (it.status === 'secret') return 'local'
  const d = decisions[it.id]
  if (d === 'both' && !it.run.both) return 'local'
  if (['snapshot', 'local', 'remove', 'both'].includes(d)) return d
  if (it.status === 'localOnly') return mode === 'replace' ? 'remove' : 'local'
  return 'snapshot'
}
const counts = {}
for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1

if (planOnly) {
  const interesting = items.filter(i => i.status !== 'same')
    .map(({ id, kind, status, snap, loc, warning }) => ({ id, kind, status, snapshot: snap, local: loc, ...(warning ? { warning } : {}) }))
  console.log(JSON.stringify({ dir, platform: { snapshot: m.platform, local: process.platform }, counts, excluded: excludedCount, selection: { exclude: sel.exclude, only: sel.only }, items: interesting }, null, 2))
  process.exit(0)
}

// ---------------------------------------------------------------- verify (run again after the pull, same flags)
// The plan is recomputed against the machine as it is now. Whatever was meant to change but still
// differs is a mismatch; what the user chose to keep is listed as such, not as a failure.
if (argv.includes('--verify')) {
  const mismatches = [], intentionallyKept = [], needsUser = []
  for (const it of items) {
    if (it.status === 'same') continue
    const c = choiceOf(it)
    if (it.status === 'secret') { if (it.loc === undefined) needsUser.push(it.id); continue }
    if (c === 'local') { intentionallyKept.push(it.id); continue }
    if (c === 'both' && it.run.dst && fs.existsSync(`${it.run.dst}.synced`)) { intentionallyKept.push(`${it.id} (+ .synced copy)`); continue }
    mismatches.push({ id: it.id, expected: c, actualStatus: it.status, snapshot: it.snap, local: it.loc })
  }
  const checks = []
  const chk = (name, ok, detail) => checks.push({ name, ok, ...(detail ? { detail } : {}) })
  try { JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8')); chk('settings.json parses', true) }
  catch (e) { chk('settings.json parses', false, e.message) }
  const loaded = (locS.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(path.delimiter).filter(Boolean).map(p => path.resolve(p))
  for (const it of items) if (it.run.isMod && it.status === 'same' && choiceOf(it) !== 'remove') {
    const dst = path.resolve(path.join(claudeDir, 'mods', it.id.split('/')[1]))
    chk(`mod ${it.id.split('/')[1]} registered in CLAUDE_CODE_PLUGIN_DIRS`, loaded.includes(dst), loaded.includes(dst) ? undefined : dst)
  }
  const backups = fs.existsSync(path.join(claudeDir, 'backups')) ? fs.readdirSync(path.join(claudeDir, 'backups')).filter(d => d.startsWith('pre-sync-')) : []
  chk('a pre-sync backup exists', backups.length > 0, backups.at(-1))
  chk('no unexpected leftovers', mismatches.length === 0, mismatches.length ? `${mismatches.length} item(s)` : undefined)
  console.log(JSON.stringify({ mode, counts, checks, mismatches, intentionallyKept, needsUser }, null, 2))
  process.exit(mismatches.length || checks.some(c => !c.ok) ? 2 : 0)
}

// ---------------------------------------------------------------- backup
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(claudeDir, 'backups', `pre-sync-${stamp}`)
fs.mkdirSync(backup, { recursive: true })
for (const f of ['settings.json', 'CLAUDE.md', 'keybindings.json'])
  if (fs.existsSync(path.join(claudeDir, f))) fs.copyFileSync(path.join(claudeDir, f), path.join(backup, f))
for (const d of MANAGED) if (fs.existsSync(path.join(claudeDir, d))) copy(path.join(claudeDir, d), path.join(backup, d))
fs.writeFileSync(path.join(backup, 'mcpServers.json'), JSON.stringify(localMcp, null, 2))
fs.writeFileSync(path.join(backup, 'marketplaces.json'), JSON.stringify(localMk, null, 2))
fs.writeFileSync(path.join(backup, 'plugins.json'), JSON.stringify(Object.keys(installed), null, 2))

// ---------------------------------------------------------------- apply (order = item order)
const report = { mode, backup, excluded: excludedCount, ok: [], skipped: [], failed: [], warnings: [] }
for (const it of items) if (it.warning && it.status !== 'same' && choiceOf(it) === 'snapshot') report.warnings.push(`${it.id}: ${it.warning}`)
for (const rel of unsafeExtras) report.failed.push(`extra:${rel}: unsafe path in the snapshot, refused`)
for (const it of items) {
  if (it.status === 'same') continue
  const c = choiceOf(it)
  if (it.status === 'secret') {
    if (it.loc === undefined) report.failed.push(`${it.id}: contains a secret, set by hand`)
    else report.skipped.push(`${it.id} (secret in snapshot, kept local)`)
    continue
  }
  if (c === 'local') { if (it.status !== 'localOnly') report.skipped.push(`${it.id} (kept local)`); continue }
  try { it.run[c === 'both' ? 'both' : c](); report.ok.push(`${it.id} (${c})`) }
  catch (e) { report.failed.push(`${it.id}: ${e.message}`) }
}

// settings last: plugin installs rewrite enabledPlugins, the snapshot's state must win
const sp = path.join(claudeDir, 'settings.json')
const next = readJson(sp)
for (const [op, p, val] of ops) {
  let o = next
  for (const k of p.slice(0, -1)) o = o[k] ??= {}
  if (op === 'set') o[p.at(-1)] = val
  else delete o[p.at(-1)]
}
for (const k of Object.keys(next)) if (plain(next[k]) && !Object.keys(next[k]).length && k in m.settings === false) delete next[k]

// mods are loaded through CLAUDE_CODE_PLUGIN_DIRS (machine-specific paths, so never taken from the snapshot)
for (const it of items) if (it.run.isMod) {
  const dst = path.join(claudeDir, 'mods', it.id.split('/')[1])
  if (fs.existsSync(dst) && !modDirs.includes(dst)) modDirs.push(dst)
}
const have = mode === 'replace' && !sel.touches('mods') ? [] : (next.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(path.delimiter).filter(Boolean)
const dirs = [...new Set([...have, ...modDirs])]
if (dirs.length) {
  next.env = { ...next.env, CLAUDE_CODE_PLUGIN_DIRS: dirs.join(path.delimiter) }
  report.ok.push(`CLAUDE_CODE_PLUGIN_DIRS: ${dirs.length} folder(s); restart Claude Code or run /reload-plugins`)
} else if (next.env) { delete next.env.CLAUDE_CODE_PLUGIN_DIRS; if (!Object.keys(next.env).length) delete next.env }
fs.writeFileSync(sp, JSON.stringify(next, null, 2))
report.ok.push('settings.json written')

console.log(JSON.stringify(report, null, 2))
console.log('Machine-specific values (hook/statusLine commands, absolute paths) may still need fixing.')
