// Renderer-side mirror of the (key-less) AI provider config.
const listeners = new Set()
let state = { active: null, autoRunSafe: false, maxTaskTokens: 0, providers: [] }

const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

// True when prompts and terminal output stay on this machine.
export function isLocalProvider(p) {
  if (!p) return false
  if (LOCAL_PROVIDERS.has(p.id)) return true
  try {
    return LOCAL_HOSTS.has(new URL(p.baseUrl).hostname)
  } catch {
    return false
  }
}

export function dataDestination(p) {
  if (!p) return ''
  return isLocalProvider(p)
    ? 'Runs on this machine: your prompt and terminal output stay local.'
    : `Your prompt and terminal output are sent to ${p.label}.`
}

export const aiConfig = {
  get: () => state,
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  set(next) {
    state = next
    listeners.forEach((fn) => fn())
    return next
  },
  async refresh() {
    return aiConfig.set(await window.eterm.ai.config())
  },
  activeProvider() {
    return state.providers.find((p) => p.id === state.active) || null
  },
  isReady() {
    const p = aiConfig.activeProvider()
    return !!p && !!p.model && (!p.needsKey || p.hasKey)
  }
}

aiConfig.refresh()
