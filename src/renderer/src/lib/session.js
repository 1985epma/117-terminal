import { Terminal } from '@xterm/xterm'
import { BufferSerializer } from './serialize.js'
import { history } from './history.js'
import { setHome } from './paths.js'
import { Agent, AgentTurn } from './agent.js'

const HELP_TEXT = `**Slash commands**
- \`/agent [prompt]\` — switch to Agent Mode, or ask right away
- \`/new [prompt]\` — start a fresh agent conversation
- \`/shell\` — back to the regular shell
- \`/model\` — connect or switch AI provider and model
- \`/stop\` — stop the agent
- \`/theme\` — pick a color theme, transparency
- \`/plugins\` — zsh plugins · \`/prompt\` — Powerlevel10k, Starship…
- \`/mcp\` — MCP servers for the agent · \`/brewcat\` — Homebrew catalog
- \`/voice\` — voice settings · **⌘⇧Space** talk and it types the command (EN · PT · ES)
- \`/music\` — Spotify & Apple Music · \`/music next\`, \`/music <song>\`
- \`/clear\` — clear all blocks

**Shortcuts**
- \`⌘I\` toggle Agent Mode · \`#\` at line start asks the agent once
- \`↵\` run the proposed command · \`esc\` skip it · \`⌘↵\` run from anywhere
- \`⌘P\` command palette · \`⌃R\` history · \`⌘K\` clear · \`⌘,\` providers`

let nextBlockId = 1
let nextSessionId = 1
// Unique across windows and browser tabs sharing one server.
const sessionPrefix = Math.random().toString(36).slice(2, 8)
export const newBlockId = () => nextBlockId++

const OSC_PREFIX = '\x1b]6973;'

// One command and its output. Output is parsed by an (unmounted) xterm.js
// instance so cursor movement, \r progress bars and colors behave correctly.
export class Block {
  constructor({ command, cwd, branch, cols, rows }) {
    this.id = nextBlockId++
    this.kind = 'command'
    this.command = command
    this.cwd = cwd
    this.branch = branch
    this.startedAt = Date.now()
    this.endedAt = null
    this.exitCode = null
    this.collapsed = false
    this.version = 0
    this.term = new Terminal({ cols, rows, scrollback: 20000, allowProposedApi: true })
    this.serializer = new BufferSerializer(this.term)
    this._html = ''
    this._htmlVersion = -1
  }

  get running() {
    return this.exitCode === null
  }

  get html() {
    if (this._htmlVersion !== this.version) {
      this._html = this.serializer.toHtml()
      this._htmlVersion = this.version
    }
    return this._html
  }

  get text() {
    return this.serializer.toText()
  }

  // Text of the row the cursor is on (used to spot password prompts).
  lastLine() {
    const buf = this.term.buffer.active
    return buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) || ''
  }

  resize(cols, rows) {
    if (cols === this.term.cols && rows === this.term.rows) return
    this.term.resize(cols, rows)
    this.serializer.reset()
    this.version++
  }

  dispose() {
    this.term.dispose()
  }
}

export class Session {
  constructor({ cwd } = {}) {
    this.id = `s${sessionPrefix}-${nextSessionId++}`
    this.blocks = []
    this.state = 'starting' // starting | idle | submitted | running | exited
    this.cwd = cwd || ''
    this.branch = ''
    this.shellName = ''
    this.cols = 100
    this.rows = 30
    this.altBlock = null
    this.rawBlock = null // running block the user opened in interactive mode
    // The shell's own prompt (PS1), rendered by xterm while the shell is idle.
    this.promptTerm = new Terminal({ cols: 100, rows: 8, scrollback: 0, allowProposedApi: true })
    this.promptSerializer = new BufferSerializer(this.promptTerm)
    this.promptVersion = 0
    this._promptHtml = ''
    this._promptHtmlVersion = -1
    this.version = 0
    this.listeners = new Set()
    this.pending = '' // incomplete escape sequence carried between chunks
    this.submittedBuffer = ''
    this.queue = []
    this.waiters = [] // resolve callbacks for runAndWait, in submission order
    this._scheduled = false
    this.agent = new Agent(this)
    this.mode = 'shell' // shell | agent

    this.offData = window.eterm.pty.onData((id, data) => id === this.id && this._onData(data))
    this.offExit = window.eterm.pty.onExit((id) => {
      if (id !== this.id) return
      this.state = 'exited'
      this._finishCurrent(-1)
      this._emit()
    })
  }

