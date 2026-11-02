// One registry for every IPC channel. Handlers are registered with Electron
// (desktop window) and kept here so the web server can call the same ones
// over WebSocket (117terminal --serve).
import { ipcMain as electronIpc } from 'electron'

export const handlers = new Map() // channel -> (event, ...args) => value | Promise
export const listeners = new Map() // channel -> (event, ...args) => void

export const ipcMain = {
  handle(channel, fn) {
    handlers.set(channel, fn)
    electronIpc.handle(channel, fn)
  },
  on(channel, fn) {
    listeners.set(channel, fn)
    electronIpc.on(channel, fn)
  }
}

// Everyone who wants main-process events (pty:data, ai:event…): the desktop
// window and any connected web clients.
const sinks = new Set()
export function addSink(fn) {
  sinks.add(fn)
  return () => sinks.delete(fn)
}
export function broadcast(channel, ...args) {
  for (const fn of sinks) fn(channel, ...args)
}

// Stand-in for a BrowserWindow, for modules that send through getWindow().
export const broadcastWindow = {
  isDestroyed: () => false,
  webContents: { send: (channel, ...args) => broadcast(channel, ...args) }
}
