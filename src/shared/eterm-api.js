// The window.eterm API, built from a transport. The Electron preload passes
// ipcRenderer; the web build (117terminal --serve) passes a WebSocket.
export function createApi({ invoke, send, listen, platform }) {
  return {
    platform,
    pty: {
      create: (opts) => invoke('pty:create', opts),
      write: (id, data) => send('pty:write', id, data),
      resize: (id, cols, rows) => send('pty:resize', id, cols, rows),
      kill: (id) => send('pty:kill', id),
      onData: listen('pty:data'),
      onExit: listen('pty:exit')
    },
    complete: {
      path: (cwd, token) => invoke('complete:path', { cwd, token }),
      executables: () => invoke('complete:executables')
    },
    history: {
      load: () => invoke('history:load'),
      save: (items) => send('history:save', items)
    },
    ai: {
      config: () => invoke('ai:config'),
      update: (patch) => invoke('ai:update', patch),
      options: (opts) => invoke('ai:options', opts),
      models: (id) => invoke('ai:models', id),
      chat: (req) => send('ai:chat', req),
      abort: (requestId) => send('ai:abort', requestId),
      onEvent: listen('ai:event')
    },
    zsh: {
      status: () => invoke('zsh:status'),
      plugin: (id, on) => invoke('zsh:plugin', id, on),
      prompt: (id, preset) => invoke('zsh:prompt', id, preset),
      update: () => invoke('zsh:update'),
      otherTerminals: (on) => invoke('zsh:otherTerminals', on)
    },
    mcp: {
      list: () => invoke('mcp:list'),
      save: (name, def) => invoke('mcp:save', name, def),
      remove: (name) => invoke('mcp:remove', name),
      test: (name) => invoke('mcp:test', name),
      import: (source) => invoke('mcp:import', source),
      call: (name, args) => invoke('mcp:call', name, args)
    },
    brewcat: {
      status: () => invoke('brewcat:status'),
      profiles: () => invoke('brewcat:profiles'),
      search: (query, profile) => invoke('brewcat:search', { query, profile }),
      kits: (profile) => invoke('brewcat:kits', profile),
      open: () => invoke('brewcat:open')
    },
    music: {
      status: () => invoke('music:status'),
      control: (id, action, value) => invoke('music:control', id, action, value),
      open: (id) => invoke('music:open', id),
      search: (id, query) => invoke('music:search', id, query),
      playItem: (id, ref) => invoke('music:playItem', id, ref)
    },
    voice: {
      status: () => invoke('voice:status'),
      permission: () => invoke('voice:permission'),
      transcribe: (wavBase64, opts) => invoke('voice:transcribe', wavBase64, opts),
      toCommand: (text, ctx) => invoke('voice:toCommand', text, ctx),
      downloadModel: (key) => invoke('voice:downloadModel', key),
      onProgress: listen('voice:progress')
    },
    window: {
      prefs: () => invoke('window:prefs'),
      blur: (on) => invoke('window:blur', on)
    },
    serve: {
      status: () => invoke('serve:status'),
      start: (opts) => invoke('serve:start', opts),
      stop: () => invoke('serve:stop')
    },
    openExternal: (url) => invoke('app:open', url),
    clipboard: { write: (text) => send('clipboard:write', text) },
    info: () => invoke('app:info'),
    onMenu: listen('menu:action')
  }
}
