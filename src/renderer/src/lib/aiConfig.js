// Renderer-side mirror of the (key-less) AI provider config.
const listeners = new Set()
let state = { active: null, autoRunSafe: false, providers: [] }

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
