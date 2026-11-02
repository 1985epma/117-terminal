// UI tokens + the 16 ANSI colors for each theme.
export const DEFAULT_THEME = 'ninja'

export const themes = {
  ninja: {
    name: 'Black Ninja Dark',
    description: 'Pure #000 black, crimson accents. The darkest it gets.',
    ui: {
      bg: '#000000',
      panel: '#000000',
      raised: '#0a0a0a',
      border: '#1c1c1c',
      fg: '#d6d6d6',
      muted: '#6e6e6e',
      accent: '#ff2e4d',
      accent2: '#b98cff',
      ok: '#3ddc84',
      err: '#ff4d5e',
      warn: '#ffb020',
      selection: 'rgba(255,46,77,.30)'
    },
    ansi: [
      '#000000', '#ff4d5e', '#3ddc84', '#ffb020', '#5c9dff', '#c77dff', '#2ee6d6', '#c7c7c7',
      '#4a4a4a', '#ff7a86', '#6ff0a8', '#ffd060', '#8dbaff', '#dcaaff', '#7ff2e8', '#ffffff'
    ]
  },
  midnight: {
    name: 'Midnight',
    description: 'Deep navy with soft blue accents.',
    ui: {
      bg: '#0d0f14',
      panel: '#141821',
      raised: '#1b2030',
      border: '#252b3b',
      fg: '#d7dceb',
      muted: '#7d869c',
      accent: '#7c9cff',
      accent2: '#c792ea',
      ok: '#4fd18b',
      err: '#ff6b7f',
      warn: '#f5c26b',
      selection: 'rgba(124,156,255,.28)'
    },
    ansi: [
      '#1b2030', '#ff6b7f', '#4fd18b', '#f5c26b', '#7c9cff', '#c792ea', '#5ccfe6', '#c9d1e3',
      '#4a5370', '#ff8fa0', '#7ee2a8', '#ffd68f', '#a3b9ff', '#dcb0f2', '#8ae0f0', '#ffffff'
    ]
  },
  aurora: {
    name: 'Aurora',
    description: 'Teal-green northern lights.',
    ui: {
      bg: '#0b1215',
      panel: '#101b1f',
      raised: '#16252a',
      border: '#1f3238',
      fg: '#d3e7e4',
      muted: '#6f8c8a',
      accent: '#2ee6a6',
      accent2: '#58b5ff',
      ok: '#2ee6a6',
      err: '#ff6f61',
      warn: '#ffc857',
      selection: 'rgba(46,230,166,.22)'
    },
    ansi: [
      '#16252a', '#ff6f61', '#2ee6a6', '#ffc857', '#58b5ff', '#c38fff', '#4fe0e0', '#c8dbd8',
      '#3d5a60', '#ff958a', '#71f0c3', '#ffd987', '#8ccbff', '#d8b5ff', '#86eded', '#ffffff'
    ]
  },
  ember: {
    name: 'Ember',
    description: 'Warm charcoal and orange.',
    ui: {
      bg: '#141010',
      panel: '#1c1615',
      raised: '#261d1b',
      border: '#372a26',
      fg: '#ecdcd3',
      muted: '#9a8279',
      accent: '#ff8a4c',
      accent2: '#ffcf5c',
      ok: '#a6d96a',
      err: '#ff5c5c',
      warn: '#ffcf5c',
      selection: 'rgba(255,138,76,.25)'
    },
    ansi: [
      '#261d1b', '#ff5c5c', '#a6d96a', '#ffcf5c', '#6fa8ff', '#e08cff', '#5fd7c8', '#dccbc2',
      '#5a4640', '#ff8585', '#c2ea8f', '#ffe08f', '#9cc4ff', '#ecb3ff', '#8fe7dc', '#ffffff'
    ]
  },
  daylight: {
    name: 'Daylight',
    description: 'Bright light theme for sunny rooms.',
    ui: {
      bg: '#f7f8fb',
      panel: '#eef0f5',
      raised: '#ffffff',
      border: '#dde1ea',
      fg: '#1f2433',
      muted: '#6b7386',
      accent: '#3b63f3',
      accent2: '#9b4dca',
      ok: '#1f9d55',
      err: '#d6334a',
      warn: '#b7791f',
      selection: 'rgba(59,99,243,.18)'
    },
    ansi: [
      '#1f2433', '#d6334a', '#1f9d55', '#b7791f', '#3b63f3', '#9b4dca', '#0f8b9c', '#8a93a6',
      '#525a6e', '#e85a6e', '#2fb46a', '#cf9633', '#5c80ff', '#b46ee0', '#22a5b8', '#b4bccb'
    ]
  }
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

// opacity < 1 lets the desktop (or the blur behind the window) show through.
export function applyTheme(key, fontSize, opacity = 1) {
  const t = themes[key] || themes[DEFAULT_THEME]
  const root = document.documentElement.style
  for (const [k, v] of Object.entries(t.ui)) root.setProperty(`--${k}`, v)
  root.setProperty('--bg', withAlpha(t.ui.bg, opacity))
  root.setProperty('--panel', withAlpha(t.ui.panel, Math.min(1, opacity + 0.08)))
  // Menus and dialogs stay opaque so they remain readable.
  root.setProperty('--solid', t.ui.panel === t.ui.bg ? t.ui.raised : t.ui.panel)
  root.setProperty('--solid-bg', t.ui.bg)
  t.ansi.forEach((c, i) => root.setProperty(`--ansi-${i}`, c))
  root.setProperty('--font-size', `${fontSize}px`)
  document.documentElement.dataset.theme = key
}

export function xtermTheme(key, opacity = 1) {
  const t = themes[key] || themes[DEFAULT_THEME]
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
  const theme = {
    background: opacity < 1 ? withAlpha(t.ui.bg, opacity) : t.ui.bg,
    foreground: t.ui.fg,
    cursor: t.ui.accent,
    selectionBackground: t.ui.selection
  }
  names.forEach((n, i) => {
    theme[n] = t.ansi[i]
    theme[`bright${n[0].toUpperCase()}${n.slice(1)}`] = t.ansi[i + 8]
  })
  return theme
}
