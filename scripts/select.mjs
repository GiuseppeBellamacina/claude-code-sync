// What to sync: --exclude / --only selectors shared by export.mjs and apply.mjs.
//
//   --exclude mcp,hooks            everything except the MCP servers and the hooks
//   --exclude mcp:docs-langchain   a single item (name match; also matches name@marketplace, name.sub, name/sub)
//   --only plugins,settings        nothing but those categories
//   (both flags can be repeated; excludes win over --only)
//
// Categories: plugins, marketplaces, mcp, settings (top-level setting names), hooks, skills, agents,
// commands, output-styles, themes, workflows, mods, claude-md, keybindings, extra.
export const CATEGORIES = ['plugins', 'marketplaces', 'mcp', 'settings', 'hooks', 'skills', 'agents', 'commands',
  'output-styles', 'themes', 'workflows', 'mods', 'claude-md', 'keybindings', 'extra']

const ALIAS = {
  plugin: 'plugins', marketplace: 'marketplaces', 'mcp-servers': 'mcp', mcpservers: 'mcp', skill: 'skills',
  agent: 'agents', command: 'commands', style: 'output-styles', styles: 'output-styles', theme: 'themes',
  workflow: 'workflows', mod: 'mods', 'claude.md': 'claude-md', claudemd: 'claude-md', keybinding: 'keybindings',
  hook: 'hooks', extras: 'extra',
}
const norm = c => { const k = c.trim().toLowerCase(); return ALIAS[k] ?? k }
const parse = raw => raw.split(',').map(s => s.trim()).filter(Boolean).map(s => {
  const i = s.indexOf(':')
  return i < 0 ? { cat: norm(s), raw: s } : { cat: norm(s.slice(0, i)), name: s.slice(i + 1), raw: s }
})
const hits = (e, cat, name) => e.cat === cat && (e.name === undefined
  || (name !== undefined && (name === e.name || ['.', '@', '/'].some(sep => name.startsWith(e.name + sep)))))

// `saved` is the selection recorded in a snapshot, so a pull knows what the push left out on purpose.
export function selection(argv, saved = {}) {
  const flag = n => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []))
  const exclude = [...(saved.exclude ?? []), ...flag('--exclude')].flatMap(parse)
  const only = [...(saved.only ?? []), ...flag('--only')].flatMap(parse)
  const unknown = [...exclude, ...only].filter(e => !CATEGORIES.includes(e.cat)).map(e => e.raw)
  return {
    unknown,
    exclude: exclude.map(e => e.raw),
    only: only.map(e => e.raw),
    allowed: (cat, name) => (!only.length || only.some(e => hits(e, cat, name))) && !exclude.some(e => hits(e, cat, name)),
    // true when something was explicitly excluded from this category (used to protect local data on replace)
    touches: cat => exclude.some(e => e.cat === cat) || (only.length > 0 && !only.some(e => e.cat === cat)),
  }
}
