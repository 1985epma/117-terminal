import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react'
import { Highlighted, setExecutables } from '../lib/highlight.jsx'
import { history } from '../lib/history.js'
import { prettyPath } from '../lib/paths.js'
import { aiConfig } from '../lib/aiConfig.js'
import { music } from '../lib/music.js'

let commandNames = []
const executablesReady = window.eterm.complete.executables().then((list) => {
  commandNames = list
  setExecutables(list)
})

// Warp-style slash commands. Only these names are intercepted, so absolute
// paths like /usr/bin/env still run in the shell.
const SLASH = [
  { name: 'agent', arg: '[prompt]', desc: 'Switch to Agent Mode, or ask the agent right away' },
  { name: 'shell', desc: 'Back to the regular shell' },
  { name: 'new', arg: '[prompt]', desc: 'Start a new agent conversation' },
  { name: 'model', desc: 'Connect or switch the AI provider and model' },
  { name: 'stop', desc: 'Stop the agent' },
  { name: 'voice', desc: 'Voice commands: engine, language (EN · PT · ES), mode' },
  { name: 'theme', desc: 'Pick a color theme and transparency' },
  { name: 'music', arg: '[play|pause|next|prev|search]', desc: 'Spotify & Apple Music player' },
  { name: 'spotify', arg: '[link]', desc: 'Open Spotify controls, or play a Spotify link' },
  { name: 'applemusic', arg: '[search]', desc: 'Open Apple Music, or play from your library' },
  { name: 'plugins', desc: 'Zsh plugins: autosuggestions, z, fzf, Oh My Zsh…' },
  { name: 'prompt', desc: 'Prompt themes: Powerlevel10k, Starship, Pure…' },
  { name: 'mcp', desc: 'MCP servers for the agent' },
  { name: 'brewcat', desc: 'Browse and install Homebrew packages with brewcat' },
  { name: 'settings', desc: 'All settings: appearance, agent, voice, shell, web…' },
  { name: 'clear', desc: 'Clear all blocks' },
  { name: 'help', desc: 'Show what 117Terminal can do' }
]
// Short forms: /s → /settings, /a → /agent …
const ALIASES = { a: 'agent', s: 'settings', m: 'music', v: 'voice', t: 'theme', h: 'help', '?': 'help' }
const EXAMPLES = {
  agent: ['/agent', '/agent why is npm test failing?'],
  new: ['/new summarize the git log of this week'],
  music: ['/music', '/music next', '/music pause', '/music daft punk'],
  spotify: ['/spotify', '/spotify https://open.spotify.com/track/…'],
  applemusic: ['/applemusic', '/applemusic bohemian rhapsody'],
  help: ['/help', '/help music']
}
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SLASH_RE = new RegExp(
  `^/(${[...SLASH.map((c) => c.name), ...Object.keys(ALIASES)].map(escapeRe).join('|')})(?:\\s+([\\s\\S]*))?$`
)

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length]
}
const closestSlash = (word) => {
  const best = SLASH.map((c) => [c.name, distance(word, c.name)]).sort((x, y) => x[1] - y[1])[0]
  return best[1] <= 2 ? best[0] : null
}

// Text for `/help <command>`.
function commandHelp(word) {
  const c = SLASH.find((x) => x.name === (ALIASES[word] || word))
  if (!c) {
    const hint = closestSlash(word)
    return `No command **/${word}**.${hint ? ` Did you mean **/${hint}**?` : ''} Type \`/help\` for the list.`
  }
  const alias = Object.entries(ALIASES).filter(([, n]) => n === c.name).map(([k]) => `\`/${k}\``)
  const lines = [`**/${c.name}${c.arg ? ` ${c.arg}` : ''}** — ${c.desc}`]
  if (alias.length) lines.push('', `Short form: ${alias.join(', ')}`)
  if (EXAMPLES[c.name]) lines.push('', 'Examples:', '', ...EXAMPLES[c.name].map((e) => `- \`${e}\``))
  return lines.join('\n')
}

function commonPrefix(items) {
  if (!items.length) return ''
  let p = items[0]
  for (const s of items) while (!s.startsWith(p)) p = p.slice(0, -1)
  return p
}

