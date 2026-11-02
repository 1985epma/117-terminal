import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { xtermTheme } from '../lib/themes.js'

// Full-screen apps (vim, less, htop…) switch to the alternate buffer.
// We then mount the block's own xterm instance and hand it the keyboard.
export default function AltScreen({ block, session, theme, fontSize, opacity = 1, interactive, onExit }) {
  const hostRef = useRef(null)

  useEffect(() => {
    const term = block.term
    term.options.allowTransparency = opacity < 1
    term.options.theme = xtermTheme(theme, opacity)
    term.options.fontSize = fontSize
    term.options.fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim()
    term.options.cursorBlink = true

    if (!block.fit) {
      block.fit = new FitAddon()
      term.loadAddon(block.fit)
    }
    if (term.element) hostRef.current.appendChild(term.element)
    else term.open(hostRef.current)

    const fit = () => {
      try {
        block.fit.fit()
        window.eterm.pty.resize(session.id, term.cols, term.rows)
      } catch {
        /* not visible yet */
      }
    }
    fit()
    term.focus()
    const ro = new ResizeObserver(fit)
    ro.observe(hostRef.current)
    const sub = term.onData((d) => session.write(d))

    return () => {
      ro.disconnect()
      sub.dispose()
      block.resize(session.cols, session.rows)
      window.eterm.pty.resize(session.id, session.cols, session.rows)
      onExit?.()
    }
  }, [block, session]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    block.term.options.allowTransparency = opacity < 1
    block.term.options.theme = xtermTheme(theme, opacity)
    block.term.options.fontSize = fontSize
  }, [block, theme, fontSize, opacity])

  return (
    <div className="alt-screen">
      <div className="alt-bar">
        <span className="chip chip-running">
          <span className="meta-spinner" /> {block.command}
        </span>
        <span className="alt-hint">
          {interactive ? 'interactive mode' : 'full-screen app'} · keys go straight to the process
          {interactive && (
            <button className="alt-exit" onClick={() => session.setInteractive(null)}>
              Back to blocks
            </button>
          )}
        </span>
      </div>
      <div className="alt-host" ref={hostRef} />
    </div>
  )
}
