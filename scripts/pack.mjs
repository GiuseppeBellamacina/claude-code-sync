// Push, cloud variant: pack the whole snapshot folder (manifest.json, externals.md, push-report.md, files/**)
// into ONE self-contained HTML page, ready to be published as a Claude Artifact.
// Usage: node pack.mjs [--dir <folder>] [--out <file.html>]
//   (defaults: ~/.claude-sync, and <folder>.html next to it)
// The page shows the snapshot to a human and carries every file, byte for byte, in a JSON block that
// unpack.mjs reads back on the other machine.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { home } from './common.mjs'

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }
const dir = path.resolve(arg('--dir') ?? path.join(home, '.claude-sync'))
const out = path.resolve(arg('--out') ?? `${dir}.html`)
const fail = msg => { console.error(msg); process.exit(1) }

// Artifacts are capped at 16 MB; base64 and the page itself add to the payload, so stay well below.
export const TITLE = 'Setup Sync Snapshot'
const LIMIT = 12 * 1024 * 1024

if (!fs.existsSync(path.join(dir, 'manifest.json'))) fail(`No manifest.json in ${dir}: run the push first.`)
if (out === dir || out.startsWith(dir + path.sep)) fail('--out must be outside the sync folder.')

const files = []
const walk = (f, rel) => {
  const st = fs.statSync(f)
  if (st.isDirectory()) { for (const e of fs.readdirSync(f).sort()) walk(path.join(f, e), rel ? `${rel}/${e}` : e); return }
  const buf = fs.readFileSync(f)
  // Text stays readable inside the page; anything else (or invalid UTF-8) is base64.
  const text = !buf.includes(0) && Buffer.from(buf.toString('utf8'), 'utf8').equals(buf)
  files.push({
    path: rel, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    ...(st.mode & 0o111 ? { exec: true } : {}),
    encoding: text ? 'utf8' : 'base64', data: text ? buf.toString('utf8') : buf.toString('base64'),
  })
}
walk(dir, '')

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
const bundle = { format: 'setup-sync-bundle', version: 1, createdAt: manifest.createdAt, platform: manifest.platform, files }
// `<` is escaped so no file content can close the script tag; JSON.parse restores it.
const json = JSON.stringify(bundle).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const html = TEMPLATE().replace('/*__DATA__*/', () => json)
const bytes = Buffer.byteLength(html)
if (bytes > LIMIT) {
  const big = [...files].sort((a, b) => b.size - a.size).slice(0, 5).map(f => `  ${f.path} (${(f.size / 1048576).toFixed(1)} MB)`)
  fail(`The page would be ${(bytes / 1048576).toFixed(1)} MB; an Artifact holds at most 16 MB (limit used: 12 MB).\nLargest files:\n${big.join('\n')}\nPush again with --exclude for the big items (or without --add for big folders).`)
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, html)
console.log(`Packed ${files.length} files (${(bytes / 1048576).toFixed(2)} MB) into ${out}`)

