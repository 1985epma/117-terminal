import { app, BrowserWindow, Menu, shell as electronShell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { registerAiIpc, importKeys } from './ai.js'
import { registerZshIpc } from './zsh-plugins.js'
import { registerMcpIpc } from './mcp.js'
import { registerBrewcatIpc } from './brewcat.js'
import { registerMusicIpc } from './music.js'
import { registerVoiceIpc } from './voice.js'
import { shellEnv } from './shellenv.js'
import { ipcMain, addSink, broadcastWindow } from './ipc.js'
import { registerCoreIpc, killOwner } from './core.js'
import { startWebServer } from './web-server.js'
import { appName, isKeyExport, runKeyExport, migrateBeforeReady } from './migrate.js'

// Shown in the macOS menu bar, Dock and app switcher instead of "Electron".
app.setName(appName())
app.setAboutPanelOptions({ applicationName: '117Terminal', applicationVersion: app.getVersion() })
const migratedKeys = isKeyExport() ? null : migrateBeforeReady()

// 117terminal --serve [--port 7117] [--host 127.0.0.1] [--token …] [--open]
function flag(name) {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (i === -1) return undefined
  const a = process.argv[i]
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1] ?? true
}
const serve = process.argv.includes('--serve')
if (serve) {
  // Own Chromium profile, so it can run next to the desktop app.
  app.setPath('sessionData', path.join(app.getPath('userData'), 'serve-session'))
  // No display (server, container, HarmonyOS Linux env): run Chromium headless.
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    app.commandLine.appendSwitch('ozone-platform', 'headless')
  }
}

// Window look (blur behind the window) survives restarts.
const windowPrefsFile = () => path.join(app.getPath('userData'), 'window.json')
function windowPrefs() {
  try {
    return { blur: true, ...JSON.parse(fs.readFileSync(windowPrefsFile(), 'utf8')) }
  } catch {
    return { blur: true }
  }
}

let mainWindow = null

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
  const owner = `window:${mainWindow.webContents.id}`
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) killOwner(owner)
  })

  const contents = mainWindow.webContents
  const off = addSink((channel, ...args) => {
    if (!contents.isDestroyed()) contents.send(channel, ...args)
  })
  mainWindow.on('closed', () => {
    off()
    killOwner(owner)
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
        { label: 'Voice Command', accelerator: 'CmdOrCtrl+Shift+Space', click: cmd('voice') },
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

ipcMain.handle('window:prefs', () => windowPrefs())
ipcMain.handle('window:blur', (_e, on) => {
  if (process.platform === 'darwin') mainWindow?.setVibrancy(on ? 'under-window' : null)
  fs.writeFileSync(windowPrefsFile(), JSON.stringify({ ...windowPrefs(), blur: !!on }))
  return windowPrefs()
})


if (isKeyExport()) runKeyExport()
else app.whenReady().then(() => {
  // Packaged builds take the icon from build/icon.icns; in dev, set the Dock icon.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(app.getAppPath(), 'build', 'icon.png'))
  if (migratedKeys) importKeys(migratedKeys)
  shellEnv() // warm the login-shell environment for brew/git/npx lookups
  registerCoreIpc()
  registerZshIpc()
  registerMcpIpc()
  registerBrewcatIpc()
  registerMusicIpc()
  registerVoiceIpc(() => broadcastWindow)
  registerAiIpc(() => broadcastWindow)
  if (serve) return startServe()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

async function startServe() {
  app.dock?.hide()
  const port = Number(flag('port')) || 7117
  const host = typeof flag('host') === 'string' ? flag('host') : '127.0.0.1'
  const token = typeof flag('token') === 'string' ? flag('token') : undefined
  try {
    const { url } = await startWebServer({ root: path.join(__dirname, '../renderer'), port, host, token })
    console.log(`\n  117Terminal web is running.\n\n  Open: ${url}\n`)
    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.log('  Listening on the network: anyone with this URL gets a shell on this machine. Keep the token secret.\n')
    }
    console.log('  Stop with Ctrl+C.\n')
    if (flag('open')) electronShell.openExternal(url)
  } catch (err) {
    console.error(`117Terminal web could not start: ${err.message}`)
    app.exit(1)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
