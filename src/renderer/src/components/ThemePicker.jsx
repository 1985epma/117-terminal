import { useEffect, useState } from 'react'
import { themes, DEFAULT_THEME } from '../lib/themes.js'

// A miniature terminal drawn with the theme's own colors.
function Preview({ t }) {
  const u = t.ui
  const a = t.ansi
  return (
    <div className="tp-preview" style={{ background: u.bg, borderColor: u.border, color: u.fg }}>
      <div className="tp-bar" style={{ background: u.panel, borderColor: u.border }}>
        <span style={{ background: a[1] }} />
        <span style={{ background: a[3] }} />
        <span style={{ background: a[2] }} />
      </div>
      <div className="tp-block" style={{ borderLeftColor: u.accent }}>
        <div style={{ color: u.muted }}>~/projects ⎇ main</div>
        <div>
          <b style={{ color: u.accent }}>❯</b> <span style={{ color: u.ok }}>git</span> status{' '}
          <span style={{ color: a[6] }}>-s</span>
        </div>
        <div>
          <span style={{ color: a[2] }}>M</span> src/app.js
        </div>
        <div>
          <span style={{ color: a[1] }}>D</span> old.txt
        </div>
      </div>
      <div className="tp-block" style={{ borderLeftColor: u.err, background: `color-mix(in srgb, ${u.err} 8%, transparent)` }}>
        <div>
          <b style={{ color: u.err }}>❯</b> <span style={{ color: u.ok }}>npm</span> test{' '}
          <span style={{ color: u.err }}>✕ exit 1</span>
        </div>
      </div>
      <div className="tp-agent" style={{ borderLeftColor: u.accent2 }}>
        <span style={{ color: u.accent2 }}>✦ Agent</span> fixing the test…
      </div>
      <div className="tp-swatches">
        {a.slice(0, 8).map((c, i) => (
          <span key={i} style={{ background: c, borderColor: u.border }} />
        ))}
      </div>
    </div>
  )
}

export default function ThemePicker({ current, onPick, onClose, opacity = 1, onOpacity, blur, onBlur }) {
  const keys = Object.keys(themes)
  const [index, setIndex] = useState(Math.max(0, keys.indexOf(current)))

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' && e.key !== 'Escape') return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setIndex((i) => (i + 1) % keys.length)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setIndex((i) => (i - 1 + keys.length) % keys.length)
      else if (e.key === 'Enter') onPick(keys[index])
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, keys, onClose, onPick])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="themes-panel">
        <div className="themes-head">
          <h2>Themes</h2>
          <span>↑↓←→ browse · ↵ apply · esc close</span>
        </div>
        <div className="tp-transparency">
          <label>
            Transparency
            <input
              type="range"
              min="0.35"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => onOpacity(Number(e.target.value))}
            />
            <b>{Math.round((1 - opacity) * 100)}%</b>
          </label>
          <label>
            <input type="checkbox" checked={blur} onChange={(e) => onBlur(e.target.checked)} />
            Blur what’s behind the window
          </label>
        </div>
        <div className="themes-grid">
          {keys.map((key, i) => {
            const t = themes[key]
            return (
              <button
                key={key}
                className={`theme-card ${key === current ? 'current' : ''} ${i === index ? 'focus' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => onPick(key)}
              >
                <Preview t={t} />
                <div className="theme-info">
                  <div className="theme-name">
                    {t.name}
                    {key === DEFAULT_THEME && <span className="theme-tag">default</span>}
                    {key === current && <span className="theme-check">✓ active</span>}
                  </div>
                  <div className="theme-desc">{t.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
