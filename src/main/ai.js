// Agent Mode backend: one place that knows how to talk to every provider.
// Two wire formats cover them all:
//   - "anthropic": official Anthropic SDK (Claude)
//   - "openai":    OpenAI-compatible Chat Completions over fetch + SSE
//                  (OpenAI, Gemini, xAI Grok, Ollama, OpenRouter, Groq, ...)
// API keys live only in the main process, encrypted with the OS keychain.
import { app, safeStorage } from 'electron'
import { ipcMain } from './ipc.js'
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { agentTools } from './mcp.js'

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    needsKey: true,
    env: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-opus-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    env: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  gemini: {
    label: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true,
    env: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  xai: {
    label: 'xAI Grok',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    needsKey: true,
    env: 'XAI_API_KEY',
    keyUrl: 'https://console.x.ai'
  },
  ollama: {
    label: 'Ollama (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    keyUrl: 'https://ollama.com/download'
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    env: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys'
  },
  groq: {
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
    env: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys'
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    needsKey: true,
    env: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com/api_keys'
  },
  mistral: {
    label: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    needsKey: true,
    env: 'MISTRAL_API_KEY',
    keyUrl: 'https://console.mistral.ai/api-keys'
  },
  lmstudio: {
    label: 'LM Studio (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    keyUrl: 'https://lmstudio.ai'
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: 'http://localhost:8000/v1',
    needsKey: false
  }
}

// Models that accept server-side refusal fallbacks ("default" routing).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

// ---- config persistence ---------------------------------------------------

const configPath = () => path.join(app.getPath('userData'), 'ai.json')
let config = null

function loadConfig() {
  if (config) return config
  try {
    config = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    config = {}
  }
  config.providers ||= {}
  config.active ||= null
  config.autoRunSafe ??= false
  return config
}

function saveConfig() {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 })
}

// `hint` (last 4 characters) is kept beside the ciphertext so listing providers never
// touches the Keychain: macOS only asks for it when a key is actually used.
function encrypt(text) {
  const hint = text.slice(-4)
  if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(text).toString('base64'), hint }
  return { plain: text, hint }
}

function decrypt(stored) {
  if (!stored) return ''
  if (stored.plain) return stored.plain
  try {
    return safeStorage.decryptString(Buffer.from(stored.enc, 'base64'))
  } catch {
    return ''
  }
}

// True when a key is saved or in the environment, without reading the Keychain.
export function hasKey(id) {
  const def = PROVIDERS[id]
  return !!(loadConfig().providers[id]?.key || (def?.env && process.env[def.env]))
}

export function resolve(id) {
  const def = PROVIDERS[id]
  if (!def) throw new Error(`Unknown provider: ${id}`)
  const saved = loadConfig().providers[id] || {}
  const savedKey = decrypt(saved.key)
  // Keys saved before hints existed get one the first time they are used.
  if (savedKey && !saved.key.hint) {
    saved.key.hint = savedKey.slice(-4)
    saveConfig()
  }
  const envKey = def.env ? process.env[def.env] || '' : ''
  return {
    id,
    ...def,
    baseUrl: (saved.baseUrl || def.baseUrl).replace(/\/+$/, ''),
    model: saved.model || def.defaultModel || '',
    apiKey: savedKey || envKey,
    keySource: savedKey ? 'saved' : envKey ? 'env' : null
  }
}

// Re-encrypt keys carried over from a previous app identity (see migrate.js).
export function importKeys(keys) {
  const c = loadConfig()
  for (const [id, key] of Object.entries(keys || {})) {
    if (!PROVIDERS[id] || !key) continue
    ;(c.providers[id] ||= {}).key = encrypt(key)
  }
  saveConfig()
}