  async start(cols, rows) {
    this.cols = cols
    this.rows = rows
    this.promptTerm.resize(cols, 8)
    const info = await window.eterm.pty.create({ id: this.id, cols, rows, cwd: this.cwd })
    this.shellName = info.shell
    this.bracketedPaste = info.bracketedPaste !== false
    setHome(info.home)
    if (!this.cwd) this.cwd = info.cwd
    this._emit()
  }

  // ---- subscription (for useSyncExternalStore) ----
  subscribe = (fn) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = () => this.version

  _emit() {
    if (this._scheduled) return
    this._scheduled = true
    // Timer instead of requestAnimationFrame: rAF stalls while the window is
    // covered, and a terminal must keep its state current in the background.
    setTimeout(() => {
      this._scheduled = false
      this.version++
      for (const fn of this.listeners) fn()
    }, 16)
  }

  // The running command block, if any (agent turns are skipped).
  get current() {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i]
      if (b.kind === 'command') return b.running ? b : null
    }
    return null
  }

  get busy() {
    return this.state !== 'idle'
  }

  add(entry) {
    this.blocks.push(entry)
    this._emit()
  }

  get title() {
    const running = this.current
    if (running) return running.command.split(/\s+/)[0]
    const parts = this.cwd.split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : '/'
  }

  get promptHtml() {
    if (this._promptHtmlVersion !== this.promptVersion) {
      this._promptHtml = this.promptSerializer.toHtml().replace(/^\n+/, '')
      this._promptHtmlVersion = this.promptVersion
    }
    return this._promptHtml
  }

  // Interactive mode: show a running command in a full terminal with raw keys.
  setInteractive(block) {
    this.rawBlock = block && block.running ? block : null
    this._emit()
  }

  // ---- input ----
  run(command) {
    const trimmed = command.trim()
    if (!trimmed) return
    history.add(trimmed)

    if (this.state === 'starting') {
      this.queue.push(command)
      return
    }
    if (trimmed === 'clear' || trimmed === 'cls') {
      this.clear()
      return
    }
    if (this.state !== 'idle') return null

    const block = new Block({
      command: trimmed,
      cwd: this.cwd,
      branch: this.branch,
      cols: this.cols,
      rows: this.rows
    })
    block.term.buffer.onBufferChange((buf) => {
      this.altBlock = buf.type === 'alternate' ? block : null
      this._emit()
    })
    this.blocks.push(block)
    this.state = 'submitted'
    this.submittedBuffer = ''
    // Bracketed paste keeps multi-line commands intact; PowerShell gets one line.
    const payload = this.bracketedPaste ? `\x1b[200~${command}\x1b[201~` : command.replace(/\r?\n/g, '; ')
    window.eterm.pty.write(this.id, `${payload}\r`)
    // Programs that read single keys work better in a real terminal view.
    if (/^(p10k configure|ssh|mosh|telnet)\b/.test(trimmed)) this.rawBlock = block
    this._emit()
    return block
  }

  // Runs a command as a normal block and resolves with that block once the
  // shell reports it finished. Used by Agent Mode.
  async runAndWait(command) {
    while (this.state === 'starting' || this.state === 'submitted' || this.state === 'running') {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (this.state === 'exited') throw new Error('The shell has exited.')
    const block = this.run(command)
    if (!block) throw new Error('Could not start the command.')
    return new Promise((resolve) => this.waiters.push({ block, resolve }))
  }

  // Sends raw input to the running process (stdin answers, Ctrl-C, ...).
  write(data) {
    window.eterm.pty.write(this.id, data)
  }

  interrupt() {
    this.write('\x03')
  }

  // Local help card rendered as an agent turn (no AI call).
  showHelp() {
    const turn = new AgentTurn({ prompt: '/help' })
    turn.provider = null
    turn.status = 'done'
    turn.text = HELP_TEXT
    this.add(turn)
  }

  rerun(block) {
    this.run(block.command)
  }

  clear() {
    const keep = this.current
    for (const b of this.blocks) if (b !== keep) b.dispose?.()
    this.agent.reset()
    this.blocks = keep ? [keep] : []
    this._emit()
  }

  resize(cols, rows) {
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    window.eterm.pty.resize(this.id, cols, rows)
    this.promptTerm.resize(cols, 8)
    const cur = this.current
    if (cur && cur !== this.altBlock && cur !== this.rawBlock) cur.resize(cols, rows)
    this._emit()
  }

  dispose() {
    this.offData()
    this.offExit()
    window.eterm.pty.kill(this.id)
    this.agent.stop()
    for (const b of this.blocks) b.dispose?.()
    this.promptTerm.dispose()
  }

  // ---- output parsing ----
  _onData(chunk) {
    let data = this.pending + chunk
    this.pending = ''
    let i = 0
    while (i < data.length) {
      const at = data.indexOf(OSC_PREFIX, i)
      if (at === -1) {
        // Keep a possible partial prefix at the tail for the next chunk.
        const tail = data.lastIndexOf('\x1b')
        if (tail !== -1 && tail >= data.length - OSC_PREFIX.length && OSC_PREFIX.startsWith(data.slice(tail))) {
          this._text(data.slice(i, tail))
          this.pending = data.slice(tail)
        } else {
          this._text(data.slice(i))
        }
        break
      }
      this._text(data.slice(i, at))
      const bel = data.indexOf('\x07', at)
      const st = data.indexOf('\x1b\\', at)
      let end = bel
      let termLen = 1
      if (st !== -1 && (bel === -1 || st < bel)) {
        end = st
        termLen = 2
      }
      if (end === -1) {
        this.pending = data.slice(at)
        break
      }
      this._marker(data.slice(at + OSC_PREFIX.length, end))
      i = end + termLen
    }
    this._emit()
  }

  _text(text) {
    if (!text) return
    if (this.state === 'running') {
      const block = this.current
      if (block) block.term.write(text, () => {
        block.version++
        this._emit()
      })
    } else if (this.state === 'submitted') {
      this.submittedBuffer += text
    } else if (this.state === 'idle') {
      this.promptTerm.write(text, () => {
        this.promptVersion++
        this._emit()
      })
    }
    // Text while idle/starting is the shell's own prompt and line echo: hidden.
  }

  _marker(payload) {
    const kind = payload[0]
    const value = payload.slice(2)
    if (kind === 'C') {
      if (this.state === 'submitted') this.state = 'running'
    } else if (kind === 'D') {
      const code = parseInt(value, 10) || 0
      if (this.state === 'submitted') {
        // Shell rejected the line before running anything (e.g. parse error).
        const block = this.current
        if (block) {
          const lines = this.submittedBuffer.split(/\r?\n/).slice(1).join('\r\n')
          block.term.write(lines, () => {
            block.version++
            this._emit()
          })
        }
      }
      this._finishCurrent(code)
      // A fresh prompt follows every D marker.
      this.promptTerm.reset()
      this.promptVersion++
      const wasStarting = this.state === 'starting'
      this.state = 'idle'
      if (wasStarting && this.queue.length) {
        const q = this.queue
        this.queue = []
        q.forEach((c) => this.run(c))
      }
    } else if (kind === 'P') {
      this.cwd = value
    } else if (kind === 'G') {
      this.branch = value
    }
  }

  _finishCurrent(code) {
    const block = this.current
    if (!block) return
    block.exitCode = code
    block.endedAt = Date.now()
    block.version++
    if (this.altBlock === block) this.altBlock = null
    if (this.rawBlock === block) this.rawBlock = null
    // Let xterm finish parsing queued output before handing the block over.
    block.term.write('', () => {
      const i = this.waiters.findIndex((w) => w.block === block)
      if (i !== -1) this.waiters.splice(i, 1)[0].resolve(block)
    })
  }
}