export default function InputEditor({ session, running, onSubmit, onOpenHistory, onOpenSettings, showPrompt, ref }) {
  const [value, setValue] = useState('')
  const [caret, setCaret] = useState(0)
  const [menu, setMenu] = useState(null) // { items, index, start, end }
  const [, setReady] = useState(false)
  const taRef = useRef(null)
  const hist = useRef({ index: -1, draft: '' })
  const cfg = useSyncExternalStore(aiConfig.subscribe, aiConfig.get)
  const agent = session.agent
  const agentMode = !running && (session.mode === 'agent' || value.startsWith('#'))
  const provider = cfg.providers.find((p) => p.id === cfg.active)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const typedSlash = value.slice(1).toLowerCase()
  const slashItems =
    !running && !slashDismissed && /^\/[\w?]*$/.test(value)
      ? [
          // A short form (/s, /a…) puts its command first, so Enter runs it.
          ...SLASH.filter((c) => c.name === ALIASES[typedSlash]),
          ...SLASH.filter((c) => c.name.startsWith(typedSlash) && c.name !== ALIASES[typedSlash])
        ]
      : []
  const isSlash = SLASH_RE.test(value.trim())

  useEffect(() => {
    executablesReady.then(() => setReady(true))
    history.ready.then(() => setReady(true))
  }, [])

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setValue: (v) => {
      setValue(v)
      setCaret(v.length)
      requestAnimationFrame(() => taRef.current?.setSelectionRange(v.length, v.length))
    }
  }))

  const atEnd = caret === value.length
  const ghost = !running && !agentMode && !value.startsWith('/') && atEnd && !menu ? history.suggest(value).slice(value.length) : ''
  const secret = running && /(password|passphrase|senha)[^\n]*:\s*$/i.test(running.lastLine())

  const update = (v, c = v.length) => {
    setValue(v)
    setCaret(c)
    requestAnimationFrame(() => taRef.current?.setSelectionRange(c, c))
  }

  const tokenAtCaret = () => {
    const before = value.slice(0, caret)
    const start = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'), before.lastIndexOf('\t')) + 1
    const token = before.slice(start)
    const isCommand = !/\S/.test(before.slice(0, start).split(/\|\||&&|[|;]/).pop() || '')
    return { start, token, isCommand }
  }

  const applyCompletion = (item, start, end = caret) => {
    const suffix = item.kind === 'dir' ? '' : ' '
    const v = value.slice(0, start) + item.value + suffix + value.slice(end)
    update(v, start + item.value.length + suffix.length)
    setMenu(null)
  }

  const complete = async () => {
    const { start, token, isCommand } = tokenAtCaret()
    let items
    if (isCommand && !token.includes('/') && token) {
      items = commandNames
        .filter((n) => n.startsWith(token))
        .slice(0, 100)
        .map((n) => ({ value: n, label: n, kind: 'cmd' }))
    } else {
      items = await window.eterm.complete.path(session.cwd, token)
    }
    if (!items.length) return
    if (items.length === 1) return applyCompletion(items[0], start)
    const prefix = commonPrefix(items.map((i) => i.value))
    if (prefix.length > token.length) {
      update(value.slice(0, start) + prefix + value.slice(caret), start + prefix.length)
      setMenu({ items, index: 0, start, end: start + prefix.length })
    } else {
      setMenu({ items, index: 0, start, end: caret })
    }
  }

  const setMode = (mode) => {
    session.mode = mode
    session._emit()
  }

  const askAgent = (prompt) => {
    if (!prompt || agent.busy) return
    if (!aiConfig.isReady()) return onOpenSettings()
    agent.ask(prompt)
  }

  // Returns true when `text` was a slash command.
  const runSlash = (text) => {
    const m = text.trim().match(SLASH_RE)
    if (!m) return false
    const [, typed, rest = ''] = m
    const name = ALIASES[typed] || typed
    const arg = rest.trim()
    update('')
    if (name === 'agent') {
      setMode('agent')
      if (arg) askAgent(arg)
      else if (!aiConfig.isReady()) onOpenSettings()
    } else if (name === 'new') {
      agent.reset()
      setMode('agent')
      if (arg) askAgent(arg)
    } else if (name === 'shell') setMode('shell')
    else if (name === 'model') onOpenSettings()
    else if (name === 'settings') window.dispatchEvent(new CustomEvent('eterm-action', { detail: 'settings' }))
    else if (name === 'stop') agent.stop()
    else if (name === 'clear') session.clear()
    else if (name === 'music' || name === 'spotify' || name === 'applemusic') runMusic(name, arg)
    else if (name === 'theme') window.dispatchEvent(new CustomEvent('eterm-action', { detail: 'settings:appearance' }))
    else if (name === 'voice') window.dispatchEvent(new CustomEvent('eterm-action', { detail: 'settings:voice' }))
    else if (['plugins', 'prompt', 'mcp', 'brewcat'].includes(name)) {
      const section = { plugins: 'shell', prompt: 'prompt', mcp: 'mcp', brewcat: 'integrations' }[name]
      window.dispatchEvent(new CustomEvent('eterm-action', { detail: `settings:${section}` }))
    }
    else if (name === 'help') session.showHelp(arg ? commandHelp(arg.replace(/^\//, '')) : undefined)
    return true
  }

  const runMusic = async (name, arg) => {
    const action = { play: 'play', pause: 'pause', next: 'next', skip: 'next', prev: 'previous', previous: 'previous', back: 'previous', toggle: 'playpause' }[arg.toLowerCase()]
    const source = name === 'spotify' ? 'spotify' : name === 'applemusic' ? 'music' : music.active()?.id || 'spotify'
    if (action) return music.control(source, action)
    if (!arg) return window.dispatchEvent(new CustomEvent('eterm-action', { detail: `music-panel:${source}` }))
    if (source === 'spotify') {
      if (/spotify(:|\.com\/)/.test(arg)) await window.eterm.music.playItem('spotify', arg)
      else await window.eterm.music.search('spotify', arg)
    } else {
      // Play the best match from the Apple Music library.
      const r = await window.eterm.music.search('music', arg)
      if (r.ok && r.results.length) await window.eterm.music.playItem('music', r.results[0].id)
    }
    music.refresh()
  }

  const pickSlash = (cmd) => {
    setSlashIndex(0)
    if (cmd.arg) update(`/${cmd.name} `)
    else runSlash(`/${cmd.name}`)
  }

  const submit = () => {
    setMenu(null)
    hist.current = { index: -1, draft: '' }
    if (!value.trim() && agent.pending) return agent.approve(agent.pending)
    if (!running && runSlash(value)) return
    if (agentMode) {
      const prompt = value.replace(/^#\s*/, '').trim()
      if (!prompt || agent.busy) return
      if (!aiConfig.isReady()) return onOpenSettings()
      update('')
      agent.ask(prompt)
      return
    }
    if (running) {
      session.write(value + '\r')
      update('')
      return
    }
    if (!value.trim()) return
    // `/word` that is not a command: run it only if it is a real path (like /usr/bin/env).
    const word = value.trim().match(/^\/([A-Za-z][\w-]*)(?:\s|$)/)?.[1]
    if (word) {
      const text = value
      update('')
      window.eterm.complete.path(session.cwd, `/${word}`).then((items) => {
        if (items.some((i) => i.label === word)) return onSubmit(text)
        session.showHelp(commandHelp(word))
      })
      return
    }
    onSubmit(value)
    update('')
  }

  const onKeyDown = (e) => {
    const ta = e.currentTarget
    const c = ta.selectionStart

    if (slashItems.length) {
      const n = slashItems.length
      const idx = Math.min(slashIndex, n - 1)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        return setSlashIndex((idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        return pickSlash(slashItems[idx])
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        return setSlashDismissed(true)
      }
    }

    if (menu) {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault()
        return setMenu({ ...menu, index: (menu.index + 1) % menu.items.length })
      }
      if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault()
        return setMenu({ ...menu, index: (menu.index - 1 + menu.items.length) % menu.items.length })
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        return applyCompletion(menu.items[menu.index], menu.start, menu.end)
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        return setMenu(null)
      }
      setMenu(null)
    }

    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'c') {
        e.preventDefault()
        if (agent.busy && !running) agent.stop()
        else if (running) session.interrupt()
        else update('')
        return
      }
      if (k === 'l') {
        e.preventDefault()
        return session.clear()
      }
      if (k === 'r') {
        e.preventDefault()
        return onOpenHistory()
      }
      if (running && /^[a-z]$/.test(k)) {
        e.preventDefault()
        return session.write(String.fromCharCode(k.charCodeAt(0) - 96))
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      return submit()
    }
    if (e.key === 'Escape') {
      if (agent.pending) return agent.reject(agent.pending)
      if (agent.busy && !running) return agent.stop()
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (!running && !agentMode) complete()
      else session.write('\t')
      return
    }
    if (e.key === 'ArrowRight' && ghost && c === value.length) {
      e.preventDefault()
      return update(value + ghost)
    }
    if (e.key === 'ArrowUp' && !value.slice(0, c).includes('\n')) {
      const items = history.items
      if (!items.length) return
      e.preventDefault()
      const h = hist.current
      if (h.index === -1) h.draft = value
      h.index = Math.min(items.length - 1, h.index + 1)
      return update(items[items.length - 1 - h.index])
    }
    if (e.key === 'ArrowDown' && !value.slice(c).includes('\n') && hist.current.index !== -1) {
      e.preventDefault()
      const h = hist.current
      h.index -= 1
      return update(h.index === -1 ? h.draft : history.items[history.items.length - 1 - h.index])
    }
  }

  // Focus the editor when typing anywhere in the view (Warp-style).
  useEffect(() => {
    const onKey = (e) => {
      const ta = taRef.current
      if (!ta || session.altBlock || session.rawBlock || document.activeElement === ta) return
      if (document.activeElement?.closest?.('.overlay')) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return
      if (!ta.closest('.terminal-view.active')) return
      ta.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])

  return (
    <div className={`input-area ${running ? 'is-running' : ''} ${agentMode ? 'is-agent' : ''}`}>
      {showPrompt && !running && !agentMode && session.promptHtml && (
        <pre className="ps1 mono" dangerouslySetInnerHTML={{ __html: session.promptHtml }} />
      )}
      <div className="prompt-bar">
        <button
          className={`chip chip-mode ${agentMode ? 'on' : ''}`}
          onClick={() => {
            session.mode = session.mode === 'agent' ? 'shell' : 'agent'
            session._emit()
            taRef.current?.focus()
          }}
          title="Toggle Agent Mode (⌘I)"
        >
          {agentMode ? '✦ Agent' : '$ Shell'}
        </button>
        <span className="chip chip-path">{prettyPath(session.cwd) || '…'}</span>
        {session.branch && <span className="chip chip-branch">⎇ {session.branch}</span>}
        {running ? (
          <span className="chip chip-running">
            <span className="meta-spinner" /> running <b>{running.command.split(/\s+/)[0]}</b> · input goes to the
            process · ⌃C to stop
          </span>
        ) : agent.busy ? (
          <span className="chip chip-running">
            <span className="meta-spinner" /> agent working · {agent.pending ? '↵ run · esc skip' : 'esc to stop'}
          </span>
        ) : session.state === 'exited' ? (
          <span className="chip chip-error">shell exited — open a new tab (⌘T)</span>
        ) : null}
        {agentMode && (
          <button className="chip chip-model" onClick={onOpenSettings} title="Agent settings (⌘,)">
            {provider && aiConfig.isReady() ? `${provider.label} · ${provider.model}` : 'Connect an AI provider →'}
          </button>
        )}
      </div>

      <div className="editor mono">
        <span className="editor-glyph">{running ? '›' : agentMode ? '✦' : '❯'}</span>
        <div className="editor-stack">
          <div className="editor-mirror" aria-hidden>
            {secret ? (
              '•'.repeat(value.length)
            ) : isSlash || slashItems.length ? (
              <SlashText text={value} />
            ) : agentMode ? (
              value
            ) : (
              <Highlighted text={value} />
            )}
            <span className="ghost">{ghost}</span>
            {'​'}
          </div>
          <textarea
            ref={taRef}
            className={`editor-input ${secret ? 'secret' : ''}`}
            value={value}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            rows={1}
            placeholder={
              running
                ? 'Send input to the running process…'
                : agentMode
                  ? 'Ask the agent anything — it can run commands for you (⌘I for shell)'
                  : 'Type a command, / for commands, or # to ask the agent…'
            }
            onChange={(e) => {
              setValue(e.target.value)
              setSlashDismissed(false)
              setSlashIndex(0)
              setCaret(e.target.selectionStart)
              hist.current.index = -1
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setMenu(null), 120)}
          />
        </div>

        {slashItems.length > 0 && (
          <div className="completion-menu slash-menu">
            {slashItems.map((c, i) => (
              <div
                key={c.name}
                className={`completion-item ${i === Math.min(slashIndex, slashItems.length - 1) ? 'sel' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickSlash(c)
                }}
              >
                <span className="slash-name">/{c.name}</span>
                {c.arg && <span className="slash-arg">{c.arg}</span>}
                <span className="slash-desc">{c.desc}</span>
              </div>
            ))}
          </div>
        )}

        {menu && (
          <div className="completion-menu">
            {menu.items.slice(0, 60).map((it, i) => (
              <div
                key={it.value}
                className={`completion-item ${i === menu.index ? 'sel' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyCompletion(it, menu.start, menu.end)
                }}
              >
                <span className={`kind kind-${it.kind}`}>{it.kind === 'dir' ? '▸' : it.kind === 'cmd' ? '$' : '·'}</span>
                {it.label}
              </div>
            ))}
            {menu.items.length > 60 && <div className="completion-more">+{menu.items.length - 60} more</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function SlashText({ text }) {
  const m = text.match(/^(\/\S*)([\s\S]*)$/)
  if (!m) return text
  return (
    <>
      <span className="tok-slash">{m[1]}</span>
      {m[2]}
    </>
  )
}
