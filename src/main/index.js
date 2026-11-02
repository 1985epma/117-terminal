import { app, BrowserWindow, Menu, screen, shell as electronShell } from 'electron'
import path from 'node:path'
import os from 'node:os'
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

function savePrefs(patch) {
  try {
    fs.writeFileSync(windowPrefsFile(), JSON.stringify({ ...windowPrefs(), ...patch }))
  } catch {
    /* read-only profile */
  }
}

// Reopen where it was closed, unless that spot is on a display that is gone now.
function savedBounds() {
  const b = windowPrefs().bounds
  if (!b) return { width: 1180, height: 760 }
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
  )
  return visible ? b : { width: b.width, height: b.height }
}

let mainWindow = null

// Folders opened from Finder ("Open With", dropped on the Dock icon) or passed as
// `117terminal <dir>` become new tabs. They wait until the page can take them.
let rendererReady = false
const pendingDirs = []
function openDir(p) {
  let dir = null
  try {
    dir = fs.statSync(p).isDirectory() ? p : path.dirname(p)
  } catch {
    return
  }
  if (rendererReady && mainWindow) {
    send('menu:action', `openDir:${dir}`)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    pendingDirs.push(dir)
    if (app.isReady() && !mainWindow && !serve) createWindow()
  }
}
const argvDirs = (argv, base = process.cwd()) =>
  argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-'))
    .map((a) => path.resolve(base, a))
    .filter((a) => fs.existsSync(a))
app.on('open-file', (e, p) => {
  e.preventDefault()
  openDir(p)
})

