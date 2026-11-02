import { memo, useState } from 'react'
import Markdown from './Markdown.jsx'
import { Highlighted } from '../lib/highlight.jsx'
import { isLocalProvider, dataDestination } from '../lib/aiConfig.js'
import './agent-tools.css'

const ARGS_PREVIEW_LINES = 8

// 1234 -> "1.2k", 18000 -> "18k", 2500000 -> "2.5M"
function fmtTokens(n) {
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  if (n < 1e6) return Math.round(n / 1000) + 'k'
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
}

// "1.2k in · 340 out · 18k cached", or '' when there is nothing to show.
function usageText(u) {
  if (!u) return ''
  const parts = []
  if (u.input > 0) parts.push(`${fmtTokens(u.input)} in`)
  if (u.output > 0) parts.push(`${fmtTokens(u.output)} out`)
  if (u.cacheRead > 0) parts.push(`${fmtTokens(u.cacheRead)} cached`)
  if (u.cacheWrite > 0) parts.push(`${fmtTokens(u.cacheWrite)} cache write`)
  return parts.join(' · ')
}

function rejectReason(tc) {
  return tc.rejectReason || tc.declineReason || ''
}

// Skip / Decline-with-reason controls for a pending card.
function DeclineControls({ tc, agent }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  const decline = (text) => {
    const why = (text || '').trim()
    if (why && !tc.rejectReason) tc.rejectReason = why
    agent.reject(tc, why || undefined)
  }

  if (!open) {
    return (
      <>
        <button onClick={() => decline('')}>
          Skip <kbd>esc</kbd>
        </button>
        <button onClick={() => setOpen(true)} title="Tell the agent why you are declining">
          Decline…
        </button>
      </>
    )
  }
  return (
    <span className="decline-form">
      <input
        className="decline-input"
        value={reason}
        autoFocus
        spellCheck={false}
        placeholder="Why? (optional, sent to the agent)"
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            decline(reason)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            decline('')
          }
        }}
      />
      <button onClick={() => decline(reason)}>
        Decline <kbd>↵</kbd>
      </button>
    </span>
  )
}

function DeclinedNote({ tc }) {
  const why = rejectReason(tc)
  if (tc.status !== 'rejected' || !why) return null
  return <div className="tool-declined">Declined: {why}</div>
}

function statusLabel(tc, labels) {
  return (tc.auto && tc.status !== 'pending' ? 'auto-approved · ' : '') + labels[tc.status]
}

// Approval card for an MCP server tool: server › tool, JSON args, result preview.
function McpToolCard({ tc, agent, isPending }) {
  const [expanded, setExpanded] = useState(false)
  const json = JSON.stringify(tc.args ?? {}, null, 2)
  const lines = json.split('\n')
  const long = lines.length > ARGS_PREVIEW_LINES
  const shown = long && !expanded ? lines.slice(0, ARGS_PREVIEW_LINES).join('\n') + '\n…' : json

  const labels = {
    pending: 'Waiting for your approval',
    running: 'Running…',
    done: 'Done',
    rejected: 'Skipped',
    error: 'Failed'
  }

  return (
    <div className={`tool-card mcp-card status-${tc.status}`}>
      <div className="tool-card-head">
        <span className="tool-icon">{tc.status === 'running' ? <span className="meta-spinner" /> : '⌁'}</span>
        <span className="mcp-badge">MCP</span>
        <span className="tool-reason mcp-name">
          {tc.server} <span className="mcp-sep">›</span> {tc.tool}
        </span>
        <span className="tool-status">{statusLabel(tc, labels)}</span>
      </div>
      <pre className="tool-cmd mcp-args mono">{shown}</pre>
      {long && (
        <button className="mcp-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'show less' : `show more (${lines.length - ARGS_PREVIEW_LINES} lines)`}
        </button>
      )}
      {(tc.status === 'done' || tc.status === 'error') && tc.result != null && (
        <pre className={`mcp-result mono ${tc.status === 'error' ? 'error' : ''}`}>{tc.result || '(no output)'}</pre>
      )}
      {isPending && (
        <div className="tool-actions">
          <button className="primary" onClick={() => agent.approve(tc)}>
            Run <kbd>⌘↵</kbd>
          </button>
          <DeclineControls tc={tc} agent={agent} />
        </div>
      )}
      <DeclinedNote tc={tc} />
    </div>
  )
}

