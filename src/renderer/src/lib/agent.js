import { newBlockId } from './session.js'
import { aiConfig } from './aiConfig.js'

const MAX_STEPS = 15
const MAX_OUTPUT = 8000
const MAX_MCP_OUTPUT = 12000
const MAX_MCP_PREVIEW = 4000
const DECLINED = 'The user declined to run this command.'

// brewcat availability, resolved once per app run and reused by every prompt.
let brewcatStatus = null
function brewcatInstalled() {
  if (!brewcatStatus) {
    brewcatStatus = Promise.resolve()
      .then(() => window.eterm.brewcat?.status())
      .then((s) => !!s?.installed)
      .catch(() => false)
  }
  return brewcatStatus
}
// Start the check early so the first prompt usually doesn't wait for it.
if (typeof window !== 'undefined' && window.eterm) brewcatInstalled()

// Read-only commands that may run without asking when "auto-run safe" is on.
const SAFE = /^(ls|pwd|cat|head|tail|wc|grep|rg|find|fd|tree|file|stat|which|type|whoami|date|uname|df|du|ps|echo|printf|sort|uniq|cut|jq|node|python3?|npm|pnpm|yarn|cargo|go|brew|git)\b/
const SAFE_SUBCOMMANDS = {
  git: /^git\s+(status|log|diff|show|branch|remote|rev-parse|ls-files|blame|describe|tag\s*$)/,
  node: /^node\s+(-v|--version)\s*$/,
  python: /^python3?\s+(-V|--version)\s*$/,
  python3: /^python3?\s+(-V|--version)\s*$/,
  npm: /^npm\s+(ls|list|view|outdated|-v|--version|run\s*$)/,
  pnpm: /^pnpm\s+(ls|list|-v|--version)/,
  yarn: /^yarn\s+(list|info|-v|--version)/,
  cargo: /^cargo\s+(--version|tree|metadata)/,
  go: /^go\s+(version|env|list)/,
  brew: /^brew\s+(list|info|search|--version)/,
  find: /^find\b(?!.*\s-(delete|exec|execdir|ok)\b)/
}

