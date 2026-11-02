import { app, BrowserWindow, ipcMain, Menu, shell as electronShell, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import pty from 'node-pty'
import { prepareShell } from './shell-integration.js'
import { registerAiIpc, importKeys } from './ai.js'
import { registerZshIpc } from './zsh-plugins.js'
import { registerMcpIpc } from './mcp.js'
import { registerBrewcatIpc } from './brewcat.js'
import { registerMusicIpc } from './music.js'
import { shellEnv } from './shellenv.js'
import { appName, isKeyExport, runKeyExport, migrateBeforeReady } from './migrate.js'

// Shown in the macOS menu bar, Dock and app switcher instead of "Electron".
app.setName(appName())
app.setAboutPanelOptions({ applicationName: '117Terminal', applicationVersion: '0.1.0' })
const migratedKeys = isKeyExport() ? null : migrateBeforeReady()

// Window look (blur behind the window) survives restarts.
const windowPrefsFile = () => path.join(app.getPath('userData'), 'window.json')
function windowPrefs() {
  try {
    return { blur: true, ...JSON.parse(fs.readFileSync(windowPrefsFile(), 'utf8')) }
  } catch {
    return { blur: true }
  }
}

const ptys = new Map()
let mainWindow = null
let executablesCache = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 560,
    minHeight: 360,
    title: '117Terminal',
    // macOS: transparent so the page can choose its own opacity (Themes › Transparency).
    transparent: process.platform === 'darwin',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#000000',
    icon: process.platform === 'linux' ? path.join(__dirname, '../../build/icon.png') : undefined,
    autoHideMenuBar: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 13 },
    vibrancy: process.platform === 'darwin' && windowPrefs().blur ? 'under-window' : undefined,
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    electronShell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Reloading the renderer starts fresh sessions; drop the old shells.
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    for (const p of ptys.values()) p.kill()
    ptys.clear()
  })

  mainWindow.on('closed', () => {
    for (const p of ptys.values()) p.kill()
    ptys.clear()
    mainWindow = null
  })
}

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function buildMenu() {
  const cmd = (action) => () => send('menu:action', action)
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Shell',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: cmd('newTab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: cmd('closeTab') },
        { type: 'separator' },
        { label: 'Clear Blocks', accelerator: 'CmdOrCtrl+K', click: cmd('clear') },
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+P', click: cmd('palette') },
        { label: 'Search History', accelerator: 'Ctrl+R', click: cmd('history') },
        { type: 'separator' },
        { label: 'Toggle Agent Mode', accelerator: 'CmdOrCtrl+I', click: cmd('agentMode') },
        { label: 'New Agent Conversation', accelerator: 'CmdOrCtrl+Shift+I', click: cmd('agentReset') },
        { label: 'Agent Settings…', accelerator: 'CmdOrCtrl+,', click: cmd('agentSettings') },
        { type: 'separator' },
        { label: 'Extensions: Zsh, Prompt, MCP, brewcat…', accelerator: 'CmdOrCtrl+Shift+X', click: cmd('extensions') },
        { label: 'Music…', accelerator: 'CmdOrCtrl+Alt+M', click: cmd('music') },
        { label: 'Play / Pause Music', accelerator: 'CmdOrCtrl+Alt+P', click: cmd('music:playpause') },
        { label: 'Next Track', accelerator: 'CmdOrCtrl+Alt+Right', click: cmd('music:next') },
        { label: 'Previous Track', accelerator: 'CmdOrCtrl+Alt+Left', click: cmd('music:previous') }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Bigger Text', accelerator: 'CmdOrCtrl+=', click: cmd('fontUp') },
        { label: 'Smaller Text', accelerator: 'CmdOrCtrl+-', click: cmd('fontDown') },
        { label: 'Reset Text Size', accelerator: 'CmdOrCtrl+0', click: cmd('fontReset') },
        { label: 'Themes…', accelerator: 'CmdOrCtrl+Alt+T', click: cmd('themes') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', click: cmd('nextTab') },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', click: cmd('prevTab') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- PTY ---------------------------------------------------------------

ipcMain.handle('pty:create', (_e, { id, cols, rows, cwd }) => {
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
  p.onData((data) => send('pty:data', id, data))
  p.onExit(({ exitCode }) => {
    ptys.delete(id)
    send('pty:exit', id, exitCode)
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

ipcMain.handle('window:prefs', () => windowPrefs())
ipcMain.handle('window:blur', (_e, on) => {
  if (process.platform === 'darwin') mainWindow?.setVibrancy(on ? 'under-window' : null)
  fs.writeFileSync(windowPrefsFile(), JSON.stringify({ ...windowPrefs(), blur: !!on }))
  return windowPrefs()
})

ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(text))
ipcMain.handle('app:info', () => ({ home: os.homedir(), platform: process.platform }))

if (isKeyExport()) runKeyExport()
else app.whenReady().then(() => {
  // Packaged builds take the icon from build/icon.icns; in dev, set the Dock icon.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(app.getAppPath(), 'build', 'icon.png'))
  if (migratedKeys) importKeys(migratedKeys)
  shellEnv() // warm the login-shell environment for brew/git/npx lookups
  registerZshIpc()
  registerMcpIpc()
  registerBrewcatIpc()
  registerMusicIpc()
  registerAiIpc(() => mainWindow)
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
