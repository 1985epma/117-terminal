import { useSyncExternalStore } from 'react'
import { voice } from '../../lib/voice.js'
import { MicIcon } from './MicButton.jsx'
import './voice.css'

const LANG_NAME = { auto: 'auto-detect', 'en-US': 'English (US)', 'pt-BR': 'Português (BR)', es: 'Español' }

// Floating status above the editor while voice is active, plus the last result.
export default function VoiceHUD({ onOpenSettings }) {
  const s = useSyncExternalStore(voice.subscribe, voice.get)
  const lang = voice.settings().lang
  if (s.phase === 'idle' && !s.hint) return null

  const bars = [0.6, 1, 0.75, 0.9, 0.55]
  return (
    <div className={`voice-hud ${s.phase}`} role="status">
      {s.phase === 'listening' && (
        <>
          <span className="vh-mic">
            <MicIcon size={14} />
          </span>
          <span className="vh-bars" aria-hidden>
            {bars.map((b, i) => (
              <i key={i} style={{ height: `${4 + Math.min(1, s.level * 10) * 18 * b}px` }} />
            ))}
          </span>
          <span>
            Listening · {LANG_NAME[lang]} · <kbd>⌘⇧Space</kbd> stop · <kbd>esc</kbd> cancel
          </span>
        </>
      )}
      {s.phase === 'transcribing' && (
        <>
          <span className="meta-spinner" /> Transcribing…
        </>
      )}
      {s.phase === 'thinking' && (
        <>
          <span className="meta-spinner" /> Turning it into a command…
        </>
      )}
      {s.phase === 'error' && (
        <>
          <span className="vh-err">⚠ {s.message}</span>
          <button onClick={onOpenSettings}>Voice settings</button>
          <button onClick={() => voice.setPhase('idle')}>×</button>
        </>
      )}
      {s.phase === 'idle' && s.hint && <span className="vh-hint">{s.hint}</span>}
    </div>
  )
}
