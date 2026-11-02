import NowPlaying from './music/NowPlaying.jsx'
import { BrandMark, Wordmark } from './Logo.jsx'

export default function TabBar({ sessions, activeId, onSelect, onClose, onNew, onPalette, onMusic }) {
  return (
    <div className="tabbar">
      <div className="tabs">
        {sessions.map((s, i) => {
          const running = !!s.current
          return (
            <div
              key={s.id}
              className={`tab ${s.id === activeId ? 'active' : ''}`}
              onMouseDown={(e) => e.button === 1 && onClose(s.id)}
              onClick={() => onSelect(s.id)}
              title={s.cwd}
            >
              <span className={`tab-dot ${running ? 'running' : ''} ${s.state === 'exited' ? 'exited' : ''}`} />
              <span className="tab-title">{s.title}</span>
              {i < 9 && <span className="tab-key">⌘{i + 1}</span>}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(s.id)
                }}
                aria-label="Close tab"
              >
                ×
              </button>
            </div>
          )
        })}
        <button className="tab-new" onClick={onNew} title="New tab (⌘T)">
          +
        </button>
      </div>
      <div className="tabbar-right">
        <NowPlaying onOpen={onMusic} />
        <button className="palette-btn" onClick={onPalette} title="Command palette (⌘P)">
          <span>⌘P</span> Commands
        </button>
        <span className="brand">
          <BrandMark size={20} />
          <Wordmark seal={false} />
        </span>
      </div>
    </div>
  )
}
