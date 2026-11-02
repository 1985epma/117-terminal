import { useEffect, useState } from 'react'
import ZshTab from '../extensions/ZshTab.jsx'
import PromptTab from '../extensions/PromptTab.jsx'
import McpTab from '../extensions/McpTab.jsx'
import BrewcatTab from '../extensions/BrewcatTab.jsx'
import VoiceTab from '../extensions/VoiceTab.jsx'
import ThemeSection from './ThemeSection.jsx'
import AgentSection from './AgentSection.jsx'
import WebSection from './WebSection.jsx'
import '../extensions/extensions.css'
import './settings.css'

// One place for every preference. Menus, shortcuts and slash commands open it
// on a section: settings:<section>.
export const SECTIONS = [
  { group: 'App' },
  { id: 'general', icon: '⚙', label: 'General', hint: 'Text size, prompt, about' },
  { id: 'appearance', icon: '◐', label: 'Appearance', hint: 'Themes, transparency, blur' },
  { group: 'AI' },
  { id: 'agent', icon: '✦', label: 'AI Agent', hint: 'Providers, keys, models' },
  { id: 'voice', icon: '🎙', label: 'Voice', hint: 'Talk, it types · EN · PT · ES' },
  { id: 'mcp', icon: '⛁', label: 'MCP servers', hint: 'Tools for the agent' },
  { group: 'Shell' },
  { id: 'shell', icon: '⚡', label: 'Zsh & Prompt', hint: 'Plugins, Powerlevel10k, Starship' },
  { id: 'integrations', icon: '🍺', label: 'Integrations', hint: 'brewcat, Spotify, Apple Music' },
  { id: 'web', icon: '◎', label: 'Web & HarmonyOS', hint: 'Use it from any browser' },
  { group: 'Help' },
  { id: 'shortcuts', icon: '⌘', label: 'Shortcuts', hint: 'Every keyboard shortcut' }
]

// Older ids (menus, slash commands, saved habits) → section[/sub-tab].
const ALIASES = { zsh: 'shell', prompt: 'shell/prompt', brewcat: 'integrations', themes: 'appearance' }

export function resolveSection(id) {
  const [section, sub] = (ALIASES[id] || id || 'general').split('/')
  return { section: SECTIONS.some((s) => s.id === section) ? section : 'general', sub }
}

function General({ settings, setSettings, defaultFont }) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    window.eterm.info().then(setInfo)
  }, [])
  const font = (n) => setSettings((s) => ({ ...s, fontSize: Math.min(24, Math.max(9, n)) }))
  return (
    <div className="set-section">
      <h2>General</h2>
      <div className="set-row">
        <div>
          <b>Text size</b>
          <small>Also ⌘= / ⌘- / ⌘0</small>
        </div>
        <div className="set-stepper">
          <button onClick={() => font(settings.fontSize - 1)}>−</button>
          <span>{settings.fontSize}px</span>
          <button onClick={() => font(settings.fontSize + 1)}>+</button>
          <button className="link" onClick={() => font(defaultFont)}>
            Reset
          </button>
        </div>
      </div>
      <label className="set-row">
        <div>
          <b>Show my zsh prompt (PS1)</b>
          <small>Draw your Powerlevel10k/Starship prompt above each command</small>
        </div>
        <input
          type="checkbox"
          checked={settings.showPrompt}
          onChange={(e) => setSettings((s) => ({ ...s, showPrompt: e.target.checked }))}
        />
      </label>
      <div className="set-about">
        <div className="set-about-name">117Terminal</div>
        <div>
          Version {info?.version || '…'} · {info?.platform === 'darwin' ? 'macOS' : info?.platform}
          {window.eterm.platform === 'web' && ' · web mode'}
        </div>
        <div className="set-links">
          <button className="link" onClick={() => window.eterm.openExternal('https://github.com/1985epma/117-terminal')}>
            GitHub
          </button>
          <button className="link" onClick={() => window.eterm.openExternal('https://github.com/1985epma/117-terminal/blob/main/CHANGELOG.md')}>
            Changelog
          </button>
          <button className="link" onClick={() => window.eterm.openExternal('https://github.com/1985epma/117-terminal/issues')}>
            Report an issue
          </button>
        </div>
      </div>
    </div>
  )
}

