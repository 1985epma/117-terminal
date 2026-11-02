// Shared command history across tabs, persisted by the main process.
class History {
  constructor() {
    this.items = []
    this.ready = window.eterm.history.load().then((items) => {
      this.items = Array.isArray(items) ? items : []
    })
    this._saveTimer = null
  }

  add(cmd) {
    const i = this.items.lastIndexOf(cmd)
    if (i !== -1) this.items.splice(i, 1)
    this.items.push(cmd)
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => window.eterm.history.save(this.items), 400)
  }

  // Most recent entry that extends `prefix`.
  suggest(prefix) {
    if (!prefix || prefix.includes('\n')) return ''
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      if (it.length > prefix.length && it.startsWith(prefix)) return it
    }
    return ''
  }

  search(query, limit = 50) {
    const q = query.toLowerCase()
    const out = []
    for (let i = this.items.length - 1; i >= 0 && out.length < limit; i--) {
      if (!q || this.items[i].toLowerCase().includes(q)) out.push(this.items[i])
    }
    return out
  }
}

export const history = new History()
