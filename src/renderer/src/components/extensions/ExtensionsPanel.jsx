import { useEffect, useState } from 'react'
import ZshTab from './ZshTab.jsx'
import PromptTab from './PromptTab.jsx'
import McpTab from './McpTab.jsx'
import BrewcatTab from './BrewcatTab.jsx'
import './extensions.css'

const TABS = [
  { id: 'zsh', icon: '⚡', label: 'Zsh plugins', hint: 'Autosuggestions, highlighting, tools' },
  { id: 'prompt', icon: '❯', label: 'Prompt theme', hint: 'Powerlevel10k, Starship, Pure…' },
  { id: 'mcp', icon: '⛁', label: 'MCP servers', hint: 'Tools for the agent' },
  { id: 'brewcat', icon: '🍺', label: 'brewcat', hint: 'Homebrew catalog & kits' }
]

export default function ExtensionsPanel({ initialTab = 'zsh', onClose, onRunInTerminal, showPrompt, onShowPromptChange }) {
  const [tab, setTab] = useState(() => (TABS.some((t) => t.id === initialTab) ? initialTab : 'zsh'))

  // Follow the caller when it reopens the panel on another tab.
  useEffect(() => {
    if (TABS.some((t) => t.id === initialTab)) setTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = (cmd) => onRunInTerminal?.(cmd)

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-panel ext-panel">
        <div className="settings-side">
          <div className="settings-title">✦ Extensions</div>
          {TABS.map((t) => (
            <button key={t.id} className={`prov ext-nav ${t.id === tab ? 'sel' : ''}`} onClick={() => setTab(t.id)}>
              <span className="ext-nav-icon">{t.icon}</span>
              <span className="ext-nav-text">
                <b>{t.label}</b>
                <small>{t.hint}</small>
              </span>
            </button>
          ))}
          <div className="ext-side-foot">
            Changes to zsh apply to new tabs <kbd>⌘T</kbd>
          </div>
        </div>
        <div className="settings-main ext-main">
          {tab === 'zsh' && <ZshTab onRunInTerminal={run} />}
          {tab === 'prompt' && (
            <PromptTab onRunInTerminal={run} showPrompt={showPrompt} onShowPromptChange={onShowPromptChange} />
          )}
          {tab === 'mcp' && <McpTab />}
          {tab === 'brewcat' && <BrewcatTab onRunInTerminal={run} />}
          <button className="settings-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