// The page. The Artifact publisher wraps it in <html>/<head>/<body>, so this is a fragment.
function TEMPLATE() {
  return `<title>${TITLE}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
/* Layout: one narrow column; a summary on top, then the sections the pull reads, then every file. */
:root {
  --bg: #f4f6f7; --surface: #ffffff; --ink: #172126; --muted: #5a6a72; --line: #d5dde1;
  --accent: #0a6a86; --accent-ink: #ffffff; --warn: #8a5a00; --warn-bg: #fbf1dc; --code-bg: #eef2f4;
  --font-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0f1619; --surface: #162026; --ink: #e2eaed; --muted: #92a4ad; --line: #28363d;
  --accent: #5cc3df; --accent-ink: #072630; --warn: #f0c36a; --warn-bg: #2c2410; --code-bg: #0c1215; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #0f1619; --surface: #162026; --ink: #e2eaed; --muted: #92a4ad; --line: #28363d;
  --accent: #5cc3df; --accent-ink: #072630; --warn: #f0c36a; --warn-bg: #2c2410; --code-bg: #0c1215; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 15px/1.55 var(--font-body); padding-inline: 16px; padding-block: 28px 56px }
main { max-width: 52rem; margin-inline: auto; display: flex; flex-direction: column; gap: 28px; min-width: 0 }
h1 { font-size: 1.6rem; line-height: 1.2; margin: 0; font-weight: 600; text-wrap: balance }
h2 { font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; font-weight: 600 }
p { margin: 0 }
code, pre, .mono { font-family: var(--font-mono); font-size: 0.85rem }
.sub { color: var(--muted); margin-top: 6px }
section { min-width: 0 }
.how { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px }
.cmd { display: flex; gap: 8px; align-items: center; flex-wrap: wrap }
.cmd code { background: var(--code-bg); padding: 6px 10px; border-radius: 4px; overflow-wrap: anywhere }
button { font: inherit; font-size: 0.85rem; cursor: pointer; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-ink); border-radius: 4px; padding: 5px 12px }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.warn { background: var(--warn-bg); color: var(--warn); border-radius: 6px; padding: 12px 16px }
.warn ul { margin: 6px 0 0; padding-left: 1.2rem }
.table { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface) }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums }
td, th { text-align: left; padding: 8px 14px; border-bottom: 1px solid var(--line); vertical-align: top }
tr:last-child td { border-bottom: 0 }
td:last-child { text-align: right; color: var(--muted); white-space: nowrap }
th { font-weight: 500 } td.names { text-align: left; color: var(--muted); overflow-wrap: anywhere; white-space: normal }
details { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; min-width: 0 }
details + details { margin-top: 8px }
summary { cursor: pointer; padding: 9px 14px; display: flex; justify-content: space-between; gap: 12px; list-style-position: inside }
summary span:first-of-type { font-family: var(--font-mono); font-size: 0.85rem; overflow-wrap: anywhere }
summary .size { color: var(--muted); font-size: 0.8rem; white-space: nowrap; font-variant-numeric: tabular-nums }
pre { margin: 0; padding: 12px 14px; background: var(--code-bg); border-top: 1px solid var(--line); overflow-x: auto; max-height: 28rem; overflow-y: auto; white-space: pre; tab-size: 2 }
.note { color: var(--muted); font-size: 0.85rem }
</style>
<main id="app">
  <header>
    <h1>${TITLE}</h1>
    <p class="sub" id="meta"></p>
  </header>
</main>
<script type="application/json" id="setup-sync-data">/*__DATA__*/</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('setup-sync-data').textContent)
  var byPath = {}
  data.files.forEach(function (f) { byPath[f.path] = f })
  var json = function (p) { try { return JSON.parse(byPath[p].data) } catch (e) { return {} } }
  var m = json('manifest.json')
  var keys = function (o) { return Object.keys(o || {}) }
  var kb = function (n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB' }

  function h(tag, attrs) {
    var el = document.createElement(tag)
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]) })
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i]
      if (c == null) continue
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    }
    return el
  }
  var app = document.getElementById('app')
  var total = data.files.reduce(function (s, f) { return s + f.size }, 0)
  document.getElementById('meta').textContent =
    'Taken ' + new Date(data.createdAt).toLocaleString() + ' on ' + data.platform + ' · ' + data.files.length + ' files, ' + kb(total)

  // How to use it
  var cmd = '/setup-sync:pull --cloud'
  var copy = h('button', { type: 'button', id: 'copy' }, 'Copy')
  copy.addEventListener('click', function () {
    var done = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy' }, 1500) }
    try { navigator.clipboard.writeText(cmd).then(done, function () { copy.textContent = 'Select it' }) } catch (e) { copy.textContent = 'Select it' }
  })
  app.appendChild(h('section', {}, h('div', { class: 'how' },
    h('p', {}, 'This page is a complete copy of one Claude Code setup. On the new machine, in Claude Code, run:'),
    h('div', { class: 'cmd' }, h('code', {}, cmd), copy),
    h('p', { class: 'note' }, 'Claude reads this page, restores the folder and runs the normal pull. It is private to your account; ask Claude to delete it when you are done.'))))

  // What needs the user
  var redacted = m.redacted || []
  if (redacted.length || (m.warnings || []).length) {
    var ul = h('ul', {})
    redacted.forEach(function (r) { ul.appendChild(h('li', {}, h('code', {}, r), ' was a secret and is not stored. Enter it again.')) })
    ;(m.warnings || []).forEach(function (w) { ul.appendChild(h('li', {}, 'Not copied: ' + w)) })
    app.appendChild(h('section', {}, h('div', { class: 'warn' }, h('strong', {}, 'Needs you'), ul)))
  }

  // Summary table
  var groups = {}
  ;(m.copied || []).forEach(function (c) {
    var g = c.indexOf(':') > 0 ? c.split(':')[0] : c.indexOf('/') > 0 ? c.split('/')[0] : c
    ;(groups[g] = groups[g] || []).push(c.replace(/^[^/:]+[/:]/, ''))
  })
  var rows = [
    ['Marketplaces', keys(m.marketplaces)], ['Plugins', keys((m.settings || {}).enabledPlugins)],
    ['MCP servers', keys(m.mcpServers)], ['Hooks', keys((m.settings || {}).hooks)],
  ]
  Object.keys(groups).forEach(function (g) { rows.push([g.charAt(0).toUpperCase() + g.slice(1), groups[g]]) })
  var tbody = h('tbody', {})
  rows.filter(function (r) { return r[1].length }).forEach(function (r) {
    tbody.appendChild(h('tr', {}, h('th', { scope: 'row' }, r[0]), h('td', { class: 'names' }, r[1].join(', ')), h('td', {}, String(r[1].length))))
  })
  app.appendChild(h('section', {}, h('h2', {}, 'Contents'), h('div', { class: 'table' }, h('table', {}, tbody))))

  // Every file, text shown in full
  function fileBox(f, open) {
    var body = f.encoding === 'utf8' ? h('pre', {}, f.data) : h('pre', {}, 'Binary file, ' + kb(f.size) + ', stored as base64.')
    var d = h('details', {}, h('summary', {}, h('span', {}, f.path), h('span', { class: 'size' }, kb(f.size))), body)
    if (open) d.setAttribute('open', '')
    return d
  }
  var main = ['externals.md', 'push-report.md', 'manifest.json']
  main.filter(function (p) { return byPath[p] }).forEach(function (p) {
    app.appendChild(h('section', {}, h('h2', {}, p === 'externals.md' ? 'Install instructions' : p === 'push-report.md' ? 'Push report' : 'Manifest'), fileBox(byPath[p], p === 'externals.md')))
  })
  var rest = data.files.filter(function (f) { return main.indexOf(f.path) < 0 })
  if (rest.length) {
    var sec = h('section', {}, h('h2', {}, 'Files'))
    rest.forEach(function (f) { sec.appendChild(fileBox(f, false)) })
    app.appendChild(sec)
  }
})()
</script>
`
}
