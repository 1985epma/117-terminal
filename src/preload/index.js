import { contextBridge, ipcRenderer } from 'electron'
import { createApi } from '../shared/eterm-api.js'

const listen = (channel) => (cb) => {
  const fn = (_e, ...args) => cb(...args)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

contextBridge.exposeInMainWorld(
  'eterm',
  createApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    listen,
    platform: process.platform
  })
)
