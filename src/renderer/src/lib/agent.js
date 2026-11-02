import { newBlockId } from './session.js'
import { aiConfig } from './aiConfig.js'
import { isSafeCommand, readsOutsideCwd } from './safe-command.js'
import { systemPrompt, contextMessage } from './agent-prompt.js'

export { isSafeCommand, touchesSensitivePath, readsOutsideCwd } from './safe-command.js'

const MAX_STEPS = 15
const MAX_OUTPUT = 8000
const MAX_MCP_OUTPUT = 12000
const MAX_MCP_PREVIEW = 4000
const DECLINED = 'The user declined to run this command.'
// Above this many prompt tokens, older tool output is replaced by a placeholder.
const CONTEXT_TRIM_TOKENS = 120000
const KEEP_RECENT_MESSAGES = 6
const TRIM_NOTICE = 'Older command output was trimmed to fit the context window.'
const TOKEN_LIMIT_ERROR = 'Stopped: this task reached the token limit set in Settings › AI Agent.'

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

function declined(tc) {
  return tc.declineReason ? `${DECLINED} Their reason: ${tc.declineReason}` : DECLINED
}

const usageTotal = (u) => (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0)

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
    this.taskUsage = null
    this.contextTokens = 0
    this.readOutsideCwd = false
  }

  reset() {
    this.stop()
    this.messages = []
    this.contextTokens = 0
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

  reject(tc, reason) {
    tc.declineReason = typeof reason === 'string' ? reason.trim() : ''
    tc.resolve?.(false)
  }

  async ask(prompt) {
    if (this.busy) return
    this.busy = true
    this.stopped = false
    this.taskUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    this.readOutsideCwd = false
    // Context goes in the message, not the system prompt, so the system prompt stays cacheable.
    this.messages.push({ role: 'user', content: this._contextMessage() + '\n\n' + prompt })
    let turn = this._newTurn(prompt)
    try {
      this.brewcat = await brewcatInstalled()
      for (let step = 0; step < MAX_STEPS && !this.stopped; step++) {
        const res = await this._complete(turn)
        if (!res) break
        const { usage, ...msg } = res
        this.messages.push({ role: 'assistant', ...msg })
        const overLimit = this._trackUsage(turn, usage)
        // A final answer (no tool calls) finishes normally even past the limit.
        if (overLimit && msg.toolCalls?.length) {
          // Keep the history valid: every tool call needs a result.
          for (const call of msg.toolCalls || []) {
            this.messages.push({ role: 'tool', toolCallId: call.id, content: 'Not run: the task reached its token limit.', isError: true })
          }
          turn.status = 'error'
          turn.error = TOKEN_LIMIT_ERROR
          turn.version++
          break
        }
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

  // Adds one response's usage to the task total; trims old output when the context is large.
  // Returns true when the per-task token cap is exceeded.
  _trackUsage(turn, usage) {
    if (usage) {
      const t = this.taskUsage
      for (const k of Object.keys(t)) t[k] += usage[k] || 0
      this.contextTokens = (usage.input || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0)
    }
    turn.usage = usage || null
    turn.taskUsage = { ...this.taskUsage }
    if (this.contextTokens > CONTEXT_TRIM_TOKENS && this._trimHistory()) turn.notice = TRIM_NOTICE
    turn.version++
    this.session._emit()
    const limit = Number(aiConfig.get().maxTaskTokens) || 0
    return limit > 0 && usageTotal(this.taskUsage) > limit
  }

  // Shortens tool results older than the last few messages; message structure is unchanged.
  _trimHistory() {
    let trimmed = false
    const end = this.messages.length - KEEP_RECENT_MESSAGES
    for (let i = 0; i < end; i++) {
      const m = this.messages[i]
      if (m.role !== 'tool' || typeof m.content !== 'string' || m.content.length < 200) continue
      this.messages[i] = { ...m, content: `[output removed to save context: ${m.content.length} chars]` }
      trimmed = true
    }
    return trimmed
  }

  _newTurn(prompt) {
    const turn = new AgentTurn({ prompt })
    if (this.taskUsage) turn.taskUsage = { ...this.taskUsage }
    this.turn = turn
    this.session.add(turn)
    return turn
  }

  _systemPrompt() {
    return systemPrompt({ brewcat: !!this.brewcat })
  }

  _contextMessage() {
    const s = this.session
    const recent = s.blocks
      .filter((b) => b.kind === 'command' && !b.running)
      .slice(-5)
      .map((b) => `$ ${b.command}\n(exit ${b.exitCode})\n${truncate(b.text).slice(-1500)}`)
      .join('\n\n')
    const os = typeof navigator !== 'undefined' ? navigator.platform : ''
    return contextMessage({ os, shell: s.shellName, cwd: s.cwd, branch: s.branch, recent })
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
    // After an auto-run read outside the cwd (maybe a secret), a tool could send it out: ask first.
    const auto = !!call.mcp?.trusted && !this.readOutsideCwd
    if (!(await this._approval(turn, tc, auto))) return { content: declined(tc), isError: true }

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
    if (!(await this._approval(turn, tc, auto))) return { content: declined(tc), isError: true }
    if (tc.auto && readsOutsideCwd(tc.command)) this.readOutsideCwd = true

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