function Shell({ sub, run, settings, setSettings }) {
  const [tab, setTab] = useState(sub === 'prompt' ? 'prompt' : 'zsh')
  useEffect(() => setTab(sub === 'prompt' ? 'prompt' : 'zsh'), [sub])
  return (
    <>
      <div className="set-subtabs">
        <button className={tab === 'zsh' ? 'sel' : ''} onClick={() => setTab('zsh')}>
          Zsh plugins
        </button>
        <button className={tab === 'prompt' ? 'sel' : ''} onClick={() => setTab('prompt')}>
          Prompt theme
        </button>
      </div>
      {tab === 'zsh' ? (
        <ZshTab onRunInTerminal={run} />
      ) : (
        <PromptTab
          onRunInTerminal={run}
          showPrompt={settings.showPrompt}
          onShowPromptChange={(on) => setSettings((s) => ({ ...s, showPrompt: on }))}
        />
      )}
    </>
  )
}

function Integrations({ run, onOpenMusic }) {
  return (
    <>
      <div className="set-section set-music">
        <h2>Music</h2>
        <p className="set-hint">Control Spotify and Apple Music from the tab bar, the Music menu or /music.</p>
        <div className="set-buttons">
          <button onClick={() => onOpenMusic('spotify')}>Spotify player…</button>
          <button onClick={() => onOpenMusic('music')}>Apple Music player…</button>
        </div>
      </div>
      <BrewcatTab onRunInTerminal={run} />
    </>
  )
}

function Shortcuts({ actions }) {
  const list = actions.filter((a) => a.hint && !a.id.startsWith('theme:') && a.hint !== 'active' && !a.hint.startsWith('/'))
  const web = window.eterm.platform === 'web'
  return (
    <div className="set-section">
      <h2>Keyboard shortcuts</h2>
      {web && <p className="set-hint">In a browser, ⌘T/⌘W belong to the browser: tabs use ⌥T and ⌥W.</p>}
      <div className="set-keys">
        {list.map((a) => (
          <div key={a.id} className="set-key">
            <span>{a.label}</span>
            <kbd>{a.hint}</kbd>
          </div>
        ))}
        <div className="set-key">
          <span>Jump to tab 1–9</span>
          <kbd>⌘1…9</kbd>
        </div>
      </div>
      <h2 className="set-sub">Slash commands</h2>
      <p className="set-hint">
        Type <code>/</code> in the input: /agent, /shell, /model, /voice, /theme, /music, /plugins, /prompt, /mcp, /brewcat,
        /settings, /clear, /help.
      </p>
    </div>
  )
}

export default function SettingsPanel({
  initial = 'general',
  onClose,
  onRunInTerminal,
  onOpenMusic,
  settings,
  setSettings,
  defaultFont,
  blur,
  onBlur,
  actions
}) {
  const [{ section, sub }, setNav] = useState(() => resolveSection(initial))

  // Follow the caller when it reopens the panel on another section.
  useEffect(() => setNav(resolveSection(initial)), [initial])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = (cmd) => onRunInTerminal?.(cmd)

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-panel ext-panel set-panel">
        <nav className="settings-side">
          <div className="settings-title">Settings</div>
          {SECTIONS.map((s) =>
            s.group ? (
              <div key={s.group} className="set-group">
                {s.group}
              </div>
            ) : (
              <button
                key={s.id}
                className={`prov ext-nav ${s.id === section ? 'sel' : ''}`}
                onClick={() => setNav({ section: s.id })}
              >
                <span className="ext-nav-icon">{s.icon}</span>
                <span className="ext-nav-text">
                  <b>{s.label}</b>
                  <small>{s.hint}</small>
                </span>
              </button>
            )
          )}
          <div className="ext-side-foot">
            Open anytime with <kbd>⌘,</kbd>
          </div>
        </nav>
        <div className="settings-main ext-main">
          {section === 'general' && <General settings={settings} setSettings={setSettings} defaultFont={defaultFont} />}
          {section === 'appearance' && (
            <div className="set-section">
              <h2>Appearance</h2>
              <ThemeSection
                current={settings.theme}
                onPick={(theme) => setSettings((s) => ({ ...s, theme }))}
                opacity={settings.opacity}
                onOpacity={(opacity) => setSettings((s) => ({ ...s, opacity }))}
                blur={blur}
                onBlur={onBlur}
                showBlur={window.eterm.platform !== 'web'}
              />
            </div>
          )}
          {section === 'agent' && <AgentSection />}
          {section === 'voice' && <VoiceTab onRunInTerminal={run} />}
          {section === 'mcp' && <McpTab />}
          {section === 'shell' && <Shell sub={sub} run={run} settings={settings} setSettings={setSettings} />}
          {section === 'integrations' && <Integrations run={run} onOpenMusic={onOpenMusic} />}
          {section === 'web' && <WebSection />}
          {section === 'shortcuts' && <Shortcuts actions={actions} />}
          <button className="settings-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
