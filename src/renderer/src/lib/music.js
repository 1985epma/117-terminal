// Shared now-playing state for Spotify and Apple Music, polled from the main
// process: every second while something plays, every 4 s with a player open,
// every 15 s with none, and not at all while the window is hidden.
const listeners = new Set()
let state = { spotify: null, music: null }
let timer = null
let preferred = null // last source the user touched

function pick(s) {
  const live = ['spotify', 'music'].map((id) => s[id]).filter((x) => x && x.installed)
  return (
    live.find((x) => x.state === 'playing') ||
    live.find((x) => x.id === preferred && (x.state === 'paused' || x.state === 'stopped')) ||
    live.find((x) => x.state === 'paused') ||
    null
  )
}

let inflight = false

function schedule(ms) {
  clearTimeout(timer)
  timer = setTimeout(poll, ms)
}

async function poll() {
  clearTimeout(timer)
  timer = null
  // Hidden window: stop; visibilitychange starts it again. One poll at a time, so a
  // control click during a poll cannot start a second loop.
  if (document.hidden || inflight) return
  inflight = true
  try {
    state = await window.eterm.music.status()
  } catch {
    /* main not ready */
  } finally {
    inflight = false
  }
  listeners.forEach((fn) => fn())
  const players = [state.spotify, state.music]
  const playing = players.some((p) => p?.state === 'playing')
  const open = players.some((p) => p && !['closed', 'missing'].includes(p.state))
  schedule(playing ? 1000 : open ? 4000 : 15000)
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && listeners.size) poll()
  else if (document.hidden) clearTimeout(timer)
})

export const music = {
  subscribe(fn) {
    listeners.add(fn)
    if (!timer && !inflight) poll()
    return () => listeners.delete(fn)
  },
  get: () => state,
  // The source the mini player shows: playing first, then paused.
  active: () => pick(state),
  async control(id, action, value) {
    preferred = id
    const r = await window.eterm.music.control(id, action, value)
    schedule(250)
    return r
  },
  refresh() {
    clearTimeout(timer)
    poll()
  }
}