function ToolCallCard({ tc, agent, isPending }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tc.command)

  const labels = {
    pending: 'Waiting for your approval',
    running: 'Running…',
    done: tc.exitCode === 0 ? 'Done' : `Exited with ${tc.exitCode}`,
    rejected: 'Skipped',
    error: 'Failed'
  }

  return (
    <div className={`tool-card status-${tc.status} ${tc.status === 'done' && tc.exitCode !== 0 ? 'bad' : ''}`}>
      <div className="tool-card-head">
        <span className="tool-icon">{tc.status === 'running' ? <span className="meta-spinner" /> : '⌘'}</span>
        <span className="tool-reason">{tc.reason || 'Run command'}</span>
        <span className="tool-status">
          {tc.auto && tc.status !== 'pending' ? 'auto-approved · ' : ''}
          {labels[tc.status]}
        </span>
      </div>
      {editing ? (
        <textarea
          className="tool-edit mono"
          value={draft}
          autoFocus
          spellCheck={false}
          rows={Math.min(8, draft.split('\n').length)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || !e.shiftKey)) {
              e.preventDefault()
              agent.approve(tc, draft)
            } else if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <pre className="tool-cmd mono">
          <span className="prompt-glyph">❯</span> <Highlighted text={tc.command} />
        </pre>
      )}
      {isPending && (
        <div className="tool-actions">
          <button className="primary" onClick={() => agent.approve(tc, editing ? draft : undefined)}>
            Run <kbd>⌘↵</kbd>
          </button>
          {!editing && (
            <button onClick={() => setEditing(true)}>
              Edit <kbd>⌘E</kbd>
            </button>
          )}
          <DeclineControls tc={tc} agent={agent} />
        </div>
      )}
      <DeclinedNote tc={tc} />
    </div>
  )
}

// A task spans this turn and the continuation turns (prompt '') after it.
function isLastOfTask(turn, session, busy) {
  if (busy && session.agent.turn === turn) return false
  const blocks = session.blocks || []
  for (let j = blocks.indexOf(turn) + 1; j > 0 && j < blocks.length; j++) {
    if (blocks[j].kind === 'agent') return blocks[j].prompt !== ''
  }
  return true
}

function AgentTurnView({ turn, session, onInsert, busy }) {
  const agent = session.agent
  const pending = agent.pending
  const finished = turn.status === 'done' || turn.status === 'error' || turn.status === 'stopped'
  const stepUsage = finished ? usageText(turn.usage) : ''
  const taskUsage = finished && turn.taskUsage && isLastOfTask(turn, session, busy) ? usageText(turn.taskUsage) : ''
  const local = isLocalProvider(turn.provider)
  return (
    <div id={`block-${turn.id}`} className={`agent-turn status-${turn.status}`}>
      {turn.prompt && (
        <div className="agent-prompt">
          <span className="agent-you">You</span>
          <span className="agent-prompt-text">{turn.prompt}</span>
        </div>
      )}
      <div className="agent-body">
        <div className="agent-avatar">✦</div>
        <div className="agent-content">
          <div className="agent-meta">
            <span>Agent</span>
            {turn.provider && (
              <span className="agent-model">
                {turn.provider.label} · {turn.provider.model}
              </span>
            )}
            {turn.provider && (
              <span className={`agent-where ${local ? 'local' : 'cloud'}`} title={dataDestination(turn.provider)}>
                {local ? 'local' : `cloud · ${turn.provider.label}`}
              </span>
            )}
            {(turn.status === 'thinking' || turn.status === 'streaming') && <span className="meta-spinner" />}
          </div>
          {turn.status === 'thinking' && !turn.text && <div className="agent-thinking">Thinking…</div>}
          {turn.text && (
            <Markdown text={turn.text} onInsert={onInsert} onRun={agent.busy ? null : (cmd) => session.run(cmd)} />
          )}
          {turn.toolCalls.map((tc) =>
            tc.kind === 'mcp' ? (
              <McpToolCard key={tc.id} tc={tc} agent={agent} isPending={pending === tc} />
            ) : (
              <ToolCallCard key={tc.id} tc={tc} agent={agent} isPending={pending === tc} />
            )
          )}
          {turn.notice && <div className="agent-notice">ⓘ {turn.notice}</div>}
          {turn.status === 'error' && <div className="agent-error">⚠ {turn.error}</div>}
          {turn.status === 'stopped' && <div className="agent-stopped">Stopped.</div>}
          {(stepUsage || taskUsage) && (
            <div className="agent-usage" title="Tokens reported by the provider">
              {stepUsage && <span>{stepUsage}</span>}
              {taskUsage && <span className="agent-usage-total">task total: {taskUsage}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(AgentTurnView, (a, b) => a.turn === b.turn && a.version === b.version && a.busy === b.busy)