function createWindow() {
  mainWindow = new BrowserWindow({
    ...savedBounds(),
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

  rendererReady = false
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true
    for (const dir of pendingDirs.splice(0)) send('menu:action', `openDir:${dir}`)
  })

  if (windowPrefs().maximized) mainWindow.maximize()
  let saveTimer = null
  const saveBounds = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return
      const maximized = mainWindow.isMaximized()
      savePrefs(maximized ? { maximized } : { maximized, bounds: mainWindow.getBounds() })
    }, 400)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  const contents = mainWindow.webContents
  const off = addSink((channel, ...args) => {
    if (!contents.isDestroyed()) contents.send(channel, ...args)
  })
  mainWindow.on('closed', () => {
    off()
    killOwner(owner)
    mainWindow = null
    rendererReady = false
  })
}

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function buildMenu() {
  const cmd = (action) => () => send('menu:action', action)
  const mac = process.platform === 'darwin'
  const settings = { label: mac ? 'Settings…' : 'Preferences…', accelerator: 'CmdOrCtrl+,', click: cmd('settings') }
  const template = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settings,
              {
                label: 'Secure Keyboard Entry',
                type: 'checkbox',
                checked: !!windowPrefs().secureKeyboard,
                click: (item) => {
                  app.setSecureKeyboardEntryEnabled(item.checked)
                  savePrefs({ secureKeyboard: item.checked })
                }
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),
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
        { label: 'Zsh Plugins && Prompt…', accelerator: 'CmdOrCtrl+Shift+X', click: cmd('settings:shell') },
        { label: 'Open in Browser (Web Mode)…', click: cmd('settings:web') },
        ...(mac ? [] : [{ type: 'separator' }, settings, { type: 'separator' }, { role: 'quit' }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Bigger Text', accelerator: 'CmdOrCtrl+=', click: cmd('fontUp') },
        { label: 'Smaller Text', accelerator: 'CmdOrCtrl+-', click: cmd('fontDown') },
        { label: 'Reset Text Size', accelerator: 'CmdOrCtrl+0', click: cmd('fontReset') },
        { type: 'separator' },
        { label: 'Themes && Transparency…', accelerator: 'CmdOrCtrl+Alt+T', click: cmd('settings:appearance') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', click: cmd('nextTab') },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', click: cmd('prevTab') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Developer', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] }
      ]
    },
    {
      label: 'Agent',
      submenu: [
        { label: 'Toggle Agent Mode', accelerator: 'CmdOrCtrl+I', click: cmd('agentMode') },
        { label: 'New Conversation', accelerator: 'CmdOrCtrl+Shift+I', click: cmd('agentReset') },
        { type: 'separator' },
        { label: 'Voice Command', accelerator: 'CmdOrCtrl+Shift+Space', click: cmd('voice') },
        { type: 'separator' },
        { label: 'Providers && Models…', click: cmd('settings:agent') },
        { label: 'MCP Servers…', click: cmd('settings:mcp') },
        { label: 'Voice Settings…', click: cmd('settings:voice') }
      ]
    },
    {
      label: 'Music',
      submenu: [
        { label: 'Open Player…', accelerator: 'CmdOrCtrl+Alt+M', click: cmd('music') },
        { type: 'separator' },
        { label: 'Play / Pause', accelerator: 'CmdOrCtrl+Alt+P', click: cmd('music:playpause') },
        { label: 'Next Track', accelerator: 'CmdOrCtrl+Alt+Right', click: cmd('music:next') },
        { label: 'Previous Track', accelerator: 'CmdOrCtrl+Alt+Left', click: cmd('music:previous') }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: cmd('settings:shortcuts') },
        { label: '117Terminal on GitHub', click: () => electronShell.openExternal('https://github.com/1985epma/117-terminal') },
        { label: 'Report an Issue', click: () => electronShell.openExternal('https://github.com/1985epma/117-terminal/issues') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Settings › Web: start the browser UI from the desktop app.
let web = null
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
}
function webStatus() {
  if (serve) return { mode: 'serve' }
  if (!web) return { running: false }
  const lan = web.network && lanAddress()
  return {
    running: true,
    port: web.port,
    network: web.network,
    url: web.url,
    lanUrl: lan ? web.url.replace('localhost', lan) : null
  }
}
ipcMain.handle('serve:status', () => webStatus())
ipcMain.handle('serve:start', async (_e, { port = 7117, network = false } = {}) => {
  if (serve) return webStatus()
  if (web) await web.close()
  web = null
  try {
    const host = network ? '0.0.0.0' : '127.0.0.1'
    const r = await startWebServer({ root: path.join(__dirname, '../renderer'), port: Number(port) || 7117, host })
    web = { ...r, port: Number(port) || 7117, network }
    return webStatus()
  } catch (err) {
    return { running: false, error: err.code === 'EADDRINUSE' ? `Port ${port} is already in use` : err.message }
  }
})
ipcMain.handle('serve:stop', async () => {
  if (web) await web.close()
  web = null
  return webStatus()
})
ipcMain.handle('app:open', (_e, url) => {
  if (/^https?:\/\//.test(url)) electronShell.openExternal(url)
})

ipcMain.handle('window:prefs', () => windowPrefs())
ipcMain.handle('window:blur', (_e, on) => {
  if (process.platform === 'darwin') mainWindow?.setVibrancy(on ? 'under-window' : null)
  savePrefs({ blur: !!on })
  return windowPrefs()
})

// One app per user (packaged builds): `117terminal <dir>` while it runs opens a tab there.
const secondary = app.isPackaged && !serve && !isKeyExport() && !app.requestSingleInstanceLock()
if (secondary) app.quit()
else
  app.on('second-instance', (_e, argv, cwd) => {
    const dirs = argvDirs(argv, cwd)
    if (dirs.length) dirs.forEach(openDir)
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else createWindow()
  })


if (isKeyExport()) runKeyExport()
else if (!secondary) app.whenReady().then(() => {
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
  if (process.platform === 'darwin' && windowPrefs().secureKeyboard) app.setSecureKeyboardEntryEnabled(true)
  buildMenu()
  createWindow()
  argvDirs(process.argv).filter((d) => d !== app.getAppPath()).forEach(openDir)
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
