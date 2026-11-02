import { useSyncExternalStore } from 'react'
import { voice } from '../../lib/voice.js'
import './voice.css'

const LANGS = ['auto', 'en-US', 'pt-BR', 'es']
const LABEL = { auto: 'Auto', 'en-US': 'EN', 'pt-BR': 'PT', es: 'ES' }

export function MicIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

// Top-right mic: click to talk (⌘⇧Space), the chip beside it cycles the language.
export default function MicButton({ onToggle }) {
  const s = useSyncExternalStore(voice.subscribe, voice.get)
  const lang = voice.settings().lang
  const listening = s.phase === 'listening'
  const working = s.phase === 'transcribing' || s.phase === 'thinking'

  return (
    <div className={`mic ${s.phase}`}>
      <button
        className="mic-btn"
        onClick={onToggle}
        title={listening ? 'Stop and type it (⌘⇧Space)' : 'Voice command (⌘⇧Space)'}
        aria-label="Voice command"
        style={listening ? { '--lvl': Math.min(1, s.level * 9) } : undefined}
      >
        {working ? <span className="meta-spinner" /> : <MicIcon />}
      </button>
      <button
        className="mic-lang"
        onClick={() => voice.setSettings({ lang: LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length] })}
        title="Voice language: Auto · English (US) · Português (BR) · Español"
      >
        {LABEL[lang] || 'Auto'}
      </button>
    </div>
  )
}
