import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import BlockView from './BlockView.jsx'
import InputEditor from './InputEditor.jsx'
import AltScreen from './AltScreen.jsx'
import AgentTurnView from './AgentTurnView.jsx'
import { AppIcon, Wordmark } from './Logo.jsx'

const BLOCK_PAD_X = 44 // horizontal padding + borders of a block body, in px

export default function TerminalView({ session, active, theme, fontSize, opacity, showPrompt, ref, onOpenHistory, onOpenSettings }) {
  useSyncExternalStore(session.subscribe, session.getVersion)
  const scrollRef = useRef(null)
  const measureRef = useRef(null)
  const inputRef = useRef(null)
  const stick = useRef(true)
  const started = useRef(false)
  const [selectedId, setSelectedId] = useState(null)

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setInput: (v) => inputRef.current?.setValue(v)
  }))

  const measure = useCallback(() => {
    const el = scrollRef.current
    const m = measureRef.current
    if (!el || !m || el.clientWidth === 0) return
    const rect = m.getBoundingClientRect()
    const charW = rect.width / 20
    const lineH = rect.height
    const cols = Math.max(20, Math.floor((el.clientWidth - BLOCK_PAD_X) / charW))
    const rows = Math.max(8, Math.floor(el.clientHeight / lineH) - 2)
    if (!started.current) {
      started.current = true
      session.start(cols, rows)
    } else {
      session.resize(cols, rows)
    }
  }, [session])

  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(scrollRef.current)
    return () => ro.disconnect()
  }, [measure, fontSize, active])

  // Keep pinned to the bottom unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  const onScroll = () => {
    const el = scrollRef.current
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const blocks = session.blocks
  const selectBy = (dir) => {
    if (!blocks.length) return
    const idx = blocks.findIndex((b) => b.id === selectedId)
    const next = idx === -1 ? (dir < 0 ? blocks.length - 1 : 0) : Math.min(blocks.length - 1, Math.max(0, idx + dir))
    setSelectedId(blocks[next].id)
    document.getElementById(`block-${blocks[next].id}`)?.scrollIntoView({ block: 'nearest' })
  }

  useEffect(() => {
    if (!active) return
    const onKey = (e) => {
      if (session.altBlock || session.rawBlock) return
      const pending = session.agent.pending
      if (pending && e.metaKey && e.key === 'Enter') {
        e.preventDefault()
        return session.agent.approve(pending)
      }
      if (e.metaKey && e.key === 'ArrowUp') {
        e.preventDefault()
        selectBy(-1)
      } else if (e.metaKey && e.key === 'ArrowDown') {
        e.preventDefault()
        selectBy(1)
      } else if (e.key === 'Escape' && selectedId) {
        setSelectedId(null)
      } else if (e.metaKey && e.key === 'c' && selectedId && !window.getSelection()?.toString()) {
        const b = blocks.find((x) => x.id === selectedId)
        if (b) {
          e.preventDefault()
          window.eterm.clipboard.write(b.text)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const running = session.current

  return (
    <div className={`terminal-view ${active ? 'active' : ''}`}>
      <span ref={measureRef} className="measure mono" aria-hidden>
        MMMMMMMMMMMMMMMMMMMM
      </span>

      <div className="blocks" ref={scrollRef} onScroll={onScroll}>
        {blocks.length === 0 && <Welcome shell={session.shellName} starting={session.state === 'starting'} />}
        {blocks.map((b) =>
          b.kind === 'agent' ? (
            <AgentTurnView
              key={b.id}
              turn={b}
              version={b.version}
              busy={session.agent.busy}
              session={session}
              onInsert={(cmd) => {
                session.mode = 'shell'
                inputRef.current?.setValue(cmd)
                inputRef.current?.focus()
              }}
            />
          ) : (
          <BlockView
            key={b.id}
            block={b}
            version={b.version}
            selected={b.id === selectedId}
            onSelect={() => setSelectedId(b.id === selectedId ? null : b.id)}
            onInteractive={() => session.setInteractive(b)}
            onRerun={() => {
              session.rerun(b)
              stick.current = true
            }}
            onToggle={() => {
              b.collapsed = !b.collapsed
              b.version++
              session._emit()
            }}
          />
          )
        )}
      </div>

      <InputEditor
        ref={inputRef}
        session={session}
        running={running}
        onSubmit={(cmd) => {
          stick.current = true
          setSelectedId(null)
          session.run(cmd)
        }}
        onOpenHistory={onOpenHistory}
        onOpenSettings={onOpenSettings}
        showPrompt={showPrompt}
      />

      {(session.altBlock || session.rawBlock) && (
        <AltScreen
          key={(session.altBlock || session.rawBlock).id}
          block={session.altBlock || session.rawBlock}
          interactive={!session.altBlock}
          opacity={opacity}
          session={session}
          theme={theme}
          fontSize={fontSize}
          onExit={() => inputRef.current?.focus()}
        />
      )}
    </div>
  )
}

function Welcome({ shell, starting }) {
  return (
    <div className="welcome">
      <div className="welcome-logo">
        <AppIcon size={88} />
        <div>
          <h1>
            <Wordmark />
          </h1>
          <p>{starting ? 'Starting shell…' : `${shell || 'shell'} is ready.`}</p>
        </div>
      </div>
      <div className="tips">
        <Tip k="Enter" d="Run the command — each one becomes a block" />
        <Tip k="⇧ Enter" d="New line in the editor" />
        <Tip k="→" d="Accept the grey suggestion from history" />
        <Tip k="Tab" d="Complete files, folders and commands" />
        <Tip k="⌃R" d="Search your command history" />
        <Tip k="⌘P" d="Command palette: tabs, themes, actions" />
        <Tip k="⌘↑ ⌘↓" d="Select blocks, ⌘C copies the output" />
        <Tip k="⌘K" d="Clear all blocks" />
        <Tip k="⌘I" d="Agent Mode: ask AI to do it for you" />
        <Tip k="⌘," d="Connect Claude, GPT, Gemini, Grok, Ollama…" />
      </div>
    </div>
  )
}

function Tip({ k, d }) {
  return (
    <div className="tip">
      <kbd>{k}</kbd>
      <span>{d}</span>
    </div>
  )
}
