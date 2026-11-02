import { app, BrowserWindow, Menu, screen, shell as electronShell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
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
import { parseArgs, helpText, usageError, completions, doctor, resolveToken, EXIT } from './cli.js'

// Shown in the macOS menu bar, Dock and app switcher instead of "Electron".
app.setName(appName())
app.setAboutPanelOptions({ applicationName: '117Terminal', applicationVersion: app.getVersion() })

// ---- command line (see cli.js) ---------------------------------------------
const userArgs = process.argv.slice(app.isPackaged ? 1 : 2)
const cli = isKeyExport() ? parseArgs([], undefined, { lenient: true }) : parseArgs(userArgs)
const finish = (text, code = EXIT.OK) => process.stdout.write(text, () => process.exit(code))
// Commands that only print, then exit without a window.
const printOnly = !!cli.error || ['help', 'version', 'completions', 'doctor'].includes(cli.command)
if (cli.error) process.exit(usageError(cli.error))
else if (cli.command === 'help') finish(helpText(app.getVersion()))
else if (cli.command === 'version') finish(`117Terminal ${app.getVersion()}\n`)
else if (cli.command === 'completions') finish(completions(cli.shell))
else if (cli.command === 'doctor') {
  app.dock?.hide()
  doctor({ version: app.getVersion(), userData: app.getPath('userData'), json: !!cli.flags.json }).then((code) => process.exit(code))
}

// Opened from a terminal: start the window in the background and give the prompt back
// (like `code .`). --wait keeps it attached.
const guiCommand = ['gui', 'run', 'theme'].includes(cli.command)
if (
  guiCommand &&
  !printOnly &&
  app.isPackaged &&
  process.platform !== 'win32' &&
  process.stdout.isTTY &&
  !cli.flags.wait &&
  !process.env.T117_DETACHED
) {
  spawn(process.execPath, userArgs, {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: { ...process.env, T117_DETACHED: '1' }
  }).unref()
  process.exit(EXIT.OK)
}
delete process.env.T117_DETACHED // keep it out of the shells this app starts

const migratedKeys = isKeyExport() || printOnly ? null : migrateBeforeReady()

const serve = cli.command === 'serve'
if (serve) {
  // Own Chromium profile, so it can run next to the desktop app.
  app.setPath('sessionData', path.join(app.getPath('userData'), 'serve-session'))
  // No display (server, container, HarmonyOS Linux env): Chromium picks its platform before
  // this code runs, so start again with --ozone-platform=headless and pass the exit code on.
  if (
    process.platform === 'linux' &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY &&
    !process.argv.some((a) => a.startsWith('--ozone-platform'))
  ) {
    const r = spawnSync(process.execPath, [...process.argv.slice(1), '--ozone-platform=headless'], { stdio: 'inherit' })
    process.exit(r.status ?? 1)
  }
  // Nothing is drawn in serve mode; skip the GPU (and its noisy errors on servers).
  app.disableHardwareAcceleration()
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

// Folders opened from Finder ("Open With", dropped on the Dock icon), `117terminal <dir>`,
// `117terminal run …` and launcher actions all become renderer actions. They wait until
// the page can take them.
let rendererReady = false
const pendingActions = []
function deliver(action) {
  if (rendererReady && mainWindow) {
    send('menu:action', action)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    pendingActions.push(action)
    if (app.isReady() && !mainWindow && !serve) createWindow()
  }
}
function openDir(p) {
  try {
    deliver(`openDir:${fs.statSync(p).isDirectory() ? p : path.dirname(p)}`)
  } catch {
    /* gone */
  }
}
// What a launch asks the window to do (first launch or a second one).
function dispatch(c) {
  c.dirs.forEach(openDir)
  if (c.run) deliver(`runCmd:${JSON.stringify({ cwd: c.cwd, command: c.run })}`)
  if (c.theme) deliver(`theme:${c.theme}`)
  if (c.flags['new-tab']) deliver('newTab')
  if (c.flags.settings) deliver('settings')
}
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
    for (const action of pendingActions.splice(0)) send('menu:action', action)
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

// One app per user (packaged builds): a second launch hands its arguments to the running app.
const secondary = app.isPackaged && guiCommand && !printOnly && !isKeyExport() && !app.requestSingleInstanceLock()
if (secondary) app.quit()
else
  app.on('second-instance', (_e, argv, cwd) => {
    const c = parseArgs(argv.slice(app.isPackaged ? 1 : 2), cwd, { lenient: true })
    const asked = c.dirs.length || c.run || c.theme || c.flags['new-tab'] || c.flags.settings
    if (asked) dispatch(c)
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else createWindow()
  })


if (isKeyExport()) runKeyExport()
else if (!secondary && !printOnly) app.whenReady().then(() => {
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
  dispatch(cli)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// stdout carries only the URL (or one JSON line), so `URL=$(117terminal serve)` works;
// everything for people goes to stderr. The URL is also written to web.json in the app's
// data folder, because a Windows GUI app has no console to print to.
async function startServe() {
  app.dock?.hide()
  const port = cli.port ?? 7117
  const host = cli.flags.host || '127.0.0.1'
  let token
  try {
    token = resolveToken(cli)
  } catch (err) {
    console.error(`117terminal: ${err.message}`)
    return app.exit(EXIT.ERROR)
  }
  try {
    const { url } = await startWebServer({ root: path.join(__dirname, '../renderer'), port, host, token })
    const info = path.join(app.getPath('userData'), 'web.json')
    fs.writeFileSync(info, JSON.stringify({ url, port, host, pid: process.pid }), { mode: 0o600 })
    const cleanup = () => fs.rmSync(info, { force: true })
    app.on('will-quit', cleanup)
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.quit())

    process.stdout.write(cli.flags.json ? `${JSON.stringify({ url, port, host })}\n` : `${url}\n`)
    if (process.stderr.isTTY) {
      process.stderr.write('\n  117Terminal web is running. Open the URL above (it carries the access token).\n')
      if (host !== '127.0.0.1' && host !== 'localhost') {
        process.stderr.write('  Listening on the network: anyone with this URL gets a shell on this machine. Keep the token secret.\n')
      }
      process.stderr.write('  Stop with Ctrl+C.\n\n')
    }
    if (cli.flags.open) electronShell.openExternal(url)
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`117terminal: port ${port} is already in use (try --port ${port + 1})`)
      return app.exit(EXIT.PORT_IN_USE)
    }
    console.error(`117terminal: web mode could not start: ${err.message}`)
    app.exit(EXIT.ERROR)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
