// Voice input: speech → text (cloud provider or local whisper.cpp) and
// text → shell command. Audio arrives from the renderer as 16 kHz mono WAV.
import { ipcMain, systemPreferences } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolve, openaiHeaders, apiErrorMessage, activeProviderId, complete, PROVIDERS } from './ai.js'
import { run, which } from './shellenv.js'
import { ETERM_DIR } from './zsh-plugins.js'

export const LANGUAGES = {
  auto: { label: 'Auto', whisper: 'auto', name: 'English, Brazilian Portuguese or Spanish (detect which)' },
  'en-US': { label: 'EN', whisper: 'en', name: 'American English' },
  'pt-BR': { label: 'PT', whisper: 'pt', name: 'Brazilian Portuguese' },
  es: { label: 'ES', whisper: 'es', name: 'Spanish' }
}

// Cloud engines and the provider they use. Anthropic has no speech-to-text.
const CLOUD = {
  gemini: { provider: 'gemini', label: 'Google Gemini' },
  openai: { provider: 'openai', label: 'OpenAI (gpt-4o-mini-transcribe)' },
  groq: { provider: 'groq', label: 'Groq (Whisper large v3 turbo)' }
}

const WHISPER_DIR = path.join(ETERM_DIR, 'whisper')
const MODELS = {
  base: { file: 'ggml-base.bin', size: '142 MB', note: 'fast, good for short commands' },
  small: { file: 'ggml-small.bin', size: '466 MB', note: 'more accurate, slower' }
}
const modelUrl = (file) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`

const ready = (id) => {
  const p = resolve(id)
  return !p.needsKey || !!p.apiKey
}

async function whisperBin() {
  return (await which('whisper-cli')) || (await which('whisper-cpp')) || ''
}

function localModel() {
  for (const key of ['small', 'base']) {
    const f = path.join(WHISPER_DIR, MODELS[key].file)
    if (fs.existsSync(f)) return f
  }
  return ''
}

// 'auto': the active provider if it can transcribe, then any configured cloud
// engine, then local whisper.
async function pickEngine(preferred) {
  if (preferred && preferred !== 'auto') return preferred
  const active = activeProviderId()
  if (CLOUD[active] && ready(active)) return active
  for (const id of Object.keys(CLOUD)) if (ready(id)) return id
  if ((await whisperBin()) && localModel()) return 'local'
  throw new Error('No voice engine yet. Connect Gemini, OpenAI or Groq (⌘,), or set up local Whisper in /voice.')
}

const HINT =
  'This is a voice command for a computer terminal. Keep program names, flags, paths and technical words as spoken ' +
  '(git, npm, kubectl, docker, ls, cd…).'

async function transcribeGemini(wav, lang) {
  const p = resolve('gemini')
  const base = 'https://generativelanguage.googleapis.com/v1beta'
  const model = p.model || 'gemini-flash-latest'
  const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.apiKey },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Transcribe this audio exactly. The speaker uses ${LANGUAGES[lang].name}. ${HINT} ` +
                'Reply with the transcript only: no quotes, no translation, no commentary.'
            },
            { inline_data: { mime_type: 'audio/wav', data: wav.toString('base64') } }
          ]
        }
      ],
      generationConfig: { temperature: 0 }
    })
  })
  if (!res.ok) throw new Error(`Gemini (${res.status}): ${apiErrorMessage(await res.text())}`)
  const body = await res.json()
  return (body.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim()
}

