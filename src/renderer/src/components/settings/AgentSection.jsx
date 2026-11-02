import { useEffect, useState, useSyncExternalStore } from 'react'
import { aiConfig } from '../../lib/aiConfig.js'

const HINTS = {
  anthropic: 'Claude Opus 5.5 is the default. Paste a key from the Anthropic Console.',
  openai: 'Paste a key from platform.openai.com.',
  gemini: 'Free keys at Google AI Studio. Defaults to the latest Gemini Flash model.',
  xai: 'Paste a key from console.x.ai to use Grok.',
  ollama: 'Runs models locally, no key needed. Install Ollama, then e.g. `ollama pull llama3.2`. Pick a model with tool support (llama3.1+, qwen2.5+, mistral-nemo…).',
  openrouter: 'One key, hundreds of models from every lab.',
  groq: 'Very fast hosted open models.',
  deepseek: 'DeepSeek’s hosted models.',
  mistral: 'Mistral’s hosted models.',
  lmstudio: 'Start the local server in LM Studio (Developer → Start server).',
  custom: 'Any server that speaks the OpenAI Chat Completions API (vLLM, LiteLLM, llama.cpp…).'
}

function ProviderForm({ p, isActive }) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(p.baseUrl)
  const [model, setModel] = useState(p.model)
  const [models, setModels] = useState([])
  const [recommended, setRecommended] = useState('')
  const [status, setStatus] = useState(null) // { ok, text }
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setApiKey('')
    setBaseUrl(p.baseUrl)
    setModel(p.model)
    setModels([])
    setStatus(null)
    // Local servers: probe right away so "connected" shows up without clicks.
    if (!p.needsKey || p.hasKey) test(false)
  }, [p.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (extra = {}) => {
    const patch = { id: p.id, baseUrl, model, ...extra }
    if (apiKey) patch.apiKey = apiKey
    const next = aiConfig.set(await window.eterm.ai.update(patch))
    setApiKey('')
    return next
  }

  async function test(persist = true) {
    setBusy(true)
    setStatus({ ok: null, text: 'Connecting…' })
    if (persist) await save()
    const res = await window.eterm.ai.models(p.id)
    setBusy(false)
    if (!res.ok) return setStatus({ ok: false, text: res.error })
    setModels(res.models)
    setRecommended(res.recommended)
    setStatus({ ok: true, text: `Connected · ${res.models.length} chat models available` })
    // No model yet, or one that isn't a chat model: use the recommended one.
    if (res.recommended && (!model || !res.models.includes(model))) {
      setModel(res.recommended)
      aiConfig.set(await window.eterm.ai.update({ id: p.id, model: res.recommended }))
    }
  }

  const connect = async () => {
    await test(true)
    aiConfig.set(await window.eterm.ai.options({ active: p.id }))
  }

  return (
    <div className="provider-form">
      <div className="pf-head">
        <h2>{p.label}</h2>
        {isActive ? <span className="pill pill-on">● Active</span> : null}
      </div>
      <p className="pf-hint">{HINTS[p.id]}</p>

      {p.needsKey && (
        <label className="field">
          <span>
            API key
            {p.keyUrl && (
              <a href={p.keyUrl} target="_blank" rel="noreferrer">
                Get a key ↗
              </a>
            )}
          </span>
          <input
            type="password"
            placeholder={
              p.hasKey ? `${p.keyHint} ${p.keySource === 'env' ? `(from $${p.env})` : '(saved in Keychain)'}` : 'Paste your key'
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {p.keySource === 'saved' && (
            <button
              className="link"
              onClick={async () => aiConfig.set(await window.eterm.ai.update({ id: p.id, clearKey: true }))}
            >
              Remove saved key
            </button>
          )}
        </label>
      )}

      <label className="field">
        <span>Model</span>
        <input
          list={`models-${p.id}`}
          value={model}
          placeholder={models.length ? 'Choose or type a model' : 'Test the connection to list models'}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => save()}
          spellCheck={false}
        />
        {recommended && recommended !== model && (
          <button
            className="link recommend"
            onClick={async () => {
              setModel(recommended)
              aiConfig.set(await window.eterm.ai.update({ id: p.id, model: recommended }))
            }}
          >
            Use recommended: {recommended}
          </button>
        )}
        <datalist id={`models-${p.id}`}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <details className="advanced" open={p.id === 'custom'}>
        <summary>Advanced</summary>
        <label className="field">
          <span>Base URL</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} onBlur={() => save()} spellCheck={false} />
        </label>
      </details>

      {status && (
        <div className={`pf-status ${status.ok === true ? 'ok' : status.ok === false ? 'bad' : ''}`}>{status.text}</div>
      )}

      <div className="pf-actions">
        <button onClick={() => test(true)} disabled={busy}>
          Test connection
        </button>
        <button className="primary" onClick={connect} disabled={busy}>
          {isActive ? 'Save' : 'Connect & use'}
        </button>
      </div>
    </div>
  )
}

export default function AgentSection() {
  const cfg = useSyncExternalStore(aiConfig.subscribe, aiConfig.get)
  const [selected, setSelected] = useState(() => cfg.active || 'anthropic')
  const p = cfg.providers.find((x) => x.id === selected)

  return (
    <div className="agent-section">
      <div className="agent-providers">
        {cfg.providers.map((x) => (
          <button key={x.id} className={`prov ${x.id === selected ? 'sel' : ''}`} onClick={() => setSelected(x.id)}>
            <span className={`dot ${x.id === cfg.active ? 'active' : x.hasKey || !x.needsKey ? 'ready' : ''}`} />
            {x.label}
          </button>
        ))}
        <label className="toggle">
          <input
            type="checkbox"
            checked={cfg.autoRunSafe}
            onChange={async (e) => aiConfig.set(await window.eterm.ai.options({ autoRunSafe: e.target.checked }))}
          />
          <span>Auto-run read-only commands (ls, cat, git status…)</span>
        </label>
      </div>
      <div className="agent-form">{p ? <ProviderForm key={p.id} p={p} isActive={cfg.active === p.id} /> : null}</div>
    </div>
  )
}
