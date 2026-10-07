// Push, verification: is the snapshot complete and clean?
//   node verify.mjs [--dir <folder>]    (default ~/.claude-sync)
// Re-exports the machine into a temp folder and diffs it against the pushed snapshot, scans the
// snapshot for leaked secrets, and checks externals.md. Prints JSON, exit code 2 if anything is wrong.
// (For a pull, use `apply.mjs --verify` with the same flags the pull used.)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const i = process.argv.indexOf('--dir')
const dir = path.resolve(i > 0 ? process.argv[i + 1] : path.join(os.homedir(), '.claude-sync'))
const tmp = path.join(os.tmpdir(), `setup-sync-verify-${process.pid}`)
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)
const tree = root => {
  const out = new Map()
  const walk = (f, rel) => {
    if (fs.statSync(f).isDirectory()) for (const e of fs.readdirSync(f)) walk(path.join(f, e), rel ? `${rel}/${e}` : e)
    else out.set(rel, crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'))
  }
  if (fs.existsSync(root)) walk(root, '')
  return out
}

const checks = []
const chk = (name, ok, detail) => checks.push({ name, ok, ...(detail ? { detail } : {}) })
const differences = []

const snap = readJson(path.join(dir, 'manifest.json'))
chk('manifest.json exists and parses', !!snap?.version)
if (snap) {
  try {
    // re-export with the same selection and extras the push used
    const args = [path.join(path.dirname(fileURLToPath(import.meta.url)), 'export.mjs'), '--dir', tmp]
    if (snap.selection?.exclude?.length) args.push('--exclude', snap.selection.exclude.join(','))
    if (snap.selection?.only?.length) args.push('--only', snap.selection.only.join(','))
    for (const x of snap.extras ?? []) args.push('--add', path.join(os.homedir(), x.rel))
    execFileSync(process.execPath, args, { stdio: 'ignore' })
    const live = readJson(path.join(tmp, 'manifest.json'))
    for (const k of ['settings', 'mcpServers', 'marketplaces', 'copied', 'redacted', 'extras'])
      if (stable(live[k]) !== stable(snap[k])) differences.push(`manifest.${k} differs from this machine now`)
    const a = tree(path.join(dir, 'files')), b = tree(path.join(tmp, 'files'))
    for (const [f, h] of b) if (!a.has(f)) differences.push(`missing in snapshot: files/${f}`); else if (a.get(f) !== h) differences.push(`content differs: files/${f}`)
    for (const f of a.keys()) if (!b.has(f)) differences.push(`only in snapshot (removed since push?): files/${f}`)
    chk('snapshot matches this machine (settings, plugins, MCP, marketplaces, files, mods)', differences.length === 0, differences.length ? `${differences.length} difference(s)` : undefined)

    // inventory tools nobody wrote down in externals.md: warnings for the agent, not failures
    const ext = fs.existsSync(path.join(dir, 'externals.md')) ? fs.readFileSync(path.join(dir, 'externals.md'), 'utf8') : ''
    chk('externals.md exists and is not empty', ext.trim().length > 0)
    var unmentioned = Object.keys(snap.inventory?.npmGlobals ?? {}).filter(n => !['npm', 'corepack'].includes(n) && !ext.includes(n))
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

// secret scan: names of patterns only, never the matched text
const PATTERNS = {
  'OpenAI/Anthropic-style key': /\bsk-[A-Za-z0-9_-]{20,}/, 'GitHub token': /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  'Slack token': /\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'AWS access key': /\bAKIA[0-9A-Z]{16}\b/,
  'Bearer token': /Bearer\s+[A-Za-z0-9._~+/-]{20,}/, 'private key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
}
const possibleSecrets = []
for (const [f] of tree(dir)) {
  const p = path.join(dir, f)
  if (fs.statSync(p).size > 2e6) continue
  const text = fs.readFileSync(p, 'utf8')
  for (const [name, re] of Object.entries(PATTERNS)) if (re.test(text)) possibleSecrets.push({ file: f, pattern: name })
}
chk('no secret-looking values in the snapshot', possibleSecrets.length === 0, possibleSecrets.length ? `${possibleSecrets.length} hit(s)` : undefined)

const ok = checks.every(c => c.ok)
console.log(JSON.stringify({ dir, checks, differences, unmentionedInventory: typeof unmentioned === 'undefined' ? [] : unmentioned, possibleSecrets, redacted: snap?.redacted ?? [] }, null, 2))
process.exit(ok ? 0 : 2)
