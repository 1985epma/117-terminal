import { useEffect, useState } from 'react'
import { Loading } from './ZshTab.jsx'

// "npx -y pkg --dir 'My Files'" -> ['npx', '-y', 'pkg', '--dir', 'My Files']
function splitArgs(str) {
  const out = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(str))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3]))
  return out
}
const quoteArg = (a) => (/[\s"']/.test(a) ? `"${a.replace(/(["\\])/g, '\\$1')}"` : a)

// KEY=VALUE lines (env) or Key: Value lines (headers) <-> objects.
function parseLines(text, sep) {
  const obj = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf(sep)
    if (i <= 0) continue
    const k = line.slice(0, i).trim()
    if (k) obj[k] = line.slice(i + 1).trim()
  }
  return obj
}
const formatLines = (obj, sep) =>
  Object.entries(obj || {})
    .map(([k, v]) => `${k}${sep}${v}`)
    .join('\n')

const defOf = (s) => ({
  command: s.command,
  args: s.args,
  env: s.env,
  url: s.url,
  headers: s.headers,
  type: s.type,
  disabled: s.disabled,
  trusted: s.trusted
})

const STATUS_TEXT = { connected: 'Connected', connecting: 'Connecting…', error: 'Error', idle: 'Not connected' }

// Add / edit form for a custom server.
function ServerForm({ initial, onSubmit, onCancel, takenNames }) {
  const [name, setName] = useState(initial?.name || '')
  const [transport, setTransport] = useState(initial?.url ? 'url' : 'command')
  const [command, setCommand] = useState(
    initial?.command ? [initial.command, ...(initial.args || [])].map(quoteArg).join(' ') : ''
  )
  const [env, setEnv] = useState(formatLines(initial?.env, '='))
  const [url, setUrl] = useState(initial?.url || '')
  const [type, setType] = useState(initial?.type || '')
  const [headers, setHeaders] = useState(formatLines(initial?.headers, ': '))
  const [err, setErr] = useState('')

  const submit = (e) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setErr('Give the server a name.')
    if (!/^[\w.-]+$/.test(n)) return setErr('Use letters, numbers, dots, dashes or underscores in the name.')
    if (n !== initial?.name && takenNames.includes(n)) return setErr(`A server named “${n}” already exists.`)
    const def = { disabled: initial?.disabled, trusted: initial?.trusted }
    if (transport === 'command') {
      const parts = splitArgs(command.trim())
      if (!parts.length) return setErr('Enter the command that starts the server.')
      def.command = parts[0]
      def.args = parts.slice(1)
      def.env = parseLines(env, '=')
    } else {
      if (!/^https?:\/\//.test(url.trim())) return setErr('Enter an http(s) URL.')
      def.url = url.trim()
      def.type = type || undefined
      def.headers = parseLines(headers, ':')
      def.env = initial?.env
    }
    onSubmit(n, def)
  }

  return (
    <form className="ext-form" onSubmit={submit}>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-server" spellCheck={false} autoFocus />
      </label>
      <div className="ext-seg">
        <button type="button" className={transport === 'command' ? 'sel' : ''} onClick={() => setTransport('command')}>
          Command (stdio)
        </button>
        <button type="button" className={transport === 'url' ? 'sel' : ''} onClick={() => setTransport('url')}>
          URL (HTTP)
        </button>
      </div>
      {transport === 'command' ? (
        <>
          <label className="field">
            <span>Command and arguments</span>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-filesystem ~/projects"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Environment (one KEY=VALUE per line)</span>
            <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} placeholder="API_KEY=…" spellCheck={false} />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span>URL</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" spellCheck={false} />
          </label>
          <label className="field">
            <span>Transport</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Auto-detect</option>
              <option value="http">Streamable HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </label>
          <label className="field">
            <span>Headers (one Key: Value per line)</span>
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              rows={3}
              placeholder="Authorization: Bearer ${MY_TOKEN}"
              spellCheck={false}
            />
          </label>
        </>
      )}
      {err && <div className="pf-status bad">{err}</div>}
      <div className="pf-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary">
          {initial ? 'Save & test' : 'Add & test'}
        </button>
      </div>
    </form>
  )
}

function ServerCard({ s, busy, result, onTest, onSave, onRemove, onEdit }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const status = s.disabled ? 'disabled' : s.status
  const tools = s.tools || []
  return (
    <div className={`ext-server ${s.disabled ? 'off' : ''}`}>
      <div className="ext-server-head">
        <span className={`ext-dot ${status}`} title={STATUS_TEXT[status] || 'Disabled'} />
        <span className="ext-name">{s.name}</span>
        <span className="ext-tag">{s.url ? s.type || 'http' : 'stdio'}</span>
        {s.trusted && <span className="ext-tag ok">trusted</span>}
        <span className="ext-server-status">
          {busy === 'test' ? (
            <>
              <span className="meta-spinner" /> Connecting…
            </>
          ) : s.disabled ? (
            'Disabled'
          ) : s.status === 'connected' ? (
            <button className="ext-linkbtn" onClick={() => setOpen((o) => !o)}>
              {tools.length} tool{tools.length === 1 ? '' : 's'} {open ? '▴' : '▾'}
            </button>
          ) : (
            STATUS_TEXT[s.status] || s.status
          )}
        </span>
      </div>
      <div className="ext-cmd" title={s.url || [s.command, ...(s.args || [])].join(' ')}>
        {s.url || [s.command, ...(s.args || [])].map(quoteArg).join(' ')}
      </div>
      {s.status === 'error' && s.error && !s.disabled && <div className="ext-err">{s.error}</div>}
      {result && <div className={`pf-status ${result.ok ? 'ok' : 'bad'}`}>{result.text}</div>}
      {open && tools.length > 0 && (
        <ul className="ext-tools">
          {tools.map((t) => (
            <li key={t.name}>
              <code>{t.name}</code>
              {t.description && <span>{t.description}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="ext-server-actions">
        <button className="ext-btn small" onClick={onTest} disabled={!!busy || s.disabled}>
          Test
        </button>
        <button className="ext-btn small" onClick={() => onSave({ ...defOf(s), disabled: !s.disabled })} disabled={!!busy}>
          {s.disabled ? 'Enable' : 'Disable'}
        </button>
        <button className="ext-btn small" onClick={onEdit} disabled={!!busy}>
          Edit
        </button>
        {confirm ? (
          <>
            <button className="ext-btn small danger" onClick={onRemove} disabled={!!busy}>
              Remove {s.name}?
            </button>
            <button className="ext-btn small" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="ext-btn small" onClick={() => setConfirm(true)} disabled={!!busy}>
            Remove
          </button>
        )}
        <label className="ext-inline-switch" title="Let the agent call this server’s tools without asking each time">
          <span className="ext-switch">
            <input
              type="checkbox"
              checked={!!s.trusted}
              disabled={!!busy}
              onChange={(e) => onSave({ ...defOf(s), trusted: e.target.checked })}
            />
            <span />
          </span>
          Trust (run tools without asking)
        </label>
      </div>
    </div>
  )
}

// Preset card; presets that need secrets ask for them inline first.
function PresetCard({ p, onAdd }) {
  const [asking, setAsking] = useState(false)
  const [values, setValues] = useState({})
  const needs = p.needs || []
  const add = (e) => {
    e?.preventDefault()
    if (needs.length && !asking) return setAsking(true)
    onAdd(p, values)
    setAsking(false)
  }
  return (
    <div className={`ext-preset ${p.added ? 'added' : ''}`}>
      <div className="ext-preset-head">
        <span className="ext-name">{p.label || p.name}</span>
        {p.added ? (
          <span className="theme-check">✓ added</span>
        ) : (
          !asking && (
            <button className="ext-btn small" onClick={add}>
              Add
            </button>
          )
        )}
      </div>
      <div className="ext-desc">{p.desc}</div>
      {asking && (
        <form className="ext-needs" onSubmit={add}>
          {needs.map((k, i) => (
            <label key={k} className="field">
              <span>{k}</span>
              <input
                type="password"
                autoFocus={i === 0}
                value={values[k] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ))}
          <div className="pf-actions">
            <button type="button" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={needs.some((k) => !values[k])}>
              Add
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function McpTab() {
  const [listing, setListing] = useState(null)
  const [busy, setBusy] = useState({}) // server name -> 'test' | 'save' | 'remove'
  const [results, setResults] = useState({}) // server name -> { ok, text }
  const [editing, setEditing] = useState(null) // server being edited, or 'new'
  const [imported, setImported] = useState(null) // { ok, text }
  const [importing, setImporting] = useState('')

  useEffect(() => {
    window.eterm.mcp.list().then(setListing)
  }, [])

  const mark = (name, v) => setBusy((b) => ({ ...b, [name]: v }))

  const test = async (name) => {
    mark(name, 'test')
    setResults((r) => ({ ...r, [name]: null }))
    const res = await window.eterm.mcp.test(name).catch((e) => ({ ok: false, error: String(e?.message || e) }))
    if (res?.listing) setListing(res.listing)
    setResults((r) => ({
      ...r,
      [name]: res?.ok
        ? { ok: true, text: `Connected · ${res.tools ?? 0} tool${res.tools === 1 ? '' : 's'} available` }
        : { ok: false, text: res?.error || 'Could not connect' }
    }))
    mark(name, '')
  }

  const save = async (name, def, { andTest = false } = {}) => {
    mark(name, 'save')
    setListing(await window.eterm.mcp.save(name, def))
    mark(name, '')
    if (andTest) await test(name)
  }

  const remove = async (name) => {
    mark(name, 'remove')
    setListing(await window.eterm.mcp.remove(name))
    mark(name, '')
  }

  const submitForm = async (name, def) => {
    const old = editing !== 'new' ? editing?.name : null
    setEditing(null)
    if (old && old !== name) await remove(old)
    await save(name, def, { andTest: !def.disabled })
  }

  const addPreset = async (p, values) => {
    // Secrets go into env; the backend expands ${VAR} in args/headers from it.
    const def = {
      command: p.command,
      args: p.args,
      url: p.url,
      headers: p.headers,
      env: { ...(p.env || {}), ...values }
    }
    await save(p.name, def, { andTest: true })
  }

  const runImport = async (src) => {
    setImporting(src.id)
    setImported(null)
    const res = await window.eterm.mcp.import(src.id).catch((e) => ({ error: String(e?.message || e) }))
    setImporting('')
    if (res?.listing) setListing(res.listing)
    const n = Array.isArray(res?.added) ? res.added.length : res?.added || 0
    setImported(
      res?.error
        ? { ok: false, text: res.error }
        : { ok: true, text: n ? `Imported ${n} server${n === 1 ? '' : 's'} from ${src.label}.` : `Nothing new to import from ${src.label}.` }
    )
  }

  if (!listing) return <Loading text="Loading MCP servers…" />

  const names = listing.servers.map((s) => s.name)
  const sources = (listing.sources || []).filter((s) => s.count > 0)
  const connected = listing.servers.filter((s) => s.status === 'connected' && !s.disabled).length

  return (
    <div className="ext-tab">
      <div className="pf-head">
        <h2>MCP servers</h2>
        {listing.servers.length > 0 && (
          <span className="pill pill-on">
            {connected}/{listing.servers.length} connected
          </span>
        )}
      </div>
      <p className="pf-hint">MCP servers give the agent extra tools: files, GitHub, browsers, databases and more.</p>

      <section className="ext-section">
        <h3>
          Your servers
          {editing !== 'new' && (
            <button className="ext-btn small" onClick={() => setEditing('new')}>
              + Custom server
            </button>
          )}
        </h3>
        {editing === 'new' && (
          <div className="ext-server">
            <ServerForm onSubmit={submitForm} onCancel={() => setEditing(null)} takenNames={names} />
          </div>
        )}
        {listing.servers.length === 0 && editing !== 'new' && (
          <div className="ext-empty">No servers yet. Import them from another tool or add one below.</div>
        )}
        <div className="ext-list gap">
          {listing.servers.map((s) =>
            editing && editing !== 'new' && editing.name === s.name ? (
              <div key={s.name} className="ext-server">
                <ServerForm initial={s} onSubmit={submitForm} onCancel={() => setEditing(null)} takenNames={names} />
              </div>
            ) : (
              <ServerCard
                key={s.name}
                s={s}
                busy={busy[s.name]}
                result={results[s.name]}
                onTest={() => test(s.name)}
                onSave={(def) => save(s.name, def)}
                onRemove={() => remove(s.name)}
                onEdit={() => setEditing(s)}
              />
            )
          )}
        </div>
      </section>

      {sources.length > 0 && (
        <section className="ext-section">
          <h3>Import</h3>
          <div className="ext-actions-row">
            {sources.map((src) => (
              <button
                key={src.id}
                className="ext-btn"
                disabled={!!importing}
                onClick={() => runImport(src)}
                title={`${src.file}\n${(src.names || []).join(', ')}`}
              >
                {importing === src.id && <span className="meta-spinner" />}
                Import {src.count} server{src.count === 1 ? '' : 's'} from {src.label}
              </button>
            ))}
          </div>
          {imported && <div className={`pf-status ${imported.ok ? 'ok' : 'bad'}`}>{imported.text}</div>}
        </section>
      )}

      {listing.presets?.length > 0 && (
        <section className="ext-section">
          <h3>Add a popular server</h3>
          <div className="ext-presets">
            {listing.presets.map((p) => (
              <PresetCard key={p.name} p={p} onAdd={addPreset} />
            ))}
          </div>
        </section>
      )}

      {listing.configFile && (
        <div className="ext-footnote">
          <div className="ext-path">
            Config: <code>{listing.configFile}</code>
          </div>
        </div>
      )}
    </div>
  )
}
