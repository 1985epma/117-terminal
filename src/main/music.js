// Built-in music controls for Spotify and Apple Music via AppleScript.
// Scripts only talk to an app that is already running, so polling never
// launches anything. macOS asks once for Automation permission per app.
import { app } from 'electron'
import { ipcMain } from './ipc.js'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const SEP = '\u001f'
const APPS = {
  spotify: { name: 'Spotify', bundle: '/Applications/Spotify.app' },
  music: { name: 'Music', bundle: '/System/Applications/Music.app' }
}

function osa(script, timeout = 4000) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout).trim(), error: (stderr || err?.message || '').trim() })
    )
  })
}

const installed = (id) => fs.existsSync(APPS[id].bundle) || fs.existsSync(path.join(app.getPath('home'), 'Applications', `${APPS[id].name}.app`))
const num = (s) => Number(String(s).replace(',', '.')) || 0
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function statusScript(id) {
  const name = APPS[id].name
  const artwork = id === 'spotify' ? 'artwork url of t' : '""'
  const duration = id === 'spotify' ? '(duration of t) / 1000' : 'duration of t'
  const shuffle = id === 'spotify' ? 'shuffling' : 'shuffle enabled'
  const trackId = id === 'spotify' ? 'id of t' : 'persistent ID of t'
  return `
if application "${name}" is running then
  tell application "${name}"
    set s to player state as string
    if s is "stopped" then return "stopped"
    set t to current track
    set d to "${SEP}"
    return s & d & (name of t) & d & (artist of t) & d & (album of t) & d & (player position as string) & d & ((${duration}) as string) & d & ${artwork} & d & (sound volume as string) & d & (${shuffle} as string) & d & ${trackId}
  end tell
else
  return "closed"
end if`
}

// Apple Music only exposes artwork as raw data: save it once per track.
const artCache = new Map()
async function musicArtwork(trackId) {
  if (artCache.has(trackId)) return artCache.get(trackId)
  const file = path.join(app.getPath('temp'), `117terminal-art-${trackId}.jpg`)
  const r = await osa(`
tell application "Music"
  try
    set a to data of artwork 1 of current track
    set f to open for access (POSIX file ${q(file)}) with write permission
    set eof f to 0
    write a to f
    close access f
    return "ok"
  on error
    return "none"
  end try
end tell`)
  let url = ''
  if (r.out === 'ok' && fs.existsSync(file)) {
    url = `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`
    fs.rmSync(file, { force: true })
  }
  artCache.set(trackId, url)
  return url
}

async function statusOf(id) {
  if (!installed(id)) return { id, installed: false, state: 'missing' }
  const r = await osa(statusScript(id))
  if (!r.ok) return { id, installed: true, state: 'error', error: /not allowed|-1743/i.test(r.error) ? 'permission' : r.error }
  if (r.out === 'closed' || r.out === 'stopped') return { id, installed: true, state: r.out }
  const [state, title, artist, album, position, duration, artwork, volume, shuffle, trackId] = r.out.split(SEP)
  const s = {
    id,
    installed: true,
    state, // playing | paused
    title,
    artist,
    album,
    position: num(position),
    duration: num(duration),
    artwork,
    volume: num(volume),
    shuffle: shuffle === 'true',
    trackId
  }
  if (id === 'music' && trackId) s.artwork = await musicArtwork(trackId)
  return s
}

const COMMANDS = {
  spotify: {
    playpause: 'playpause',
    play: 'play',
    pause: 'pause',
    next: 'next track',
    previous: 'previous track',
    shuffle: 'set shuffling to not shuffling',
    volume: (v) => `set sound volume to ${Math.round(v)}`,
    seek: (s) => `set player position to ${Number(s)}`,
    uri: (u) => `play track ${q(u)}`
  },
  music: {
    playpause: 'playpause',
    play: 'play',
    pause: 'pause',
    next: 'next track',
    previous: 'back track',
    shuffle: 'set shuffle enabled to not shuffle enabled',
    volume: (v) => `set sound volume to ${Math.round(v)}`,
    seek: (s) => `set player position to ${Number(s)}`
  }
}

async function control(id, action, value) {
  const cmd = COMMANDS[id]?.[action]
  if (!cmd) return { ok: false, error: `Unsupported: ${action}` }
  const line = typeof cmd === 'function' ? cmd(value) : cmd
  // Explicit play starts the app if needed; everything else needs it running.
  const guard = action === 'play' || action === 'playpause' || action === 'uri'
  const r = await osa(
    guard
      ? `tell application "${APPS[id].name}" to ${line}`
      : `if application "${APPS[id].name}" is running then tell application "${APPS[id].name}" to ${line}`
  )
  return { ok: r.ok, error: r.error }
}

// Spotify share links → URIs (open.spotify.com/track/ID → spotify:track:ID).
function spotifyUri(input) {
  const m = input.match(/open\.spotify\.com\/(?:intl-\w+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/)
  if (m) return `spotify:${m[1]}:${m[2]}`
  return /^spotify:/.test(input) ? input : null
}

async function searchMusic(query) {
  const r = await osa(
    `
tell application "Music"
  set out to ""
  set found to (every track of library playlist 1 whose name contains ${q(query)} or artist contains ${q(query)} or album contains ${q(query)})
  set n to 0
  repeat with t in found
    set n to n + 1
    if n > 40 then exit repeat
    set out to out & (persistent ID of t) & "${SEP}" & (name of t) & "${SEP}" & (artist of t) & "${SEP}" & (album of t) & linefeed
  end repeat
  return out
end tell`,
    15000
  )
  if (!r.ok) return { ok: false, error: r.error }
  const results = r.out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [id, title, artist, album] = l.split(SEP)
      return { id, title, artist, album }
    })
  return { ok: true, results }
}

export function registerMusicIpc() {
  ipcMain.handle('music:status', async () => {
    const [spotify, music] = await Promise.all([statusOf('spotify'), statusOf('music')])
    return { spotify, music }
  })

  ipcMain.handle('music:control', (_e, id, action, value) => control(id, action, value))

  ipcMain.handle('music:open', (_e, id) => {
    execFile('open', ['-a', APPS[id].name])
    return true
  })

  ipcMain.handle('music:search', (_e, id, query) => {
    if (id === 'music') return searchMusic(query)
    // Spotify's catalog search needs its Web API; open the app's search instead.
    execFile('open', [`spotify:search:${encodeURIComponent(query)}`])
    return { ok: true, results: [], opened: true }
  })

  ipcMain.handle('music:playItem', async (_e, id, ref) => {
    if (id === 'spotify') {
      const uri = spotifyUri(ref)
      if (!uri) return { ok: false, error: 'Paste a Spotify link or spotify: URI' }
      return control('spotify', 'uri', uri)
    }
    const r = await osa(`tell application "Music" to play (first track of library playlist 1 whose persistent ID is ${q(ref)})`, 10000)
    return { ok: r.ok, error: r.error }
  })
}
