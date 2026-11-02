import { memo, useEffect, useState } from 'react'
import { Highlighted } from '../lib/highlight.jsx'
import { prettyPath, formatDuration } from '../lib/paths.js'

function useTicker(enabled) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => set((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [enabled])
}

function BlockView({ block, selected, onSelect, onRerun, onToggle, onInteractive }) {
  const running = block.running
  useTicker(running)
  const [copied, setCopied] = useState('')
  const failed = !running && block.exitCode !== 0
  const html = block.collapsed ? '' : block.html
  const elapsed = (block.endedAt || Date.now()) - block.startedAt

  const copy = (what) => {
    window.eterm.clipboard.write(what === 'cmd' ? block.command : block.text)
    setCopied(what)
    setTimeout(() => setCopied(''), 1200)
  }

  return (
    <div
      id={`block-${block.id}`}
      className={`block ${running ? 'running' : ''} ${failed ? 'failed' : ''} ${selected ? 'selected' : ''}`}
      onClick={(e) => {
        if (!window.getSelection()?.toString() && !e.target.closest('button')) onSelect()
      }}
    >
      <div className="block-head">
        <div className="block-meta">
          <span className="meta-path">{prettyPath(block.cwd)}</span>
          {block.branch && <span className="meta-branch">⎇ {block.branch}</span>}
          <span className="meta-time">{formatDuration(elapsed)}</span>
          {!running && (
            <span className={`meta-status ${failed ? 'bad' : 'good'}`}>
              {failed ? `✕ exit ${block.exitCode}` : '✓'}
            </span>
          )}
          {running && <span className="meta-spinner" />}
        </div>
        <div className="block-actions">
          <button onClick={() => copy('cmd')} title="Copy command">
            {copied === 'cmd' ? 'Copied' : 'Copy cmd'}
          </button>
          <button onClick={() => copy('out')} title="Copy output">
            {copied === 'out' ? 'Copied' : 'Copy output'}
          </button>
          {running && (
            <button onClick={onInteractive} title="Open in a full terminal; keys go straight to the process">
              ⤢ Interactive
            </button>
          )}
          {!running && (
            <button onClick={onRerun} title="Run again">
              ↻ Rerun
            </button>
          )}
          <button onClick={onToggle} title={block.collapsed ? 'Expand' : 'Collapse'}>
            {block.collapsed ? '▸' : '▾'}
          </button>
        </div>
      </div>
      <div className="block-cmd mono">
        <span className="prompt-glyph">❯</span>
        <span className="cmd-text">
          <Highlighted text={block.command} />
        </span>
      </div>
      {html && <pre className="block-out mono" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}

export default memo(
  BlockView,
  (a, b) => a.block === b.block && a.version === b.version && a.selected === b.selected
)
