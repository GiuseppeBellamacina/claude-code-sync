// Cross-platform helpers shared by export.mjs and apply.mjs (Windows, macOS, Linux).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const home = os.homedir()
export const isWin = process.platform === 'win32'

// CLAUDE_CONFIG_DIR relocates ~/.claude. The global state file (MCP servers) is looked up inside it
// first, then in the home folder.
export const claudeDir = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude')
const inCfg = path.join(claudeDir, '.claude.json')
export const claudeJson = process.env.CLAUDE_CONFIG_DIR && fs.existsSync(inCfg) ? inCfg : path.join(home, '.claude.json')

// Scripts that start with a shebang must be executable and have LF endings on macOS/Linux, which a copy
// from Windows loses (no exec bit, CRLF turns `#!/bin/sh\r` into a missing interpreter).
export function fixScripts(p) {
  if (fs.statSync(p).isDirectory()) { for (const e of fs.readdirSync(p)) fixScripts(path.join(p, e)); return }
  if (fs.statSync(p).size > 2e6) return
  const buf = fs.readFileSync(p)
  if (buf[0] !== 0x23 || buf[1] !== 0x21) return // "#!"
  const text = buf.toString('utf8')
  if (text.includes('\r\n')) fs.writeFileSync(p, text.replace(/\r\n/g, '\n'))
  fs.chmodSync(p, fs.statSync(p).mode | 0o755)
}

// Copy a file or folder so it still works on another machine: symlinks are followed (a link to an absolute
// path of the old machine would dangle), then scripts are fixed up on POSIX.
export function copyTree(src, dst, filter) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.cpSync(src, dst, { recursive: true, dereference: true, filter })
  if (!isWin) fixScripts(dst)
}

// Values that only make sense on the operating system the snapshot came from.
const WIN = /powershell|\.ps1\b|\.cmd\b|\.bat\b|\b[A-Za-z]:[\\/]|%USERPROFILE%|%APPDATA%|"command":"cmd(\.exe)?"|\bcmd(\.exe)?\s+\/c\b/i
const POSIX = /(^|[\s"'=:])\/(Users|home|usr|opt|bin|etc|var)\/|\.sh\b|\bbash\b|\bzsh\b|~\//
const family = p => (p === 'win32' ? 'win' : 'posix')

// Returns a short reason when `value` (a setting, an MCP server...) will not work on this machine, else undefined.
export function platformWarning(snapPlatform, value, local = process.platform) {
  if (!snapPlatform || snapPlatform === local) return undefined
  const text = JSON.stringify(value ?? null)
  if (family(snapPlatform) !== family(local))
    return (family(snapPlatform) === 'win' ? WIN : POSIX).test(text)
      ? `looks specific to ${snapPlatform} (commands or paths), this machine is ${local}` : undefined
  return /\/(Users|home)\//.test(text) ? `contains a home path of ${snapPlatform}, this machine is ${local}` : undefined
}
