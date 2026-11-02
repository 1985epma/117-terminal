import iconUrl from '../assets/icon.svg'

// Compact 117Terminal mark for small sizes: prompt chevron + the 117-Labs
// 3x3 dot mark on a dark tile (the full window artwork is too busy below ~48px).
export function BrandMark({ size = 20 }) {
  return (
    <svg className="brand-mark-svg" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8" fill="#0a0c11" stroke="#262a33" strokeWidth="1.5" />
      <path d="M6.5 11.5 L10 16 L6.5 20.5" fill="none" stroke="#5ee0ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <g fill="#8fa3d6">
        {[12.5, 18.25, 24].map((x) =>
          [10.25, 16, 21.75].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.75" />)
        )}
      </g>
    </svg>
  )
}

// Full app icon (terminal window with the 117-Labs mark).
export function AppIcon({ size = 72 }) {
  return <img className="app-icon" src={iconUrl} width={size} height={size} alt="117Terminal" />
}

// Name set in the 117-Labs design system type: Space Grotesk + mono seal.
export function Wordmark({ seal = true }) {
  return (
    <span className="wordmark">
      <span className="wordmark-name">117Terminal</span>
      {seal && <span className="wordmark-seal">by 117-Labs</span>}
    </span>
  )
}
