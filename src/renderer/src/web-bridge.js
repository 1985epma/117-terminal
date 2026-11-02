// window.eterm for the browser build (117terminal --serve): the same API as the
// Electron preload, carried over a WebSocket to the 117Terminal server.
import { createApi } from '../../shared/eterm-api.js'

const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
const pending = new Map()
const queue = []
const subscribers = new Map() // channel -> Set(callback)
let nextId = 1

function emit(channel, args) {
  for (const cb of subscribers.get(channel) || []) cb(...args)
}

function post(msg) {
  const text = JSON.stringify(msg)
  if (socket.readyState === WebSocket.OPEN) socket.send(text)
  else queue.push(text)
}

socket.addEventListener('open', () => queue.splice(0).forEach((m) => socket.send(m)))
socket.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.t === 'event') return emit(msg.ch, msg.args)
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  msg.ok ? p.resolve(msg.value) : p.reject(new Error(msg.error))
})
socket.addEventListener('close', () => {
  document.body.dataset.offline = 'true'
  for (const p of pending.values()) p.reject(new Error('Disconnected from 117Terminal'))
  pending.clear()
})

const listen = (channel) => (cb) => {
  if (!subscribers.has(channel)) subscribers.set(channel, new Set())
  subscribers.get(channel).add(cb)
  return () => subscribers.get(channel).delete(cb)
}

const api = createApi({
  invoke: (ch, ...args) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      post({ t: 'invoke', id, ch, args })
    }),
  send: (ch, ...args) => post({ t: 'send', ch, args }),
  listen,
  platform: 'web'
})

// Browser-side pieces: the page asks for the mic itself, copies with the
// Clipboard API, and has no native window effects.
api.voice.permission = async () => true
api.clipboard.write = (text) => navigator.clipboard?.writeText(text)
api.window.prefs = async () => ({ blur: false })
api.window.blur = async () => ({ blur: false })

// No app menu in a browser: map its shortcuts here. ⌘T/⌘W belong to the
// browser, so tabs use ⌥T/⌥W.
const KEYS = [
  [(e) => e.altKey && e.code === 'KeyT', 'newTab'],
  [(e) => e.altKey && e.code === 'KeyW', 'closeTab'],
  [(e) => (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'k', 'clear'],
  [(e) => (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'p', 'palette'],
  [(e) => e.ctrlKey && !e.metaKey && e.key === 'r', 'history'],
  [(e) => (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'i', 'agentMode'],
  [(e) => (e.metaKey || e.ctrlKey) && e.key === ',', 'agentSettings'],
  [(e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyX', 'extensions'],
  [(e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'Space', 'voice'],
  [(e) => (e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyT', 'themes']
]
window.addEventListener(
  'keydown',
  (e) => {
    const hit = KEYS.find(([match]) => match(e))
    if (!hit) return
    e.preventDefault()
    emit('menu:action', [hit[1]])
  },
  true
)

window.eterm = api
