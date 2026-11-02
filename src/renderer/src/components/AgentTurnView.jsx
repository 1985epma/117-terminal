import { memo, useState } from 'react'
import Markdown from './Markdown.jsx'
import { Highlighted } from '../lib/highlight.jsx'
import './agent-tools.css'

const ARGS_PREVIEW_LINES = 8

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
          <button onClick={() => agent.reject(tc)}>
            Skip <kbd>esc</kbd>
          </button>
        </div>
      )}
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
          <button onClick={() => agent.reject(tc)}>
            Skip <kbd>esc</kbd>
          </button>
        </div>
      )}
    </div>
  )
}

function AgentTurnView({ turn, session, onInsert }) {
  const agent = session.agent
  const pending = agent.pending
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
          {turn.status === 'error' && <div className="agent-error">⚠ {turn.error}</div>}
          {turn.status === 'stopped' && <div className="agent-stopped">Stopped.</div>}
        </div>
      </div>
    </div>
  )
}

export default memo(AgentTurnView, (a, b) => a.turn === b.turn && a.version === b.version && a.busy === b.busy)
