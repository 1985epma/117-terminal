// Shared now-playing state for Spotify and Apple Music, polled from the main
// process. Polls fast while something plays, slowly otherwise.
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

async function poll() {
  try {
    state = await window.eterm.music.status()
  } catch {
    /* main not ready */
  }
  listeners.forEach((fn) => fn())
  const playing = state.spotify?.state === 'playing' || state.music?.state === 'playing'
  timer = setTimeout(poll, playing ? 1000 : 4000)
}

export const music = {
  subscribe(fn) {
    listeners.add(fn)
    if (!timer) poll()
    return () => listeners.delete(fn)
  },
  get: () => state,
  // The source the mini player shows: playing first, then paused.
  active: () => pick(state),
  async control(id, action, value) {
    preferred = id
    const r = await window.eterm.music.control(id, action, value)
    clearTimeout(timer)
    setTimeout(poll, 250)
    return r
  },
  refresh() {
    clearTimeout(timer)
    poll()
  }
}
