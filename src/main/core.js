// Terminal core shared by the desktop window and the web server: PTYs,
// completion, history and small helpers. Events go out through broadcast().
import { app, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import pty from 'node-pty'
import { prepareShell } from './shell-integration.js'
import { ipcMain, broadcast } from './ipc.js'

const ptys = new Map()
const owners = new Map() // pty id -> who created it (window or web connection)
let executablesCache = null

// Electron events carry the sender; web calls pass { owner }.
const ownerOf = (e) => e?.owner ?? `window:${e?.sender?.id ?? 0}`

// Closes every shell a client opened (a reloaded window or a closed browser tab).
export function killOwner(owner) {
  for (const [id, o] of owners) {
    if (o !== owner) continue
    ptys.get(id)?.kill()
    ptys.delete(id)
    owners.delete(id)
  }
}

export function killAll() {
  for (const p of ptys.values()) p.kill()
  ptys.clear()
  owners.clear()
}

export function registerCoreIpc() {
  // ---- PTY ---------------------------------------------------------------

  ipcMain.handle('pty:create', (e, { id, cols, rows, cwd }) => {
    ptys.get(id)?.kill() // a renderer reload reuses session ids
    const { shell, args, env, bracketedPaste } = prepareShell(app.getPath('userData'))
    const startDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
    const p = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(cols || 80, 20),
      rows: Math.max(rows || 24, 5),
      cwd: startDir,
      env
    })
    ptys.set(id, p)
    owners.set(id, ownerOf(e))
    p.onData((data) => broadcast('pty:data', id, data))
    p.onExit(({ exitCode }) => {
      ptys.delete(id)
      owners.delete(id)
      broadcast('pty:exit', id, exitCode)
    })
    return { shell: path.basename(shell).replace(/\.exe$/i, ''), cwd: startDir, home: os.homedir(), bracketedPaste }
  })

  ipcMain.on('pty:write', (_e, id, data) => ptys.get(id)?.write(data))
  ipcMain.on('pty:resize', (_e, id, cols, rows) => {
    try {
      ptys.get(id)?.resize(Math.max(cols, 20), Math.max(rows, 5))
    } catch {
      /* pty already gone */
    }
  })
  ipcMain.on('pty:kill', (_e, id) => {
    ptys.get(id)?.kill()
    ptys.delete(id)
  })

  // ---- Completion ----------------------------------------------------------

  function expandHome(p) {
    return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p
  }

  ipcMain.handle('complete:path', (_e, { cwd, token }) => {
    try {
      const expanded = expandHome(token)
      const slash = expanded.lastIndexOf('/')
      const dirPart = slash >= 0 ? expanded.slice(0, slash + 1) : ''
      const prefix = slash >= 0 ? expanded.slice(slash + 1) : expanded
      const dir = path.resolve(cwd || os.homedir(), dirPart || '.')
      const shownDir = slash >= 0 ? token.slice(0, token.lastIndexOf('/') + 1) : ''
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.name.startsWith(prefix) && (prefix.startsWith('.') || !d.name.startsWith('.')))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 200)
        .map((d) => {
          let isDir = d.isDirectory()
          if (d.isSymbolicLink()) {
            try {
              isDir = fs.statSync(path.join(dir, d.name)).isDirectory()
            } catch {
              /* broken link */
            }
          }
          return { value: shownDir + d.name + (isDir ? '/' : ''), label: d.name, kind: isDir ? 'dir' : 'file' }
        })
    } catch {
      return []
    }
  })

  ipcMain.handle('complete:executables', () => {
    if (executablesCache) return executablesCache
    const seen = new Set()
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      try {
        for (const name of fs.readdirSync(dir)) seen.add(name)
      } catch {
        /* unreadable dir */
      }
    }
    executablesCache = [...seen].sort()
    return executablesCache
  })

  // ---- History -------------------------------------------------------------

  const historyFile = () => path.join(app.getPath('userData'), 'history.json')

  ipcMain.handle('history:load', () => {
    try {
      return JSON.parse(fs.readFileSync(historyFile(), 'utf8'))
    } catch {
      /* first run: seed from zsh history */
    }
    try {
      const raw = fs.readFileSync(path.join(os.homedir(), '.zsh_history'), 'latin1')
      const items = raw
        .split('\n')
        .map((l) => l.replace(/^: \d+:\d+;/, '').trim())
        .filter(Boolean)
      return [...new Set(items.reverse())].reverse().slice(-2000)
    } catch {
      return []
    }
  })

  ipcMain.on('history:save', (_e, items) => {
    try {
      fs.writeFileSync(historyFile(), JSON.stringify(items.slice(-5000)))
    } catch {
      /* ignore */
    }
  })

  ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(text))
  ipcMain.handle('app:info', () => ({ home: os.homedir(), platform: process.platform, version: app.getVersion() }))
}
