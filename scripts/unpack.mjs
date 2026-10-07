// Pull, cloud variant: rebuild the sync folder from the HTML page made by pack.mjs.
// Usage: node unpack.mjs --html <file.html> [--dir <folder>]    (default folder ~/.claude-sync)
// Nothing is written until every entry has passed validation (safe path, matching sha256).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { home, isWin } from './common.mjs'

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }
const fail = msg => { console.error(msg); process.exit(1) }
const htmlPath = arg('--html')
if (!htmlPath) fail('Usage: node unpack.mjs --html <file.html> [--dir <folder>]')
const dir = path.resolve(arg('--dir') ?? path.join(home, '.claude-sync'))

const html = fs.readFileSync(path.resolve(htmlPath), 'utf8')
const open = html.match(/<script type="application\/json" id="setup-sync-data">/)
if (!open) fail('This page has no setup-sync data. Is it the snapshot page published by /setup-sync:push --cloud?')
const start = open.index + open[0].length
const end = html.indexOf('</script>', start)
let bundle
try { bundle = JSON.parse(html.slice(start, end)) } catch (e) { fail(`The embedded data does not parse (${e.message}). The page was probably truncated or edited.`) }
if (bundle?.format !== 'setup-sync-bundle' || bundle.version !== 1 || !Array.isArray(bundle.files))
  fail('Unknown bundle format or version; update the setup-sync plugin on this machine.')

// Only the files a push writes. A tampered page cannot place anything elsewhere.
const ALLOWED_TOP = new Set(['manifest.json', 'externals.md', 'push-report.md'])
const entries = bundle.files.map(f => {
  const parts = String(f.path ?? '').split('/')
  const safe = parts.every(p => p && p !== '.' && p !== '..' && !/[\\:\0]/.test(p))
  if (!safe || !(ALLOWED_TOP.has(f.path) || parts[0] === 'files' && parts.length > 1)) fail(`Refusing unsafe path in the bundle: ${f.path}`)
  if (f.encoding !== 'utf8' && f.encoding !== 'base64') fail(`${f.path}: unknown encoding`)
  const buf = f.encoding === 'utf8' ? Buffer.from(f.data, 'utf8') : Buffer.from(f.data, 'base64')
  if (buf.length !== f.size || crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256)
    fail(`${f.path}: content does not match its checksum. The page is corrupted; push again.`)
  return { rel: f.path, buf, exec: !!f.exec }
})
if (!entries.some(e => e.rel === 'manifest.json')) fail('The bundle has no manifest.json.')

// Same rule as push: only ever replace a previous snapshot, never an unrelated folder.
if (fs.existsSync(dir) && fs.readdirSync(dir).length && !fs.existsSync(path.join(dir, 'manifest.json')))
  fail(`${dir} exists and is not a setup-sync snapshot; pick another folder or empty it.`)
fs.rmSync(dir, { recursive: true, force: true })
for (const { rel, buf, exec } of entries) {
  const dst = path.join(dir, ...rel.split('/'))
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.writeFileSync(dst, buf, { mode: !isWin && exec ? 0o755 : 0o644 })
}

const m = JSON.parse(entries.find(e => e.rel === 'manifest.json').buf.toString('utf8'))
console.log(`Unpacked ${entries.length} files to ${dir}`)
console.log(`taken: ${bundle.createdAt} on ${bundle.platform}`)
console.log(`plugins: ${Object.keys(m.settings?.enabledPlugins ?? {}).length}, mcp servers: ${Object.keys(m.mcpServers ?? {}).length}, copied: ${(m.copied ?? []).length}`)
console.log(`externals.md: ${entries.some(e => e.rel === 'externals.md') ? 'present' : 'MISSING'}`)
