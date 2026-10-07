// Push, deterministic part: snapshot the user-level Claude Code setup into a folder.
// Usage: node export.mjs [--dir <folder>]   (default ~/.claude-sync)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

const home = os.homedir()
const claudeDir = path.join(home, '.claude')
const i = process.argv.indexOf('--dir')
const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(home, '.claude-sync'))

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
scrub(settings, 'settings')

const mcpServers = readJson(path.join(home, '.claude.json')).mcpServers ?? {}
for (const [n, s] of Object.entries(mcpServers)) scrub(s, `mcp.${n}`)

const marketplaces = Object.fromEntries(Object.entries(
  readJson(path.join(claudeDir, 'plugins', 'known_marketplaces.json'))).map(([n, m]) => [n, m.source]))

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
for (const d of ['skills', 'agents', 'commands']) {
  const src = path.join(claudeDir, d)
  if (!fs.existsSync(src)) continue
  for (const e of fs.readdirSync(src)) {
    if (d === 'skills' && SKIP_SKILL.test(e)) continue
    fs.cpSync(path.join(src, e), path.join(out, 'files', d, e), { recursive: true })
    copied.push(`${d}/${e}`)
  }
}
const md = path.join(claudeDir, 'CLAUDE.md')
if (fs.existsSync(md)) { fs.copyFileSync(md, path.join(out, 'files', 'CLAUDE.md')); copied.push('CLAUDE.md') }

// Raw inventory of external tools; the agent decides what matters (LSP binaries, graphify, hf...).
const inventory = {
  node: sh('node -v'), npm: sh('npm -v'), uv: sh('uv --version'), gh: sh('gh --version')?.split('\n')[0],
  npmGlobals: (() => { try { return JSON.parse(sh('npm ls -g --depth=0 --json')).dependencies } catch { return null } })(),
  uvTools: sh('uv tool list'),
}

const manifest = {
  version: 1, createdAt: new Date().toISOString(), platform: process.platform,
  settings, mcpServers, marketplaces, copied, redacted, inventory,
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))

console.log(`Pushed to ${out}`)
console.log(`settings keys: ${Object.keys(settings).join(', ')}`)
console.log(`plugins: ${Object.keys(settings.enabledPlugins ?? {}).length}, marketplaces: ${Object.keys(marketplaces).join(', ')}`)
console.log(`mcp servers: ${Object.keys(mcpServers).join(', ') || '(none)'}`)
console.log(`hooks in settings: ${Object.keys(settings.hooks ?? {}).join(', ') || '(none)'}`)
console.log(`copied: ${copied.join(', ') || '(nothing)'}`)
console.log(`redacted secrets (set again by hand on the new machine): ${redacted.join(', ') || '(none)'}`)
