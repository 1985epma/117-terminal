import { useEffect, useState } from 'react'
import { Loading } from './ZshTab.jsx'

// A tiny fake prompt line per theme, so the cards are recognisable at a glance.
const SAMPLES = {
  none: [['muted', '~/projects'], ['accent', ' ❯']],
  powerlevel10k: [['seg1', ' ~/projects '], ['seg2', '  main '], ['ok', ' ✔']],
  starship: [['accent', 'projects'], ['muted', ' on '], ['accent2', ' main'], ['ok', ' ❯']],
  pure: [['accent', '~/projects'], ['muted', ' main*'], ['accent2', '\n❯']],
  spaceship: [['accent', '~/projects'], ['muted', ' on '], ['accent2', ' main'], ['ok', '\n➜']]
}

function Sample({ id }) {
  const parts = SAMPLES[id] || [['muted', '~ '], ['accent', '❯']]
  return (
    <div className="ext-sample">
      {parts.map(([cls, text], i) => (
        <span key={i} className={`s-${cls}`}>
          {text}
        </span>
      ))}
    </div>
  )
}

export default function PromptTab({ onRunInTerminal, showPrompt, onShowPromptChange }) {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState('') // prompt id or `${id}:${preset}` being applied
  const [status, setStatus] = useState(null) // { ok, text }

  const load = async () => setSt(await window.eterm.zsh.status())

  useEffect(() => {
    load()
  }, [])

  const apply = async (id, preset) => {
    setBusy(preset ? `${id}:${preset}` : id || 'none')
    setStatus(null)
    const res = await window.eterm.zsh
      .prompt(id, preset)
      .catch((e) => ({ ok: false, error: String(e?.message || e) }))
    setBusy('')
    if (!res?.ok) setStatus({ ok: false, text: res?.error || 'Could not switch the prompt' })
    else {
      const name = id ? st.prompts.find((p) => p.id === id)?.name || id : 'No prompt theme'
      setStatus({ ok: true, text: `${name}${preset ? ` · ${preset}` : ''} applied. Open a new tab (⌘T) to see it.` })
      // A prompt theme is pointless if 117Terminal hides the zsh prompt.
      if (id && !showPrompt) onShowPromptChange?.(true)
    }
    load()
  }

  if (!st) return <Loading text="Reading your zsh setup…" />

  const active = st.prompts.find((p) => p.id === st.prompt) || null
  const cards = [{ id: null, name: 'None', desc: 'Plain zsh prompt (or whatever your ~/.zshrc sets).', installed: true }, ...st.prompts]

  return (
    <div className="ext-tab">
      <div className="pf-head">
        <h2>Prompt theme</h2>
        {active && <span className="pill pill-on">● {active.name}</span>}
      </div>
      <p className="pf-hint">Pick a look for your shell prompt. One click installs and configures it.</p>

      <label className={`ext-option big ${showPrompt ? 'on' : ''}`}>
        <span className="ext-switch">
          <input type="checkbox" checked={!!showPrompt} onChange={(e) => onShowPromptChange?.(e.target.checked)} />
          <span />
        </span>
        <span>
          <b>Show my zsh prompt in 117Terminal</b>
          <small>
            {showPrompt
              ? 'Your zsh prompt (and its theme) is shown in 117Terminal.'
              : 'Off: 117Terminal shows its own prompt, so a theme only shows up in other terminals.'}
          </small>
        </span>
      </label>

      <div className="ext-cards">
        {cards.map((p) => {
          const key = p.id || 'none'
          const isActive = (p.id || null) === (st.prompt || null)
          const needsBrew = p.kind === 'tool' && !p.installed
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              className={`ext-card ${isActive ? 'current' : ''} ${needsBrew ? 'disabled' : ''}`}
              onClick={() => !needsBrew && !busy && !isActive && apply(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && !needsBrew && !busy && !isActive && apply(p.id)}
            >
              <Sample id={key} />
              <div className="ext-card-title">
                {p.name}
                {isActive && <span className="theme-check">✓ active</span>}
                {busy === key && <span className="meta-spinner" />}
              </div>
              <div className="ext-desc">{p.desc}</div>
              {needsBrew && (
                <button
                  className="ext-btn small primary-ish"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRunInTerminal(`brew install ${p.brew || p.id}`)
                  }}
                >
                  Install with Homebrew
                </button>
              )}
              {!needsBrew && p.kind === 'git' && !p.installed && <div className="ext-note">Downloads on first use.</div>}
            </div>
          )
        })}
      </div>

      {status && <div className={`pf-status ${status.ok ? 'ok' : 'bad'}`}>{status.text}</div>}

      {active?.presets?.length > 0 && (
        <section className="ext-section">
          <h3>{active.name} presets</h3>
          <div className="ext-chips">
            {active.presets.map((preset) => (
              <button
                key={preset}
                className="ext-chip"
                disabled={!!busy}
                onClick={() => apply(active.id, preset)}
              >
                {busy === `${active.id}:${preset}` && <span className="meta-spinner" />}
                {preset}
              </button>
            ))}
          </div>
          <div className="ext-note">
            {active.id === 'powerlevel10k'
              ? 'Copies the preset to ~/.p10k.zsh (your current file is backed up).'
              : active.id === 'starship'
                ? 'Writes ~/.config/starship.toml with `starship preset`.'
                : 'Applies the preset to your prompt config.'}
          </div>
        </section>
      )}

      {active?.id === 'powerlevel10k' && (
        <section className="ext-section">
          <h3>Fine-tune Powerlevel10k</h3>
          <div className="ext-actions-row">
            <button className="ext-btn" onClick={() => onRunInTerminal('p10k configure')}>
              Run p10k configure
            </button>
            <button className="ext-btn" onClick={() => onRunInTerminal('brew install --cask font-symbols-only-nerd-font')}>
              Install Nerd Font icons
            </button>
          </div>
          <div className="ext-note">
            The wizard asks a few questions and writes ~/.p10k.zsh. Icons need a Nerd Font
            {st.p10kConfig ? '; your ~/.p10k.zsh is in place.' : '.'}
          </div>
        </section>
      )}
    </div>
  )
}
