import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Session } from './lib/session.js'
import { themes, applyTheme, DEFAULT_THEME } from './lib/themes.js'
import TabBar from './components/TabBar.jsx'
import TerminalView from './components/TerminalView.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import HistorySearch from './components/HistorySearch.jsx'
import SettingsPanel from './components/settings/SettingsPanel.jsx'
import MusicPanel from './components/music/MusicPanel.jsx'
import { music } from './lib/music.js'
import { voice } from './lib/voice.js'
import { aiConfig } from './lib/aiConfig.js'
import VoiceHUD from './components/voice/VoiceHUD.jsx'

const DEFAULT_FONT = 13

function loadSettings() {
  try {
    const saved = { theme: DEFAULT_THEME, fontSize: DEFAULT_FONT, opacity: 1, showPrompt: false, ...JSON.parse(localStorage.getItem('eterm:settings') || '{}') }
    if (!themes[saved.theme]) saved.theme = DEFAULT_THEME
    return saved
  } catch {
    return { theme: DEFAULT_THEME, fontSize: DEFAULT_FONT, opacity: 1, showPrompt: false }
  }
}

export default function App() {
  const [sessions, setSessions] = useState(() => [new Session()])
  const [activeId, setActiveId] = useState(() => sessions[0].id)
  const [settings, setSettings] = useState(loadSettings)
  const [overlay, setOverlay] = useState(null) // 'palette' | 'history' | 'settings:<section>' | 'music[:source]' | null
  const [blur, setBlur] = useState(true)
  const [, force] = useState(0)
  const views = useRef(new Map()) // session id -> TerminalView imperative api

  const active = sessions.find((s) => s.id === activeId) || sessions[0]
  window.__eterm = { sessions, active } // handy for DevTools debugging

  useEffect(() => {
    applyTheme(settings.theme, settings.fontSize, settings.opacity)
    try {
      localStorage.setItem('eterm:settings', JSON.stringify(settings))
    } catch {
      /* storage unavailable */
    }
  }, [settings])

  // Re-render tab titles when any session changes.
  useEffect(() => {
    const offs = sessions.map((s) => s.subscribe(() => force((n) => n + 1)))
    return () => offs.forEach((off) => off())
  }, [sessions])

  useEffect(() => {
    window.eterm.window.prefs().then((p) => setBlur(p.blur))
  }, [])

  // Runs a command from a panel as a visible block in the active tab.
  const runInTerminal = (cmd) => {
    setOverlay(null)
    active.mode = 'shell'
    active.runAndWait(cmd).catch(() => {})
    focusInput()
  }

  // Voice: speech → (smart) shell command or agent prompt, typed into the editor for review.
  const activeRef = useRef(active)
  activeRef.current = active
  const handleVoiceText = async (text) => {
    const s = activeRef.current
    const view = views.current.get(s.id)
    const put = (v) => {
      view?.setInput(v)
      view?.focus()
    }
    const { mode } = voice.settings()
    // Agent mode, a running program, or plain dictation: type what was said.
    if (s.mode === 'agent' || s.current || mode === 'dictate') return put(text)
    if (!aiConfig.isReady()) {
      voice.showHint('Typed as dictated. Connect an AI provider (⌘,) to turn speech into commands.')
      return put(text)
    }
    voice.setPhase('thinking')
    const r = await window.eterm.voice.toCommand(text, { shell: s.shellName, cwd: s.cwd })
    voice.setPhase('idle')
    if (!r.ok) {
      voice.setPhase('error', r.error)
      return put(text)
    }
    if (r.command === 'AGENT') {
      s.mode = 'agent'
      s._emit()
      voice.showHint(`🗣 “${text}” → needs several steps, sent to Agent Mode (↵ to ask)`)
      return put(text)
    }
    voice.showHint(`🗣 “${text}” → ${r.command}`)
    put(r.command)
  }

  // Controls whichever player is active (Spotify if nothing is).
  const musicCommand = (action) => music.control(music.active()?.id || 'spotify', action)

  const newTab = useCallback(() => {
    const s = new Session({ cwd: active?.cwd })
    setSessions((prev) => [...prev, s])
    setActiveId(s.id)
  }, [active])

  const closeTab = useCallback(
    (id = activeId) => {
      const idx = sessions.findIndex((s) => s.id === id)
      if (idx === -1) return
      sessions[idx].dispose()
      let next = sessions.filter((s) => s.id !== id)
      if (next.length === 0) next = [new Session()]
      setSessions(next)
      if (!next.some((s) => s.id === activeId)) setActiveId(next[Math.min(idx, next.length - 1)].id)
    },
    [sessions, activeId]
  )

  const cycleTab = useCallback(
    (dir) => {
      const idx = sessions.findIndex((s) => s.id === activeId)
      const next = sessions[(idx + dir + sessions.length) % sessions.length]
      setActiveId(next.id)
    },
    [sessions, activeId]
  )

  const setFont = (fn) => setSettings((s) => ({ ...s, fontSize: Math.min(24, Math.max(9, fn(s.fontSize))) }))

  const focusInput = () => setTimeout(() => views.current.get(activeId)?.focus(), 0)

  const actions = useMemo(
    () => [
      { id: 'newTab', label: 'New Tab', hint: '⌘T', run: newTab },
      { id: 'closeTab', label: 'Close Tab', hint: '⌘W', run: () => closeTab() },
      { id: 'nextTab', label: 'Next Tab', hint: '⌘⇧]', run: () => cycleTab(1) },
      { id: 'prevTab', label: 'Previous Tab', hint: '⌘⇧[', run: () => cycleTab(-1) },
      { id: 'clear', label: 'Clear Blocks', hint: '⌘K', run: () => active.clear() },
      { id: 'history', label: 'Search Command History', hint: '⌃R', run: () => setOverlay('history') },
      {
        id: 'agentMode',
        label: 'Toggle Agent Mode',
        hint: '⌘I',
        run: () => {
          active.mode = active.mode === 'agent' ? 'shell' : 'agent'
          active._emit()
        }
      },
      {
        id: 'agentReset',
        label: 'New Agent Conversation',
        hint: '⌘⇧I',
        run: () => {
          active.agent.reset()
          active.mode = 'agent'
          active._emit()
        }
      },
      { id: 'settings', label: 'Settings…', hint: '⌘,', run: () => setOverlay('settings:general') },
      { id: 'settings:agent', label: 'Settings: AI Agent (providers, keys, models)', run: () => setOverlay('settings:agent') },
      { id: 'interrupt', label: 'Interrupt Running Command', hint: '⌃C', run: () => active.interrupt() },
      { id: 'settings:appearance', label: 'Settings: Themes & Transparency', hint: '⌥⌘T', run: () => setOverlay('settings:appearance') },
      { id: 'voice', label: 'Voice Command (talk, it types)', hint: '⌘⇧Space', run: () => voice.toggle(handleVoiceText) },
      { id: 'settings:voice', label: 'Settings: Voice (engine, language, mode)', hint: '/voice', run: () => setOverlay('settings:voice') },
      { id: 'music', label: 'Music: Spotify & Apple Music…', hint: '⌥⌘M', run: () => setOverlay('music') },
      { id: 'music:playpause', label: 'Music: Play / Pause', hint: '⌥⌘P', run: () => musicCommand('playpause') },
      { id: 'music:next', label: 'Music: Next Track', hint: '⌥⌘→', run: () => musicCommand('next') },
      { id: 'music:previous', label: 'Music: Previous Track', hint: '⌥⌘←', run: () => musicCommand('previous') },
      { id: 'settings:shell', label: 'Settings: Zsh Plugins', hint: '⌘⇧X', run: () => setOverlay('settings:shell') },
      { id: 'settings:prompt', label: 'Settings: Prompt (Powerlevel10k, Starship…)', hint: '/prompt', run: () => setOverlay('settings:prompt') },
      { id: 'settings:mcp', label: 'Settings: MCP Servers', hint: '/mcp', run: () => setOverlay('settings:mcp') },
      { id: 'settings:integrations', label: 'Settings: Integrations (brewcat, music)', hint: '/brewcat', run: () => setOverlay('settings:integrations') },
      { id: 'settings:web', label: 'Settings: Web Mode & HarmonyOS', run: () => setOverlay('settings:web') },
      { id: 'settings:shortcuts', label: 'Settings: Keyboard Shortcuts', run: () => setOverlay('settings:shortcuts') },
      {
        id: 'togglePrompt',
        label: settings.showPrompt ? 'Hide My Zsh Prompt (PS1)' : 'Show My Zsh Prompt (PS1)',
        run: () => setSettings((s) => ({ ...s, showPrompt: !s.showPrompt }))
      },
      { id: 'fontUp', label: 'Bigger Text', hint: '⌘=', run: () => setFont((f) => f + 1) },
      { id: 'fontDown', label: 'Smaller Text', hint: '⌘-', run: () => setFont((f) => f - 1) },
      { id: 'fontReset', label: 'Reset Text Size', hint: '⌘0', run: () => setFont(() => DEFAULT_FONT) },
      ...Object.entries(themes).map(([key, t]) => ({
        id: `theme:${key}`,
        label: `Theme: ${t.name}`,
        hint: settings.theme === key ? 'active' : '',
        run: () => setSettings((s) => ({ ...s, theme: key }))
      }))
    ],
    [newTab, closeTab, cycleTab, active, settings.theme, settings.showPrompt]
  )

  const runAction = useCallback(
    (id) => {
      if (id === 'palette') return setOverlay((o) => (o === 'palette' ? null : 'palette'))
      // Older ids from menus and slash commands now open a Settings section.
      const legacy = { agentSettings: 'settings:agent', themes: 'settings:appearance', extensions: 'settings:shell' }[id]
      if (legacy || id.startsWith('extensions:')) return setOverlay(legacy || id.replace('extensions:', 'settings:'))
      if (id.startsWith('settings:') || id === 'settings') return setOverlay(id === 'settings' ? 'settings:general' : id)
      if (id.startsWith('music-panel:')) return setOverlay(id.replace('music-panel:', 'music:'))
      if (id.startsWith('openDir:')) {
        // A folder from Finder, the Dock or `117terminal <dir>`: open it in a new tab.
        const s = new Session({ cwd: id.slice('openDir:'.length) })
        setSessions((prev) => [...prev, s])
        setActiveId(s.id)
        return
      }
      if (id.startsWith('runCmd:')) {
        // `117terminal run "<command>"`: a new tab in the caller's folder, running it.
        const { cwd, command } = JSON.parse(id.slice('runCmd:'.length))
        const s = new Session({ cwd })
        setSessions((prev) => [...prev, s])
        setActiveId(s.id)
        s.mode = 'shell'
        s.run(command)
        return
      }
      const a = actions.find((x) => x.id === id)
      if (!a) return
      a.run()
      if (!['history', 'music', 'voice'].includes(id)) focusInput()
    },
    [actions] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const runActionRef = useRef(runAction)
  runActionRef.current = runAction
  useEffect(() => window.eterm.onMenu((id) => runActionRef.current(id)), [])
  // In-app triggers (e.g. slash commands) use the same action ids as the menu.
  useEffect(() => {
    const on = (e) => runActionRef.current(e.detail)
    window.addEventListener('eterm-action', on)
    return () => window.removeEventListener('eterm-action', on)
  }, [])

  // Esc cancels a recording.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && voice.get().phase === 'listening') {
        e.preventDefault()
        e.stopPropagation()
        voice.cancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Cmd+1..9 jumps to tab.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey && /^[1-9]$/.test(e.key)) {
        const s = sessions[Number(e.key) - 1]
        if (s) {
          e.preventDefault()
          setActiveId(s.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sessions])

  useEffect(() => {
    focusInput()
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <TabBar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={newTab}
        onPalette={() => setOverlay('palette')}
        onMusic={() => setOverlay('music')}
        onVoice={() => runActionRef.current('voice')}
      />
      <VoiceHUD onOpenSettings={() => setOverlay('settings:voice')} />
      <div className="views">
        {sessions.map((s) => (
          <TerminalView
            key={s.id}
            session={s}
            active={s.id === activeId}
            theme={settings.theme}
            fontSize={settings.fontSize}
            opacity={settings.opacity}
            showPrompt={settings.showPrompt}
            ref={(api) => (api ? views.current.set(s.id, api) : views.current.delete(s.id))}
            onOpenHistory={() => setOverlay('history')}
            onOpenSettings={() => setOverlay('settings:agent')}
          />
        ))}
      </div>

      {overlay === 'palette' && (
        <CommandPalette
          actions={actions}
          onClose={() => {
            setOverlay(null)
            focusInput()
          }}
          onRun={(id) => {
            setOverlay(null)
            runAction(id)
          }}
        />
      )}
      {overlay?.startsWith('settings:') && (
        <SettingsPanel
          initial={overlay.slice('settings:'.length)}
          onClose={() => {
            setOverlay(null)
            focusInput()
          }}
          onRunInTerminal={runInTerminal}
          onOpenMusic={(source) => setOverlay(`music:${source}`)}
          settings={settings}
          setSettings={setSettings}
          defaultFont={DEFAULT_FONT}
          blur={blur}
          onBlur={async (on) => setBlur((await window.eterm.window.blur(on)).blur)}
          actions={actions}
        />
      )}
      {(overlay === 'music' || overlay?.startsWith('music:')) && (
        <MusicPanel
          initialSource={overlay.split(':')[1]}
          onClose={() => {
            setOverlay(null)
            focusInput()
          }}
          onRunInTerminal={runInTerminal}
        />
      )}
      {overlay === 'history' && (
        <HistorySearch
          onClose={() => {
            setOverlay(null)
            focusInput()
          }}
          onPick={(cmd, runNow) => {
            setOverlay(null)
            const view = views.current.get(activeId)
            if (runNow) active.run(cmd)
            else view?.setInput(cmd)
            focusInput()
          }}
        />
      )}
    </div>
  )
}
