import { useMemo, useState } from 'react'

// Subsequence fuzzy match; lower score is better.
export function fuzzy(query, text) {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let ti = 0
  let score = 0
  let last = -1
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    score += found - last - 1
    last = found
    ti = found + 1
  }
  return score
}

export function ListOverlay({ placeholder, items, render, onPick, onClose, footer }) {
  const [index, setIndex] = useState(0)
  const safe = Math.min(index, Math.max(0, items.length - 1))

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      setIndex((safe + 1) % Math.max(1, items.length))
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      setIndex((safe - 1 + items.length) % Math.max(1, items.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[safe]) onPick(items[safe], e)
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel">
        {placeholder(onKeyDown, () => setIndex(0))}
        <div className="overlay-list">
          {items.length === 0 && <div className="overlay-empty">No matches</div>}
          {items.map((it, i) => (
            <div
              key={i}
              className={`overlay-item ${i === safe ? 'sel' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(it, e)
              }}
            >
              {render(it)}
            </div>
          ))}
        </div>
        {footer && <div className="overlay-footer">{footer}</div>}
      </div>
    </div>
  )
}

export default function CommandPalette({ actions, onRun, onClose }) {
  const [query, setQuery] = useState('')
  const items = useMemo(
    () =>
      actions
        .map((a) => ({ a, s: fuzzy(query, a.label) }))
        .filter((x) => x.s !== null)
        .sort((x, y) => x.s - y.s)
        .map((x) => x.a),
    [actions, query]
  )

  return (
    <ListOverlay
      items={items}
      onClose={onClose}
      onPick={(a) => onRun(a.id)}
      render={(a) => (
        <>
          <span>{a.label}</span>
          {a.hint && <kbd>{a.hint}</kbd>}
        </>
      )}
      placeholder={(onKeyDown, reset) => (
        <input
          autoFocus
          className="overlay-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            reset()
          }}
          onKeyDown={onKeyDown}
        />
      )}
      footer="↑↓ navigate · ↵ run · esc close"
    />
  )
}