export function isSafeCommand(cmd) {
  if (/[;&`]|\$\(|>|\n/.test(cmd)) return false
  return cmd.split('|').every((part) => {
    const seg = part.trim()
    const word = seg.split(/\s+/)[0]
    if (!SAFE.test(seg)) return false
    const sub = SAFE_SUBCOMMANDS[word]
    return sub ? sub.test(seg) : true
  })
}

// One assistant turn, rendered in the block list next to command blocks.
export class AgentTurn {
  constructor({ prompt }) {
    this.id = newBlockId()
    this.kind = 'agent'
    this.prompt = prompt || ''
    this.text = ''
    this.status = 'thinking' // thinking | streaming | done | error | stopped
    this.error = ''
    this.provider = aiConfig.activeProvider()
    // command: { id, command, reason, status, blockId, exitCode, auto, resolve }
    // mcp:     { id, kind: 'mcp', name, server, tool, args, status, result, auto, resolve }
    this.toolCalls = []
    this.collapsed = false
    this.version = 0
    this.startedAt = Date.now()
  }
  get running() {
    return false
  }
  get command() {
    return this.prompt
  }
}

function isMcpCall(call) {
  return !!call.mcp || (typeof call.name === 'string' && call.name.startsWith('mcp__'))
}

function truncate(text) {
  if (text.length <= MAX_OUTPUT) return text
  return `[… ${text.length - MAX_OUTPUT} earlier characters omitted …]\n` + text.slice(-MAX_OUTPUT)
}

let nextRequest = 1

export class Agent {
  constructor(session) {
    this.session = session
    this.messages = []
    this.busy = false
    this.requestId = null
    this.turn = null
    this.stopped = false
  }

  reset() {
    this.stop()
    this.messages = []
  }

  stop() {
    this.stopped = true
    if (this.requestId) window.eterm.ai.abort(this.requestId)
    const t = this.turn
    if (t) {
      for (const tc of t.toolCalls) if (tc.status === 'pending') tc.resolve?.(false)
      if (t.status === 'thinking' || t.status === 'streaming') t.status = 'stopped'
      t.version++
    }
    this.session._emit()
  }

  get pending() {
    return this.turn?.toolCalls.find((tc) => tc.status === 'pending') || null
  }

  // command is an optional edited command string (command cards only; ignored for MCP).
  approve(tc, command) {
    if (command && tc.kind !== 'mcp') tc.command = command
    tc.resolve?.(true)
  }

  reject(tc) {
    tc.resolve?.(false)
  }

  async ask(prompt) {
    if (this.busy) return
    this.busy = true
    this.stopped = false
    this.messages.push({ role: 'user', content: prompt })
    let turn = this._newTurn(prompt)
    try {
      this.brewcat = await brewcatInstalled()
      for (let step = 0; step < MAX_STEPS && !this.stopped; step++) {
        const msg = await this._complete(turn)
        if (!msg) break
        this.messages.push({ role: 'assistant', ...msg })
        if (!msg.toolCalls?.length) break

        for (const call of msg.toolCalls) {
          const result = await this._runTool(turn, call)
          this.messages.push({ role: 'tool', toolCallId: call.id, content: result.content, isError: result.isError })
        }
        if (this.stopped) break
        turn = this._newTurn('')
      }
    } finally {
      this.busy = false
      this.requestId = null
      this.session._emit()
    }
  }

  _newTurn(prompt) {
    const turn = new AgentTurn({ prompt })
    this.turn = turn
    this.session.add(turn)
    return turn
  }

  _systemPrompt() {
    const s = this.session
    const recent = s.blocks
      .filter((b) => b.kind === 'command' && !b.running)
      .slice(-5)
      .map((b) => `$ ${b.command}\n(exit ${b.exitCode})\n${truncate(b.text).slice(-1500)}`)
      .join('\n\n')
    return [
      'You are the 117Terminal Agent, an AI assistant built into a terminal app on the user\'s own machine.',
      'Help the user get things done: answer questions and use the run_command tool to inspect and change their system.',
      'Work in small, safe steps. Before each command, say in one short sentence what you are doing.',
      'The user approves every command, so never ask for permission in text — just call the tool.',
      'Never run interactive or full-screen programs (vim, less, top, ssh sessions) or commands that do not exit.',
      'Prefer non-destructive commands; for anything destructive explain the risk in the reason.',
      'When finished, reply with a short summary. Use Markdown; put commands in ```bash blocks.',
      'MCP tools (named mcp__<server>__<tool>) may also be available; like commands, they need the user\'s approval before they run.',
      this.brewcat
        ? 'brewcat is installed: to find and install developer tools use run_command with `brewcat search <query> --json`, `brewcat kits --json` and `brewcat install "<name>" --yes`.'
        : null,
      "Reply in the same language the user writes in.",
      '',
      `OS: ${navigator.platform}. Shell: ${s.shellName || 'unknown'}. Working directory: ${s.cwd}.` +
        (s.branch ? ` Git branch: ${s.branch}.` : ''),
      recent ? `\nRecent terminal activity:\n${recent}` : ''
    ]
      .filter((line) => line !== null)
      .join('\n')
  }

  _complete(turn) {
    const requestId = `r${nextRequest++}`
    this.requestId = requestId
    return new Promise((resolve) => {
      const off = window.eterm.ai.onEvent((id, evt) => {
        if (id !== requestId) return
        if (evt.type === 'text') {
          turn.status = 'streaming'
          turn.text += evt.text
        } else if (evt.type === 'done') {
          off()
          turn.status = 'done'
          resolve(evt.message)
        } else if (evt.type === 'error') {
          off()
          turn.status = this.stopped ? 'stopped' : 'error'
          turn.error = evt.error
          resolve(null)
        }
        turn.version++
        this.session._emit()
      })
      window.eterm.ai.chat({ requestId, system: this._systemPrompt(), messages: this.messages })
    })
  }

  // Adds tc to the turn and waits for the user (or auto-approval). Returns true to run.
  async _approval(turn, tc, auto) {
    turn.toolCalls.push(tc)
    turn.version++
    this.session._emit()

    let approved
    if (auto) {
      approved = true
      tc.auto = true
    } else {
      approved = await new Promise((resolve) => (tc.resolve = resolve))
    }
    tc.resolve = null
    if (!approved || this.stopped) {
      tc.status = 'rejected'
      turn.version++
      this.session._emit()
      return false
    }
    tc.status = 'running'
    turn.version++
    this.session._emit()
    return true
  }

  async _runMcpTool(turn, call) {
    // Fall back to parsing mcp__<server>__<tool> when the backend sent no mcp info.
    const [, server = '', ...rest] = call.name.split('__')
    const tc = {
      id: call.id,
      kind: 'mcp',
      name: call.name,
      server: call.mcp?.server || server,
      tool: call.mcp?.tool || rest.join('__'),
      args: call.args || {},
      status: 'pending',
      result: null
    }
    if (!(await this._approval(turn, tc, !!call.mcp?.trusted))) return { content: DECLINED, isError: true }

    try {
      const res = await window.eterm.mcp.call(call.name, tc.args)
      const content = String(res?.content ?? '')
      tc.status = res?.ok ? 'done' : 'error'
      tc.result = content.length > MAX_MCP_PREVIEW ? content.slice(0, MAX_MCP_PREVIEW) + '\n…' : content
      turn.version++
      this.session._emit()
      const out =
        content.length > MAX_MCP_OUTPUT
          ? content.slice(0, MAX_MCP_OUTPUT) + `\n[… ${content.length - MAX_MCP_OUTPUT} more characters omitted …]`
          : content
      return { content: out || '(no output)', isError: !res?.ok }
    } catch (err) {
      tc.status = 'error'
      tc.result = String(err.message || err)
      turn.version++
      this.session._emit()
      return { content: tc.result, isError: true }
    }
  }

  async _runTool(turn, call) {
    if (isMcpCall(call)) return this._runMcpTool(turn, call)
    const command = typeof call.args?.command === 'string' ? call.args.command.trim() : ''
    if (call.name !== 'run_command' || !command) {
      return { content: `Invalid tool call: expected run_command with a "command" string.`, isError: true }
    }
    const tc = { id: call.id, command, reason: call.args.reason || '', status: 'pending', blockId: null, exitCode: null }
    const auto = aiConfig.get().autoRunSafe && isSafeCommand(command)
    if (!(await this._approval(turn, tc, auto))) return { content: DECLINED, isError: true }

    try {
      const block = await this.session.runAndWait(tc.command)
      tc.status = 'done'
      tc.blockId = block.id
      tc.exitCode = block.exitCode
      turn.version++
      this.session._emit()
      const out = truncate(block.text)
      return { content: `exit code: ${block.exitCode}\n${out || '(no output)'}`, isError: block.exitCode !== 0 }
    } catch (err) {
      tc.status = 'error'
      turn.version++
      return { content: String(err.message || err), isError: true }
    }
  }
}
