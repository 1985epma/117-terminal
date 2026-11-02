import { contextBridge, ipcRenderer } from 'electron'

const listen = (channel) => (cb) => {
  const fn = (_e, ...args) => cb(...args)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

contextBridge.exposeInMainWorld('eterm', {
  platform: process.platform,
  pty: {
    create: (opts) => ipcRenderer.invoke('pty:create', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: listen('pty:data'),
    onExit: listen('pty:exit')
  },
  complete: {
    path: (cwd, token) => ipcRenderer.invoke('complete:path', { cwd, token }),
    executables: () => ipcRenderer.invoke('complete:executables')
  },
  history: {
    load: () => ipcRenderer.invoke('history:load'),
    save: (items) => ipcRenderer.send('history:save', items)
  },
  ai: {
    config: () => ipcRenderer.invoke('ai:config'),
    update: (patch) => ipcRenderer.invoke('ai:update', patch),
    options: (opts) => ipcRenderer.invoke('ai:options', opts),
    models: (id) => ipcRenderer.invoke('ai:models', id),
    chat: (req) => ipcRenderer.send('ai:chat', req),
    abort: (requestId) => ipcRenderer.send('ai:abort', requestId),
    onEvent: listen('ai:event')
  },
  zsh: {
    status: () => ipcRenderer.invoke('zsh:status'),
    plugin: (id, on) => ipcRenderer.invoke('zsh:plugin', id, on),
    prompt: (id, preset) => ipcRenderer.invoke('zsh:prompt', id, preset),
    update: () => ipcRenderer.invoke('zsh:update'),
    otherTerminals: (on) => ipcRenderer.invoke('zsh:otherTerminals', on)
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    save: (name, def) => ipcRenderer.invoke('mcp:save', name, def),
    remove: (name) => ipcRenderer.invoke('mcp:remove', name),
    test: (name) => ipcRenderer.invoke('mcp:test', name),
    import: (source) => ipcRenderer.invoke('mcp:import', source),
    call: (name, args) => ipcRenderer.invoke('mcp:call', name, args)
  },
  brewcat: {
    status: () => ipcRenderer.invoke('brewcat:status'),
    profiles: () => ipcRenderer.invoke('brewcat:profiles'),
    search: (query, profile) => ipcRenderer.invoke('brewcat:search', { query, profile }),
    kits: (profile) => ipcRenderer.invoke('brewcat:kits', profile),
    open: () => ipcRenderer.invoke('brewcat:open')
  },
  music: {
    status: () => ipcRenderer.invoke('music:status'),
    control: (id, action, value) => ipcRenderer.invoke('music:control', id, action, value),
    open: (id) => ipcRenderer.invoke('music:open', id),
    search: (id, query) => ipcRenderer.invoke('music:search', id, query),
    playItem: (id, ref) => ipcRenderer.invoke('music:playItem', id, ref)
  },
  voice: {
    status: () => ipcRenderer.invoke('voice:status'),
    permission: () => ipcRenderer.invoke('voice:permission'),
    transcribe: (wavBase64, opts) => ipcRenderer.invoke('voice:transcribe', wavBase64, opts),
    toCommand: (text, ctx) => ipcRenderer.invoke('voice:toCommand', text, ctx),
    downloadModel: (key) => ipcRenderer.invoke('voice:downloadModel', key),
    onProgress: listen('voice:progress')
  },
  window: {
    prefs: () => ipcRenderer.invoke('window:prefs'),
    blur: (on) => ipcRenderer.invoke('window:blur', on)
  },
  clipboard: { write: (text) => ipcRenderer.send('clipboard:write', text) },
  info: () => ipcRenderer.invoke('app:info'),
  onMenu: listen('menu:action')
})
