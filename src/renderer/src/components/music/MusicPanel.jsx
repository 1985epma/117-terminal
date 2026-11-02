import { useEffect, useState, useSyncExternalStore } from 'react'
import { music } from '../../lib/music.js'
import './music.css'

const SOURCES = [
  { id: 'spotify', label: 'Spotify', icon: '●' },
  { id: 'music', label: 'Apple Music', icon: '' }
]

// Terminal music players, installed with Homebrew and run as blocks.
const CLI_PLAYERS = [
  { id: 'spotify_player', label: 'spotify_player', desc: 'Full Spotify client in the terminal (needs Premium).', brew: 'spotify_player', run: 'spotify_player' },
  { id: 'ncspot', label: 'ncspot', desc: 'Lightweight ncurses Spotify client (needs Premium).', brew: 'ncspot', run: 'ncspot' },
  { id: 'shpotify', label: 'shpotify', desc: 'Control the Spotify app from the shell: spotify play, spotify next…', brew: 'shpotify', run: 'spotify status' }
]

const fmt = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Player({ s }) {
  const [seeking, setSeeking] = useState(null)
  const [vol, setVol] = useState(null)
  const playing = s.state === 'playing'
  const pos = seeking ?? s.position

  return (
    <div className="mp-player">
      {s.artwork ? <img className="mp-art" src={s.artwork} alt="" /> : <div className="mp-art mp-art-empty">♪</div>}
      <div className="mp-meta">
        <div className="mp-title">{s.title}</div>
        <div className="mp-artist">{s.artist}</div>
        <div className="mp-album">{s.album}</div>

        <div className="mp-progress">
          <span>{fmt(pos)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(1, s.duration)}
            step="1"
            value={Math.min(pos, s.duration)}
            onChange={(e) => setSeeking(Number(e.target.value))}
            onMouseUp={() => {
              music.control(s.id, 'seek', seeking)
              setSeeking(null)
            }}
          />
          <span>{fmt(s.duration)}</span>
        </div>

        <div className="mp-controls">
          <button className={`mp-small ${s.shuffle ? 'on' : ''}`} onClick={() => music.control(s.id, 'shuffle')} title="Shuffle">
            ⤮
          </button>
          <button onClick={() => music.control(s.id, 'previous')} title="Previous">
            ⏮
          </button>
          <button className="mp-play" onClick={() => music.control(s.id, 'playpause')} title="Play / Pause">
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => music.control(s.id, 'next')} title="Next">
            ⏭
          </button>
          <label className="mp-volume" title="Volume">
            🔊
            <input
              type="range"
              min="0"
              max="100"
              value={vol ?? s.volume}
              onChange={(e) => setVol(Number(e.target.value))}
              onMouseUp={() => {
                music.control(s.id, 'volume', vol)
                setVol(null)
              }}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

function Search({ id }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const text = query.trim()
    if (!text) return
    setNote('')
    if (id === 'spotify' && /spotify(:|\.com\/)/.test(text)) {
      const r = await window.eterm.music.playItem('spotify', text)
      setNote(r.ok ? 'Playing in Spotify.' : r.error)
      return music.refresh()
    }
    setBusy(true)
    const r = await window.eterm.music.search(id, text)
    setBusy(false)
    if (r.opened) setNote('Opened the search in Spotify. Paste a Spotify link here to play it directly.')
    else if (!r.ok) setNote(r.error)
    else setResults(r.results)
  }

  return (
    <div className="mp-search">
      <form onSubmit={submit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={id === 'spotify' ? 'Search Spotify, or paste a Spotify link…' : 'Search your Apple Music library…'}
          spellCheck={false}
        />
        <button className="primary" disabled={busy}>
          {busy ? <span className="meta-spinner" /> : id === 'spotify' ? 'Go' : 'Search'}
        </button>
      </form>
      {note && <div className="mp-note">{note}</div>}
      {results && (
        <div className="mp-results">
          {results.length === 0 && <div className="mp-note">No tracks found in your library.</div>}
          {results.map((t) => (
            <button
              key={t.id}
              className="mp-result"
              onClick={async () => {
                await window.eterm.music.playItem(id, t.id)
                music.refresh()
              }}
            >
              <span className="mp-r-play">▶</span>
              <span className="mp-r-title">{t.title}</span>
              <span className="mp-r-sub">
                {t.artist} · {t.album}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MusicPanel({ initialSource, onClose, onRunInTerminal }) {
  const state = useSyncExternalStore(music.subscribe, music.get)
  const [source, setSource] = useState(() => initialSource || music.active()?.id || 'spotify')
  const s = state[source]

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="music-panel">
        <div className="mp-head">
          <h2>♫ Music</h2>
          <div className="mp-sources">
            {SOURCES.map((x) => (
              <button key={x.id} className={`mp-source ${source === x.id ? 'sel' : ''} src-${x.id}`} onClick={() => setSource(x.id)}>
                <span className={`mp-dot ${state[x.id]?.state === 'playing' ? 'live' : ''}`} />
                {x.label}
              </button>
            ))}
          </div>
          <button className="settings-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!s ? (
          <div className="mp-empty">
            <span className="meta-spinner" /> Checking…
          </div>
        ) : !s.installed ? (
          <div className="mp-empty">
            {source === 'spotify' ? 'Spotify is not installed.' : 'Apple Music is not available.'}
            {source === 'spotify' && (
              <button onClick={() => onRunInTerminal('brew install --cask spotify')}>Install with Homebrew</button>
            )}
          </div>
        ) : s.state === 'error' ? (
          <div className="mp-empty">
            {s.error === 'permission'
              ? `117Terminal needs permission to control ${source === 'spotify' ? 'Spotify' : 'Music'}: System Settings › Privacy & Security › Automation.`
              : s.error}
          </div>
        ) : s.state === 'closed' || s.state === 'stopped' ? (
          <div className="mp-empty">
            {s.state === 'closed' ? `${source === 'spotify' ? 'Spotify' : 'Apple Music'} is not open.` : 'Nothing is playing.'}
            <button className="primary" onClick={() => music.control(source, 'play')}>
              ▶ Play
            </button>
            {s.state === 'closed' && <button onClick={() => window.eterm.music.open(source)}>Open app</button>}
          </div>
        ) : (
          <Player s={s} />
        )}

        {s?.installed && <Search id={source} />}

        {source === 'spotify' && (
          <div className="mp-cli">
            <div className="mp-cli-title">Spotify in the terminal</div>
            {CLI_PLAYERS.map((p) => (
              <div key={p.id} className="mp-cli-row">
                <div>
                  <code>{p.label}</code>
                  <span>{p.desc}</span>
                </div>
                <div className="mp-cli-actions">
                  <button onClick={() => onRunInTerminal(`brew install ${p.brew}`)}>Install</button>
                  <button onClick={() => onRunInTerminal(p.run)}>Run</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mp-foot">⌥⌘P play/pause · ⌥⌘← ⌥⌘→ previous/next · /music next</div>
      </div>
    </div>
  )
}
