// Voice capture: microphone → 16 kHz mono 16-bit WAV → main process engine.
// Stops on its own after ~1.5 s of silence once speech was heard.

const TARGET_RATE = 16000
const MAX_SECONDS = 30
const SILENCE_MS = 1500
const SPEECH_LEVEL = 0.035

const listeners = new Set()
let state = { phase: 'idle', level: 0, message: '', hint: '' } // idle | listening | transcribing | thinking | error
let rec = null
let hintTimer = null

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

function loadSettings() {
  try {
    return { lang: 'auto', engine: 'auto', mode: 'smart', ...JSON.parse(localStorage.getItem('eterm:voice') || '{}') }
  } catch {
    return { lang: 'auto', engine: 'auto', mode: 'smart' }
  }
}
let settings = loadSettings()

function encodeWav(chunks, inputRate) {
  const length = chunks.reduce((n, c) => n + c.length, 0)
  const ratio = inputRate / TARGET_RATE
  const outLength = Math.floor(length / ratio)
  const pcm = new Int16Array(outLength)
  // Average each window of input samples (simple low-pass + decimation).
  let ci = 0
  let offset = 0
  let pos = 0
  for (let i = 0; i < outLength; i++) {
    const end = Math.floor((i + 1) * ratio)
    let sum = 0
    let count = 0
    while (pos < end && ci < chunks.length) {
      sum += chunks[ci][offset]
      count++
      pos++
      if (++offset >= chunks[ci].length) {
        ci++
        offset = 0
      }
    }
    const v = Math.max(-1, Math.min(1, count ? sum / count : 0))
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const dv = new DataView(buf)
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  dv.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, TARGET_RATE, true)
  dv.setUint32(28, TARGET_RATE * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  str(36, 'data')
  dv.setUint32(40, pcm.length * 2, true)
  new Int16Array(buf, 44).set(pcm)
  return { bytes: new Uint8Array(buf), seconds: outLength / TARGET_RATE }
}

function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export const voice = {
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get: () => state,
  settings: () => settings,
  setSettings(patch) {
    settings = { ...settings, ...patch }
    try {
      localStorage.setItem('eterm:voice', JSON.stringify(settings))
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((fn) => fn())
  },
  get busy() {
    return state.phase !== 'idle' && state.phase !== 'error'
  },

  // onText(transcript) is called once speech has been recognised.
  async start(onText) {
    if (rec) return
    if (!(await window.eterm.voice.permission())) {
      return set({ phase: 'error', message: 'Microphone access is off: System Settings › Privacy & Security › Microphone.' })
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
    } catch (err) {
      return set({ phase: 'error', message: `Microphone unavailable: ${err.message}` })
    }
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(4096, 1, 1)
    const chunks = []
    let heard = false
    let quietSince = performance.now()
    const startedAt = performance.now()
    proc.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0)
      chunks.push(new Float32Array(data))
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const level = Math.sqrt(sum / data.length)
      const now = performance.now()
      if (level > SPEECH_LEVEL) {
        heard = true
        quietSince = now
      }
      set({ level })
      if ((heard && now - quietSince > SILENCE_MS) || now - startedAt > MAX_SECONDS * 1000) voice.stop()
    }
    source.connect(proc)
    proc.connect(ctx.destination)
    rec = { stream, ctx, source, proc, chunks, onText, heard: () => heard }
    set({ phase: 'listening', level: 0, message: '' })
  },

  async stop() {
    const r = rec
    if (!r) return
    rec = null
    r.proc.onaudioprocess = null
    r.source.disconnect()
    r.proc.disconnect()
    r.stream.getTracks().forEach((t) => t.stop())
    const rate = r.ctx.sampleRate
    r.ctx.close()
    if (!r.heard()) return set({ phase: 'idle', level: 0 })
    const { bytes, seconds } = encodeWav(r.chunks, rate)
    if (seconds < 0.3) return set({ phase: 'idle', level: 0 })
    set({ phase: 'transcribing', level: 0 })
    const res = await window.eterm.voice.transcribe(toBase64(bytes), { lang: settings.lang, engine: settings.engine })
    if (!res.ok) return set({ phase: 'error', message: res.error })
    if (!res.text) return set({ phase: 'error', message: "Didn't catch that. Try again." })
    set({ phase: 'idle' })
    await r.onText(res.text)
  },

  cancel() {
    const r = rec
    rec = null
    if (r) {
      r.proc.onaudioprocess = null
      r.stream.getTracks().forEach((t) => t.stop())
      r.ctx.close()
    }
    set({ phase: 'idle', level: 0, message: '' })
  },

  toggle(onText) {
    if (rec) return voice.stop()
    if (state.phase === 'transcribing' || state.phase === 'thinking') return
    return voice.start(onText)
  },

  setPhase(phase, message = '') {
    set({ phase, message })
  },

  // Short "what you said → what I typed" note under the mic.
  showHint(hint) {
    clearTimeout(hintTimer)
    set({ hint })
    hintTimer = setTimeout(() => set({ hint: '' }), 6000)
  }
}
