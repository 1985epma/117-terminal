import { useMemo, useState } from 'react'
import { ListOverlay } from './CommandPalette.jsx'
import { Highlighted } from '../lib/highlight.jsx'
import { history } from '../lib/history.js'

export default function HistorySearch({ onPick, onClose }) {
  const [query, setQuery] = useState('')
  const items = useMemo(() => history.search(query, 80), [query])

  return (
    <ListOverlay
      items={items}
      onClose={onClose}
      onPick={(cmd, e) => onPick(cmd, e.metaKey)}
      render={(cmd) => (
        <span className="mono history-cmd">
          <Highlighted text={cmd} />
        </span>
      )}
      placeholder={(onKeyDown, reset) => (
        <input
          autoFocus
          className="overlay-input"
          placeholder="Search command history…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            reset()
          }}
          onKeyDown={onKeyDown}
        />
      )}
      footer="↵ insert · ⌘↵ run now · esc close"
    />
  )
}
