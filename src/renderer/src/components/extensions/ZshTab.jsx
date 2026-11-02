import { useEffect, useMemo, useState } from 'react'

const GROUPS = ['Essentials', 'Productivity', 'Oh My Zsh', 'Tools']

// Plugins (itself or something it requires) whose binary has to come from Homebrew first.
function missingFormulas(p, byId) {
  const out = []
  if (p.kind === 'tool' && !p.installed && p.brew) out.push(p.brew)
  for (const r of p.requires || []) {
    const dep = byId[r]
    if (dep && dep.kind === 'tool' && !dep.installed && dep.brew) out.push(dep.brew)
  }
  return [...new Set(out)]
}

function PluginRow({ p, byId, busy, error, onToggle, onRunInTerminal }) {
  const brew = missingFormulas(p, byId)
  const conflicts = (p.conflicts || []).filter((c) => byId[c])
  return (
    <div className={`ext-row ${p.enabled ? 'on' : ''}`}>
      <div className="ext-row-body">
        <div className="ext-row-title">
          <span className="ext-name">{p.id}</span>
          {p.popular && <span className="ext-tag hot">popular</span>}
          {p.kind === 'omz' && <span className="ext-tag">oh-my-zsh</span>}
          {p.kind === 'tool' && <span className="ext-tag">tool</span>}
        </div>
        <div className="ext-desc">{p.desc}</div>
        {conflicts.length > 0 && (
          <div className="ext-note">Conflicts with {conflicts.join(', ')} — turning this on turns that off.</div>
        )}
        {brew.length > 0 && (
          <div className="ext-install">
            <button className="ext-btn small" onClick={() => onRunInTerminal(`brew install ${brew.join(' ')}`)}>
              Install with Homebrew
            </button>
            <span className="ext-note">
              Runs <code>brew install {brew.join(' ')}</code>, then turn it on here.
            </span>
          </div>
        )}
        {error && <div className="ext-err">{error}</div>}
      </div>
      <div className="ext-row-side">
        {busy && <span className="meta-spinner" />}
        <label className="ext-switch" title={p.enabled ? 'Turn off' : 'Turn on'}>
          <input type="checkbox" checked={p.enabled} disabled={busy} onChange={(e) => onToggle(p, e.target.checked)} />
          <span />
        </label>
      </div>
    </div>
  )
}

export default function ZshTab({ onRunInTerminal }) {
  const [st, setSt] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [busy, setBusy] = useState({}) // id -> true while cloning / toggling
  const [errors, setErrors] = useState({}) // id -> message
  const [filter, setFilter] = useState('')
  const [updating, setUpdating] = useState(false)
  const [results, setResults] = useState(null) // zsh.update() output
  const [otherBusy, setOtherBusy] = useState(false)

  const load = async () => {
    try {
      setSt(await window.eterm.zsh.status())
      setLoadErr('')
    } catch (e) {
      setLoadErr(String(e?.message || e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Hide update results after a while; they're only a confirmation.
  useEffect(() => {
    if (!results) return
    const t = setTimeout(() => setResults(null), 8000)
    return () => clearTimeout(t)
  }, [results])

  const byId = useMemo(() => Object.fromEntries((st?.plugins || []).map((p) => [p.id, p])), [st])

  const toggle = async (p, on) => {
    setBusy((b) => ({ ...b, [p.id]: true }))
    setErrors((e) => ({ ...e, [p.id]: '' }))
    const res = await window.eterm.zsh.plugin(p.id, on).catch((e) => ({ ok: false, error: String(e?.message || e) }))
    if (!res?.ok) setErrors((e) => ({ ...e, [p.id]: res?.error || 'Something went wrong' }))
    // Refresh even on failure: the backend may have flipped a conflicting plugin.
    await load()
    setBusy((b) => ({ ...b, [p.id]: false }))
  }

  const updateAll = async () => {
    setUpdating(true)
    setResults(null)
    const res = await window.eterm.zsh.update().catch((e) => [{ name: 'update', ok: false, out: String(e?.message || e) }])
    setUpdating(false)
    setResults(res || [])
    load()
  }

  const setOther = async (on) => {
    setOtherBusy(true)
    await window.eterm.zsh.otherTerminals(on)
    await load()
    setOtherBusy(false)
  }

  if (loadErr) return <div className="pf-status bad">Couldn’t read zsh setup: {loadErr}</div>
  if (!st) return <Loading text="Reading your zsh setup…" />

  const q = filter.trim().toLowerCase()
  const shown = st.plugins.filter((p) => !q || p.id.toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q))
  const groups = [...GROUPS, ...new Set(st.plugins.map((p) => p.group).filter((g) => !GROUPS.includes(g)))]
  const enabledCount = st.plugins.filter((p) => p.enabled).length
  const failed = (results || []).filter((r) => !r.ok)

  return (
    <div className="ext-tab">
      <div className="pf-head">
        <h2>Zsh plugins</h2>
        <span className="pill pill-on">{enabledCount} on</span>
      </div>
      <p className="pf-hint">Flip a switch to install and load a plugin. Nothing to edit by hand.</p>

      <div className="ext-toolbar">
        <input
          className="ext-search"
          placeholder="Filter plugins…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <button className="ext-btn" onClick={updateAll} disabled={updating}>
          {updating ? <span className="meta-spinner" /> : '↻'} Update all
        </button>
      </div>

      {results && (
        <div className={`pf-status ${failed.length ? 'bad' : 'ok'}`}>
          {results.length === 0
            ? 'Nothing to update.'
            : failed.length
              ? `Updated ${results.length - failed.length} of ${results.length}. Failed: ${failed.map((r) => r.name).join(', ')}`
              : `All ${results.length} plugins are up to date.`}
          {failed.map((r) => (
            <pre key={r.name} className="ext-pre">
              {r.name}: {r.out}
            </pre>
          ))}
        </div>
      )}

      <label className="ext-option">
        <span className="ext-switch">
          <input type="checkbox" checked={!!st.otherTerminals} disabled={otherBusy} onChange={(e) => setOther(e.target.checked)} />
          <span />
        </span>
        <span>
          <b>Also load in other terminals</b>
          <small>Adds one line to ~/.zshrc (a backup is kept). Removing it is just as easy.</small>
        </span>
        {otherBusy && <span className="meta-spinner" />}
      </label>

      {groups.map((g) => {
        const items = shown.filter((p) => p.group === g)
        if (!items.length) return null
        return (
          <section key={g} className="ext-section">
            <h3>{g}</h3>
            <div className="ext-list">
              {items.map((p) => (
                <PluginRow
                  key={p.id}
                  p={p}
                  byId={byId}
                  busy={!!busy[p.id]}
                  error={errors[p.id]}
                  onToggle={toggle}
                  onRunInTerminal={onRunInTerminal}
                />
              ))}
            </div>
          </section>
        )
      })}
      {shown.length === 0 && <div className="ext-empty">No plugins match “{filter}”.</div>}

      <div className="ext-footnote">
        Changes apply to new tabs (<kbd>⌘T</kbd>). 117Terminal draws its own command editor, so line-editor plugins
        (autosuggestions, syntax highlighting, vi-mode) show up in other terminals; aliases, functions, completions and
        tools work everywhere.
        {st.pluginsFile && (
          <div className="ext-path">
            Config: <code>{st.pluginsFile}</code>
          </div>
        )}
      </div>
    </div>
  )
}

export function Loading({ text }) {
  return (
    <div className="ext-loading">
      <span className="meta-spinner" /> {text}
    </div>
  )
}
