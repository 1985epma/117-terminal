import { useEffect, useRef, useState } from 'react'
import { Loading } from './ZshTab.jsx'

const MAX_RESULTS = 150
const INSTALL_BREWCAT = 'brew tap 1985epma/brewcat && brew trust 1985epma/brewcat && brew install brewcat'

function NotInstalled({ brew, onRunInTerminal }) {
  return (
    <div className="ext-tab">
      <div className="pf-head">
        <h2>brewcat</h2>
      </div>
      <p className="pf-hint">
        brewcat is a curated catalog of Homebrew formulae and casks, grouped into profiles (web dev, data, DevOps…) and
        ready-made kits you can install in one go. Browse and search it right here once it’s installed.
      </p>
      {brew ? (
        <div className="ext-hero">
          <div className="ext-cmd">{INSTALL_BREWCAT}</div>
          <div className="pf-actions">
            <button className="primary" onClick={() => onRunInTerminal(INSTALL_BREWCAT)}>
              Install brewcat
            </button>
          </div>
        </div>
      ) : (
        <div className="pf-status bad">
          brewcat needs Homebrew, which isn’t installed.{' '}
          <a href="https://brew.sh" target="_blank" rel="noreferrer">
            Get Homebrew at brew.sh ↗
          </a>
        </div>
      )}
    </div>
  )
}

export default function BrewcatTab({ onRunInTerminal }) {
  const [st, setSt] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [profile, setProfile] = useState('') // '' = All
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState({ loading: true, data: [], error: '' })
  const [kits, setKits] = useState({ loading: true, data: [], error: '' })
  const seq = useRef(0)

  useEffect(() => {
    window.eterm.brewcat
      .status()
      .then((s) => {
        setSt(s)
        if (s.installed) window.eterm.brewcat.profiles().then((p) => setProfiles(Array.isArray(p) ? p : []))
      })
      .catch((e) => setSt({ installed: false, brew: true, error: String(e?.message || e) }))
  }, [])

  // Search is a CLI call: debounce and drop stale answers.
  useEffect(() => {
    if (!st?.installed) return
    const id = ++seq.current
    setSearch((s) => ({ ...s, loading: true }))
    const t = setTimeout(async () => {
      const res = await window.eterm.brewcat
        .search(query.trim(), profile || undefined)
        .catch((e) => ({ ok: false, error: String(e?.message || e) }))
      if (id !== seq.current) return
      setSearch(res?.ok ? { loading: false, data: res.data || [], error: '' } : { loading: false, data: [], error: res?.error || 'Search failed' })
    }, 300)
    return () => clearTimeout(t)
  }, [st, query, profile])

  useEffect(() => {
    if (!st?.installed) return
    let live = true
    setKits((k) => ({ ...k, loading: true }))
    window.eterm.brewcat
      .kits(profile || undefined)
      .then((res) => live && setKits(res?.ok ? { loading: false, data: res.data || [], error: '' } : { loading: false, data: [], error: res?.error || '' }))
      .catch((e) => live && setKits({ loading: false, data: [], error: String(e?.message || e) }))
    return () => {
      live = false
    }
  }, [st, profile])

  if (!st) return <Loading text="Looking for brewcat…" />
  if (!st.installed) return <NotInstalled brew={st.brew} onRunInTerminal={onRunInTerminal} />

  const checks = st.doctor?.checks || []
  const total = profiles.reduce((n, p) => n + (p.count || 0), 0)
  const shown = search.data.slice(0, MAX_RESULTS)

  return (
    <div className="ext-tab">
      <div className="pf-head">
        <h2>brewcat</h2>
        {st.version && <span className="pill pill-on">v{st.version}</span>}
        <button className="ext-btn small ext-head-btn" onClick={() => window.eterm.brewcat.open()}>
          Open brewcat app ↗
        </button>
      </div>
      <p className="pf-hint">Browse the curated Homebrew catalog. Installs run as a block in your terminal.</p>

      {checks.length > 0 && (
        <div className="ext-chips doctor">
          {checks.map((c) => (
            <span
              key={c.name}
              className={`ext-check ${c.status === 'OK' ? 'ok' : 'warn'}`}
              title={[c.detail, c.hint].filter(Boolean).join('\n')}
            >
              {c.status === 'OK' ? '✓' : '!'} {c.name}
            </span>
          ))}
        </div>
      )}

      <div className="ext-chips profiles">
        <button className={`ext-chip ${profile === '' ? 'sel' : ''}`} onClick={() => setProfile('')}>
          All{total ? <small>{total}</small> : null}
        </button>
        {profiles.map((p) => (
          <button key={p.name} className={`ext-chip ${profile === p.name ? 'sel' : ''}`} onClick={() => setProfile(p.name)}>
            {p.name}
            <small>{p.count}</small>
          </button>
        ))}
      </div>

      {kits.data.length > 0 && (
        <section className="ext-section">
          <h3>Kits{profile ? ` · ${profile}` : ''}</h3>
          <div className="ext-presets">
            {kits.data.map((k) => (
              <div key={k.name} className="ext-preset">
                <div className="ext-preset-head">
                  <span className="ext-name">{k.name}</span>
                  <button className="ext-btn small" onClick={() => onRunInTerminal(`brewcat install "${k.name}" --yes`)}>
                    Install kit
                  </button>
                </div>
                {k.description && <div className="ext-desc">{k.description}</div>}
                {k.packages?.length > 0 && (
                  <div className="ext-kit-pkgs" title={k.packages.join(', ')}>
                    {k.packages.length} packages: {k.packages.slice(0, 8).join(', ')}
                    {k.packages.length > 8 ? '…' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="ext-section">
        <h3>Packages</h3>
        <div className="ext-toolbar">
          <input
            className="ext-search"
            placeholder={`Search ${profile || 'the catalog'}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          {search.loading && <span className="meta-spinner" />}
        </div>
        {search.error && <div className="pf-status bad">{search.error}</div>}
        {!search.loading && !search.error && search.data.length === 0 && (
          <div className="ext-empty">No packages match{query ? ` “${query}”` : ''}.</div>
        )}
        <div className="ext-list">
          {shown.map((p) => (
            <div key={`${p.kind}:${p.name}`} className="ext-row pkg">
              <div className="ext-row-body">
                <div className="ext-row-title">
                  <span className="ext-name">{p.name}</span>
                  <span className={`ext-tag ${p.kind === 'cask' ? 'cask' : ''}`}>{p.kind}</span>
                  {p.category && <span className="ext-cat">{p.category}</span>}
                </div>
                {p.description && <div className="ext-desc">{p.description}</div>}
              </div>
              <div className="ext-row-side">
                {p.installed ? (
                  <span className="ext-installed">✓ Installed</span>
                ) : (
                  <button className="ext-btn small" onClick={() => onRunInTerminal(`brewcat install "${p.name}" --yes`)}>
                    Install
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {search.data.length > MAX_RESULTS && (
          <div className="ext-note center">
            Showing {MAX_RESULTS} of {search.data.length}. Refine your search to see more.
          </div>
        )}
      </section>

      {st.path && (
        <div className="ext-footnote">
          <div className="ext-path">
            brewcat: <code>{st.path}</code>
          </div>
        </div>
      )}
    </div>
  )
}
