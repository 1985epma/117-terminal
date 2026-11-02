import { useSyncExternalStore } from 'react'
import { music } from '../../lib/music.js'
import './music.css'

// Compact player in the tab bar; hidden when neither app has a track.
export default function NowPlaying({ onOpen }) {
  useSyncExternalStore(music.subscribe, music.get)
  const s = music.active()
  if (!s || !s.title) return null
  const playing = s.state === 'playing'

  return (
    <div className={`np ${playing ? 'playing' : ''}`}>
      <button className="np-info" onClick={onOpen} title={`${s.title} — ${s.artist} (${s.id === 'spotify' ? 'Spotify' : 'Apple Music'})`}>
        {s.artwork ? <img className="np-art" src={s.artwork} alt="" /> : <span className="np-art np-art-empty">♪</span>}
        <span className="np-text">
          <b>{s.title}</b>
          <span>{s.artist}</span>
        </span>
        {playing && (
          <span className="np-bars" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        )}
      </button>
      <button className="np-btn" onClick={() => music.control(s.id, 'previous')} title="Previous (⌥⌘←)">
        ⏮
      </button>
      <button className="np-btn" onClick={() => music.control(s.id, 'playpause')} title="Play / Pause (⌥⌘P)">
        {playing ? '⏸' : '▶'}
      </button>
      <button className="np-btn" onClick={() => music.control(s.id, 'next')} title="Next (⌥⌘→)">
        ⏭
      </button>
    </div>
  )
}