async function transcribeOpenAI(id, wav, lang) {
  const p = resolve(id)
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'voice.wav')
  form.append('model', id === 'groq' ? 'whisper-large-v3-turbo' : 'gpt-4o-mini-transcribe')
  form.append('prompt', HINT)
  if (lang !== 'auto') form.append('language', LANGUAGES[lang].whisper)
  const headers = openaiHeaders(p)
  delete headers['Content-Type'] // fetch sets the multipart boundary
  const res = await fetch(`${p.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(60000)
  })
  if (!res.ok) throw new Error(`${p.label} (${res.status}): ${apiErrorMessage(await res.text())}`)
  return ((await res.json()).text || '').trim()
}

async function transcribeLocal(wav, lang) {
  const bin = await whisperBin()
  const model = localModel()
  if (!bin || !model) throw new Error('Local Whisper is not set up. Open /voice to install it.')
  const file = path.join(os.tmpdir(), `117terminal-voice-${Date.now()}.wav`)
  fs.writeFileSync(file, wav)
  try {
    const r = await run(bin, ['-m', model, '-l', LANGUAGES[lang].whisper, '-f', file, '-nt', '-np'], { timeout: 120000 })
    if (!r.ok) throw new Error(r.stderr.trim().split('\n').pop() || r.error)
    return r.stdout.replace(/\s+/g, ' ').trim()
  } finally {
    fs.rmSync(file, { force: true })
  }
}

async function transcribe(wav, { lang = 'auto', engine = 'auto' } = {}) {
  const id = await pickEngine(engine)
  if (!LANGUAGES[lang]) lang = 'auto'
  if (id === 'local') return { text: await transcribeLocal(wav, lang), engine: 'local' }
  if (id === 'gemini') return { text: await transcribeGemini(wav, lang), engine: id }
  if (id === 'openai' || id === 'groq') return { text: await transcribeOpenAI(id, wav, lang), engine: id }
  throw new Error(`Unknown voice engine: ${id}`)
}

// Natural language → one shell command, using the active chat provider.
async function toCommand(text, { shell, cwd, platform }) {
  const id = activeProviderId()
  if (!id) throw new Error('Connect an AI provider (⌘,) to turn speech into commands.')
  const p = resolve(id)
  const system = [
    `You turn spoken requests in English, Brazilian Portuguese or Spanish into ONE ${shell || 'zsh'} command for ${platform}.`,
    `The current directory is ${cwd}.`,
    'Reply with the command only: no backticks, no explanation, no leading $.',
    "If the text already is a command, fix spoken symbols (dash/traço/guion → -, slash/barra → /, dot/ponto/punto → ., pipe → |) and return it.",
    'Prefer safe, read-only commands when the request is ambiguous.',
    'If it needs several steps or cannot be one command, reply with exactly: AGENT'
  ].join('\n')
  const out = (await complete(p, system, text)).replace(/^```\w*\n?|```$/g, '').trim()
  return out.split('\n')[0].trim()
}

async function downloadModel(key, onProgress) {
  const m = MODELS[key]
  if (!m) throw new Error(`Unknown model ${key}`)
  fs.mkdirSync(WHISPER_DIR, { recursive: true })
  const target = path.join(WHISPER_DIR, m.file)
  const tmp = `${target}.part`
  const res = await fetch(modelUrl(m.file))
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  const out = fs.createWriteStream(tmp)
  let done = 0
  for await (const chunk of res.body) {
    out.write(chunk)
    done += chunk.length
    onProgress(total ? done / total : 0)
  }
  await new Promise((r) => out.end(r))
  fs.renameSync(tmp, target)
  return target
}

export function registerVoiceIpc(getWindow) {
  const send = (...a) => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(...a)
  }

  ipcMain.handle('voice:status', async () => {
    const active = activeProviderId()
    const bin = await whisperBin()
    return {
      languages: Object.entries(LANGUAGES).map(([id, l]) => ({ id, label: l.label, name: l.name })),
      active,
      engines: [
        ...Object.entries(CLOUD).map(([id, e]) => ({ id, label: e.label, ready: ready(id), provider: PROVIDERS[id].label })),
        { id: 'local', label: 'Local Whisper (offline)', ready: !!(bin && localModel()) }
      ],
      local: {
        bin,
        model: localModel(),
        models: Object.entries(MODELS).map(([id, m]) => ({ id, ...m, present: fs.existsSync(path.join(WHISPER_DIR, m.file)) }))
      },
      mic: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted'
    }
  })

  ipcMain.handle('voice:permission', async () => {
    if (process.platform !== 'darwin') return true
    return systemPreferences.askForMediaAccess('microphone')
  })

  ipcMain.handle('voice:transcribe', async (_e, wavBase64, opts) => {
    try {
      return { ok: true, ...(await transcribe(Buffer.from(wavBase64, 'base64'), opts)) }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('voice:toCommand', async (_e, text, ctx) => {
    try {
      return { ok: true, command: await toCommand(text, { ...ctx, platform: os.platform() === 'darwin' ? 'macOS' : os.platform() }) }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('voice:downloadModel', async (_e, key) => {
    try {
      const file = await downloadModel(key, (f) => send('voice:progress', f))
      return { ok: true, file }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })
}