function publicConfig() {
  const c = loadConfig()
  return {
    active: c.active,
    autoRunSafe: c.autoRunSafe,
    providers: Object.keys(PROVIDERS).map((id) => {
      const def = PROVIDERS[id]
      const saved = c.providers[id] || {}
      const envKey = def.env ? process.env[def.env] || '' : ''
      const hint = saved.key ? saved.key.hint || saved.key.plain?.slice(-4) || '' : envKey.slice(-4)
      const p = {
        ...def,
        baseUrl: (saved.baseUrl || def.baseUrl).replace(/\/+$/, ''),
        model: saved.model || def.defaultModel || '',
        keySource: saved.key ? 'saved' : envKey ? 'env' : null
      }
      return {
        id,
        label: p.label,
        kind: p.kind,
        baseUrl: p.baseUrl,
        defaultBaseUrl: PROVIDERS[id].baseUrl,
        model: p.model,
        needsKey: p.needsKey,
        hasKey: !!p.keySource,
        keySource: p.keySource,
        keyHint: p.keySource ? `••••${hint}` : '',
        keyUrl: p.keyUrl || '',
        env: p.env || ''
      }
    })
  }
}

// ---- model listing ----------------------------------------------------------

export function openaiHeaders(p) {
  const h = { 'Content-Type': 'application/json' }
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`
  if (p.id === 'openrouter') {
    h['HTTP-Referer'] = 'https://github.com/eterminal'
    h['X-Title'] = '117Terminal'
  }
  return h
}

// Models that can't chat with tools (embeddings, speech, images, ...).
const NON_CHAT = /embed|tts|whisper|transcri|dall-e|image|imagen|veo|audio|realtime|moderation|aqa|search|guard|rerank|computer-use|live|robotics|banana/i

// Best default per provider when the user hasn't picked a model yet.
const PREFERRED = {
  anthropic: [/^claude-opus-5-5$/, /^claude-sonnet-5-5$/, /^claude-opus/, /^claude-sonnet/],
  openai: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/, /^gpt-/],
  gemini: [/^gemini-flash-latest$/, /^gemini-[\d.]+-flash$/, /^gemini-.*-flash(?!-lite)/, /^gemini-.*flash/],
  xai: [/^grok-\d+$/, /^grok-[\d.]+$/, /^grok/],
  mistral: [/^mistral-large-latest$/, /^mistral-medium-latest$/, /^mistral/],
  deepseek: [/^deepseek-chat$/],
  groq: [/llama-3\.3-70b/, /llama/, /qwen/],
  openrouter: [/^anthropic\/claude-opus/, /^openai\/gpt-5/, /^google\/gemini.*pro/]
}

function versionKey(name) {
  return (name.match(/\d+(\.\d+)?/g) || []).map(Number)
}

function recommend(id, models) {
  for (const re of PREFERRED[id] || []) {
    const hits = models.filter((m) => re.test(m) && !/preview|exp|test/i.test(m))
    const pool = hits.length ? hits : models.filter((m) => re.test(m))
    if (pool.length) {
      // Newest version first.
      return pool.sort((a, b) => {
        const va = versionKey(a)
        const vb = versionKey(b)
        for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0)
        return a.length - b.length
      })[0]
    }
  }
  return models[0] || ''
}

async function listModels(id) {
  const p = resolve(id)
  if (p.needsKey && !p.apiKey) throw new Error('Add an API key first.')
  if (p.kind === 'anthropic') {
    const client = new Anthropic({ apiKey: p.apiKey, baseURL: p.baseUrl })
    const ids = []
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id)
    return ids
  }
  const res = await fetch(`${p.baseUrl}/models`, { headers: openaiHeaders(p), signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`${res.status}: ${apiErrorMessage(await res.text())}`)
  const body = await res.json()
  let models = (body.data || body.models || [])
    .map((m) => (m.id || m.name || '').replace(/^models\//, ''))
    .filter((m) => m && !NON_CHAT.test(m))
  if (id === 'gemini') models = models.filter((m) => m.startsWith('gemini'))
  return models.sort()
}

// ---- chat -------------------------------------------------------------------

const RUN_COMMAND_TOOL = {
  name: 'run_command',
  description:
    "Run a shell command in the user's terminal (their real interactive shell, in the current working directory). " +
    'The user sees the command and must approve it before it runs. The command output (last part, if long) and exit ' +
    'code are returned. Do not run interactive or full-screen programs (vim, less, top) or commands that never exit.',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The exact shell command to run.' },
      reason: { type: 'string', description: 'One short sentence telling the user why this command is needed.' }
    },
    required: ['command', 'reason'],
    additionalProperties: false
  }
}

function toAnthropicMessages(messages) {
  const out = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      // Replay Claude's own content unchanged (keeps thinking blocks valid).
      if (m.raw?.provider === 'anthropic') {
        out.push({ role: 'assistant', content: m.raw.content })
      } else {
        const content = []
        if (m.content) content.push({ type: 'text', text: m.content })
        for (const tc of m.toolCalls || []) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
        if (content.length) out.push({ role: 'assistant', content })
      }
    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content, is_error: !!m.isError }
      const last = out[out.length - 1]
      // All results for one assistant turn go back in a single user message.
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
        last.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
    }
  }
  return out
}

async function chatAnthropic(p, { system, messages, tools }, onText, signal) {
  const client = new Anthropic({ apiKey: p.apiKey, baseURL: p.baseUrl })
  const params = {
    model: p.model,
    max_tokens: 32000,
    system,
    messages: toAnthropicMessages(messages),
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
      eager_input_streaming: true
    }))
  }
  if (FALLBACK_MODELS.has(p.model)) {
    params.betas = ['server-side-fallback-2026-07-01']
    params.fallbacks = 'default'
  }
  const stream = params.betas
    ? client.beta.messages.stream(params, { signal })
    : client.messages.stream(params, { signal })
  stream.on('text', (delta) => onText(delta))
  const msg = await stream.finalMessage()

  if (msg.stop_reason === 'refusal') {
    const why = msg.stop_details?.explanation || msg.stop_details?.category || ''
    throw new Error(`The model declined this request${why ? `: ${why}` : '.'}`)
  }
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const toolUses = msg.content.filter((b) => b.type === 'tool_use')
  // A tool call cut off by max_tokens may carry truncated input: don't run it.
  if (msg.stop_reason === 'max_tokens' && toolUses.length) throw new Error('Response was cut off mid tool call.')
  const toolCalls = toolUses.map((b) => ({ id: b.id, name: b.name, args: b.input || {} }))
  return { content: text, toolCalls, raw: { provider: 'anthropic', content: msg.content } }
}

function toOpenAIMessages(system, messages) {
  const out = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content })
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || '' }
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          // Provider extras must round-trip (Gemini 3 thought signatures).
          ...(tc.extra ? { extra_content: tc.extra } : {})
        }))
      }
      out.push(msg)
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    }
  }
  return out
}

async function chatOpenAI(p, { system, messages, tools }, onText, signal) {
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: openaiHeaders(p),
    signal,
    body: JSON.stringify({
      model: p.model,
      stream: true,
      messages: toOpenAIMessages(system, messages),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.schema }
      }))
    })
  })
  if (!res.ok) throw new Error(`${p.label} (${res.status}): ${apiErrorMessage(await res.text())}`)

  let text = ''
  const calls = [] // by index
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let evt
      try {
        evt = JSON.parse(data)
      } catch {
        continue
      }
      if (evt.error) throw new Error(evt.error.message || JSON.stringify(evt.error))
      const delta = evt.choices?.[0]?.delta
      if (!delta) continue
      if (delta.content) {
        text += delta.content
        onText(delta.content)
      }
      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? calls.length
        calls[i] ||= { id: '', name: '', args: '', extra: null }
        if (tc.id) calls[i].id = tc.id
        if (tc.extra_content) calls[i].extra = { ...calls[i].extra, ...tc.extra_content }
        if (tc.function?.name) calls[i].name += tc.function.name
        if (tc.function?.arguments) {
          // Some servers send the full arguments object instead of string deltas.
          calls[i].args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments)
        }
      }
    }
  }

  const toolCalls = calls.filter(Boolean).map((c, i) => {
    let args = {}
    try {
      args = c.args ? JSON.parse(c.args) : {}
    } catch {
      args = { __invalid: c.args }
    }
    const call = { id: c.id || `call_${Date.now()}_${i}`, name: c.name || RUN_COMMAND_TOOL.name, args }
    if (c.extra) call.extra = c.extra
    return call
  })
  return { content: text, toolCalls }
}

export const activeProviderId = () => loadConfig().active

// One-shot text completion without tools (used by voice → command).
export async function complete(p, system, user) {
  if (p.kind === 'anthropic') {
    const client = new Anthropic({ apiKey: p.apiKey, baseURL: p.baseUrl })
    const msg = await client.messages.create({
      model: p.model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }]
    })
    if (msg.stop_reason === 'refusal') throw new Error('The model declined this request.')
    return msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
  }
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: openaiHeaders(p),
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: p.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  })
  if (!res.ok) throw new Error(`${p.label} (${res.status}): ${apiErrorMessage(await res.text())}`)
  const body = await res.json()
  return (body.choices?.[0]?.message?.content || '').trim()
}

const inflight = new Map()

export function registerAiIpc(getWindow) {
  const send = (...args) => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(...args)
  }

  ipcMain.handle('ai:config', () => publicConfig())

  ipcMain.handle('ai:update', (_e, { id, apiKey, baseUrl, model, clearKey }) => {
    const c = loadConfig()
    const entry = (c.providers[id] ||= {})
    if (apiKey !== undefined && apiKey !== '') entry.key = encrypt(apiKey.trim())
    if (clearKey) delete entry.key
    if (baseUrl !== undefined) entry.baseUrl = baseUrl.trim() || undefined
    if (model !== undefined) entry.model = model.trim() || undefined
    if (!c.active) c.active = id
    saveConfig()
    return publicConfig()
  })

  ipcMain.handle('ai:options', (_e, opts) => {
    const c = loadConfig()
    if (opts.active !== undefined) c.active = opts.active
    if (opts.autoRunSafe !== undefined) c.autoRunSafe = !!opts.autoRunSafe
    saveConfig()
    return publicConfig()
  })

  ipcMain.handle('ai:models', async (_e, id) => {
    try {
      const models = await listModels(id)
      return { ok: true, models, recommended: recommend(id, models) }
    } catch (err) {
      return { ok: false, error: friendlyError(err) }
    }
  })

  ipcMain.on('ai:chat', async (_e, { requestId, system, messages }) => {
    const controller = new AbortController()
    inflight.set(requestId, controller)
    try {
      const id = loadConfig().active
      if (!id) throw new Error('No AI provider connected. Open Settings › AI Agent (⌘,) to connect one.')
      const p = resolve(id)
      if (p.needsKey && !p.apiKey) throw new Error(`${p.label} has no API key. Add one in Settings › AI Agent (⌘,).`)
      if (!p.model) throw new Error(`Pick a model for ${p.label} in Settings › AI Agent (⌘,).`)
      const onText = (text) => send('ai:event', requestId, { type: 'text', text })
      const mcp = await agentTools()
      const tools = [RUN_COMMAND_TOOL, ...mcp]
      const run = p.kind === 'anthropic' ? chatAnthropic : chatOpenAI
      const result = await run(p, { system, messages, tools }, onText, controller.signal)
      // Tell the renderer which calls go to MCP servers (and if those are trusted).
      for (const tc of result.toolCalls) {
        const t = mcp.find((x) => x.name === tc.name)
        if (t) tc.mcp = { server: t.server, tool: t.tool, trusted: t.trusted }
      }
      send('ai:event', requestId, { type: 'done', message: result })
    } catch (err) {
      send('ai:event', requestId, { type: 'error', error: controller.signal.aborted ? 'Stopped.' : friendlyError(err) })
    } finally {
      inflight.delete(requestId)
    }
  })

  ipcMain.on('ai:abort', (_e, requestId) => inflight.get(requestId)?.abort())
}

// Pulls the human message out of OpenAI/Gemini/xAI style error bodies.
export function apiErrorMessage(text) {
  let msg = text
  try {
    let body = JSON.parse(text)
    if (Array.isArray(body)) body = body[0]
    msg = body?.error?.message || body?.message || body?.error || text
  } catch {
    /* not JSON */
  }
  msg = String(msg).slice(0, 400)
  if (/function calling|tool.*not (supported|enabled)|does not support tools|multiturn/i.test(msg)) {
    msg += ' — this model can’t be used by the agent. Pick another one with /model.'
  }
  return msg
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic rejected the API key (401). Check it in Agent settings.'
  if (err instanceof Anthropic.NotFoundError) return 'Model not found (404). Pick another model in Agent settings.'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic (429). Try again in a moment.'
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`
  const msg = err?.cause?.code === 'ECONNREFUSED' ? 'Connection refused — is the local server running?' : err?.message
  return msg || String(err)
}
