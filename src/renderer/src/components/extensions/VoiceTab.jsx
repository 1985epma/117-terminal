import { useEffect, useState, useSyncExternalStore } from 'react'
import { voice } from '../../lib/voice.js'
import { Loading } from './ZshTab.jsx'

const LANGS = [
  { id: 'auto', label: 'Auto-detect', sample: 'EN · PT · ES' },
  { id: 'en-US', label: 'English (US)', sample: '“show git status”' },
  { id: 'pt-BR', label: 'Português (BR)', sample: '“listar os arquivos ocultos”' },
  { id: 'es', label: 'Español', sample: '“crear una carpeta llamada test”' }
]

const MODES = [
  { id: 'smart', label: 'Understand', desc: 'Turns what you say into a shell command and types it for you to review. Several-step requests go to Agent Mode.' },
  { id: 'dictate', label: 'Dictate', desc: 'Types exactly what you said.' }
]

export default function VoiceTab({ onRunInTerminal }) {
  useSyncExternalStore(voice.subscribe, voice.get)
  const cfg = voice.settings()
  const [st, setSt] = useState(null)
  const [dl, setDl] = useState(null) // { key, progress } | { error }

  const refresh = () => window.eterm.voice.status().then(setSt)
  useEffect(() => {
    refresh()
    return window.eterm.voice.onProgress((p) => setDl((d) => (d ? { ...d, progress: p } : d)))
  }, [])

  const download = async (key) => {
    setDl({ key, progress: 0 })
    const r = await window.eterm.voice.downloadModel(key)
    setDl(r.ok ? null : { error: r.error })
    refresh()
  }

  if (!st) return <Loading text="Checking voice engines…" />
  const engineReady = (id) => st.engines.find((e) => e.id === id)?.ready

  return (
    <div className="ext-tab">
      <div className="pf-head">
        <h2>Voice</h2>
        <span className="pill pill-on">⌘⇧Space</span>
      </div>
      <p className="pf-hint">
        Press <kbd>⌘⇧Space</kbd> or the 🎙 button at the top right, talk, then pause: it stops by itself and types the
        result into the editor. Nothing runs until you press <kbd>↵</kbd>.
      </p>

      {st.mic === 'denied' || st.mic === 'restricted' ? (
        <div className="pf-status bad">
          Microphone access is off for 117Terminal: System Settings › Privacy &amp; Security › Microphone.
        </div>
      ) : null}

      <section className="ext-section">
        <h3>Language</h3>
        <div className="ext-cards">
          {LANGS.map((l) => (
            <div
              key={l.id}
              role="button"
              tabIndex={0}
              className={`ext-card ${cfg.lang === l.id ? 'current' : ''}`}
              onClick={() => voice.setSettings({ lang: l.id })}
              onKeyDown={(e) => e.key === 'Enter' && voice.setSettings({ lang: l.id })}
            >
              <div className="ext-card-title">
                {l.label}
                {cfg.lang === l.id && <span className="theme-check">✓</span>}
              </div>
              <div className="ext-desc">{l.sample}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="ext-section">
        <h3>In the shell</h3>
        <div className="ext-cards">
          {MODES.map((m) => (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              className={`ext-card ${cfg.mode === m.id ? 'current' : ''}`}
              onClick={() => voice.setSettings({ mode: m.id })}
              onKeyDown={(e) => e.key === 'Enter' && voice.setSettings({ mode: m.id })}
            >
              <div className="ext-card-title">
                {m.label}
                {cfg.mode === m.id && <span className="theme-check">✓</span>}
              </div>
              <div className="ext-desc">{m.desc}</div>
            </div>
          ))}
        </div>
        <p className="pf-hint">In Agent Mode your words always become the prompt for the agent.</p>
      </section>

      <section className="ext-section">
        <h3>Speech engine</h3>
        <div className="ext-chips">
          <button className={`ext-chip ${cfg.engine === 'auto' ? 'sel' : ''}`} onClick={() => voice.setSettings({ engine: 'auto' })}>
            Auto
          </button>
          {st.engines.map((e) => (
            <button
              key={e.id}
              className={`ext-chip ${cfg.engine === e.id ? 'sel' : ''}`}
              disabled={!e.ready}
              title={e.ready ? '' : e.id === 'local' ? 'Set up below' : `Add a ${e.provider} key with ⌘,`}
              onClick={() => voice.setSettings({ engine: e.id })}
            >
              {e.ready ? '●' : '○'} {e.label}
            </button>
          ))}
        </div>
        <p className="pf-hint">
          Auto uses your active AI provider when it can transcribe (Gemini, OpenAI, Groq), then any other connected
          one, then local Whisper. Anthropic has no speech-to-text, so with Claude active Auto picks another engine.
          Turning speech into commands uses your active chat model.
        </p>
      </section>

      <section className="ext-section">
        <h3>Local Whisper (offline, private)</h3>
        <p className="pf-hint">Runs whisper.cpp on this Mac: audio never leaves your machine.</p>
        <div className="ext-chips">
          {st.local.bin ? (
            <span className="ext-chip sel">✓ whisper.cpp installed</span>
          ) : (
            <button className="ext-btn small primary-ish" onClick={() => onRunInTerminal('brew install whisper-cpp')}>
              Install whisper.cpp with Homebrew
            </button>
          )}
          {st.local.models.map((m) =>
            m.present ? (
              <span key={m.id} className="ext-chip sel">
                ✓ {m.id} model
              </span>
            ) : (
              <button key={m.id} className="ext-btn small" disabled={!!dl?.key} onClick={() => download(m.id)}>
                {dl?.key === m.id ? `Downloading ${Math.round((dl.progress || 0) * 100)}%` : `Download ${m.id} model (${m.size})`}
              </button>
            )
          )}
        </div>
        {dl?.error && <div className="pf-status bad">{dl.error}</div>}
        {engineReady('local') && <div className="pf-status ok">Local Whisper is ready.</div>}
      </section>
    </div>
  )
}
