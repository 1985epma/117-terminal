// Zsh plugin & prompt manager. Plugins are cloned into ~/.117terminal/zsh/plugins
// and loaded from one generated file (~/.117terminal/zsh/plugins.zsh). 117Terminal's shell
// shim sources it, so the user's ~/.zshrc is never touched unless they opt in.
import { ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, which } from './shellenv.js'

const HOME = os.homedir()
export const ETERM_DIR = path.join(HOME, '.117terminal')
const ZSH_DIR = path.join(ETERM_DIR, 'zsh')
const PLUGINS_DIR = path.join(ZSH_DIR, 'plugins')
export const PLUGINS_FILE = path.join(ZSH_DIR, 'plugins.zsh')
const STATE_FILE = path.join(ZSH_DIR, 'state.json')
const ZSHRC = path.join(process.env.ZDOTDIR || HOME, '.zshrc')
const ZSHRC_LINE = `[[ -f "${PLUGINS_FILE}" ]] && source "${PLUGINS_FILE}"  # 117Terminal plugins`

// kind: git (cloned repo), omz (Oh My Zsh plugin), tool (brew binary + init line)
// load: 'source' | 'fpath' | 'last' (syntax highlighters must load last)
export const CATALOG = [
  // --- Essentials
  { id: 'zsh-autosuggestions', group: 'Essentials', kind: 'git', repo: 'zsh-users/zsh-autosuggestions', file: 'zsh-autosuggestions.zsh', desc: 'Fish-like suggestions from your history as you type.', popular: true },
  { id: 'zsh-syntax-highlighting', group: 'Essentials', kind: 'git', repo: 'zsh-users/zsh-syntax-highlighting', file: 'zsh-syntax-highlighting.zsh', load: 'last', conflicts: ['fast-syntax-highlighting'], desc: 'Colors commands as you type: green if valid, red if not.', popular: true },
  { id: 'fast-syntax-highlighting', group: 'Essentials', kind: 'git', repo: 'zdharma-continuum/fast-syntax-highlighting', file: 'fast-syntax-highlighting.plugin.zsh', load: 'last', conflicts: ['zsh-syntax-highlighting'], desc: 'Faster, richer syntax highlighting (alternative).' },
  { id: 'zsh-completions', group: 'Essentials', kind: 'git', repo: 'zsh-users/zsh-completions', fpath: 'src', desc: 'Hundreds of extra completion definitions.', popular: true },
  { id: 'zsh-history-substring-search', group: 'Essentials', kind: 'git', repo: 'zsh-users/zsh-history-substring-search', file: 'zsh-history-substring-search.zsh', init: "bindkey '^[[A' history-substring-search-up; bindkey '^[[B' history-substring-search-down", desc: 'Type part of a command, then ↑/↓ through matching history.' },
  { id: 'zsh-autocomplete', group: 'Essentials', kind: 'git', repo: 'marlonrichert/zsh-autocomplete', file: 'zsh-autocomplete.plugin.zsh', early: true, desc: 'Real-time, type-ahead completion menus.' },
  { id: 'zsh-autopair', group: 'Essentials', kind: 'git', repo: 'hlissner/zsh-autopair', file: 'autopair.zsh', desc: 'Auto-closes quotes and brackets.' },
  // --- Productivity
  { id: 'fzf-tab', group: 'Productivity', kind: 'git', repo: 'Aloxaf/fzf-tab', file: 'fzf-tab.plugin.zsh', requires: ['fzf'], desc: 'Replace the Tab menu with fzf fuzzy search.' },
  { id: 'you-should-use', group: 'Productivity', kind: 'git', repo: 'MichaelAquilina/zsh-you-should-use', file: 'you-should-use.plugin.zsh', desc: 'Reminds you when an alias exists for what you typed.' },
  { id: 'zsh-z', group: 'Productivity', kind: 'git', repo: 'agkozak/zsh-z', file: 'zsh-z.plugin.zsh', desc: 'Jump to frequent folders: z proj → ~/projects.' },
  { id: 'forgit', group: 'Productivity', kind: 'git', repo: 'wfxr/forgit', file: 'forgit.plugin.zsh', requires: ['fzf'], desc: 'Interactive git with fzf (ga, glo, gd…).' },
  { id: 'zsh-vi-mode', group: 'Productivity', kind: 'git', repo: 'jeffreytse/zsh-vi-mode', file: 'zsh-vi-mode.plugin.zsh', desc: 'Better vi mode for the zsh line editor.' },
  { id: 'zsh-nvm', group: 'Productivity', kind: 'git', repo: 'lukechilds/zsh-nvm', file: 'zsh-nvm.plugin.zsh', init: 'export NVM_LAZY_LOAD=true', early: true, desc: 'Installs and lazy-loads nvm.' },
  // --- Oh My Zsh plugins (one shallow clone, only the chosen plugins load)
  { id: 'omz-git', group: 'Oh My Zsh', kind: 'omz', plugin: 'git', desc: '150+ git aliases: gst, gco, gp, glog…', popular: true },
  { id: 'omz-docker', group: 'Oh My Zsh', kind: 'omz', plugin: 'docker', desc: 'Docker aliases and completions.' },
  { id: 'omz-kubectl', group: 'Oh My Zsh', kind: 'omz', plugin: 'kubectl', desc: 'kubectl aliases: k, kgp, kaf…' },
  { id: 'omz-aws', group: 'Oh My Zsh', kind: 'omz', plugin: 'aws', desc: 'AWS profile helpers (asp, acp).' },
  { id: 'omz-terraform', group: 'Oh My Zsh', kind: 'omz', plugin: 'terraform', desc: 'Terraform aliases (tf, tfi, tfp…).' },
  { id: 'omz-npm', group: 'Oh My Zsh', kind: 'omz', plugin: 'npm', desc: 'npm aliases and completion.' },
  { id: 'omz-sudo', group: 'Oh My Zsh', kind: 'omz', plugin: 'sudo', desc: 'Press Esc twice to prefix sudo.' },
  { id: 'omz-extract', group: 'Oh My Zsh', kind: 'omz', plugin: 'extract', desc: 'x file.tar.gz — extracts any archive.' },
  { id: 'omz-colored-man-pages', group: 'Oh My Zsh', kind: 'omz', plugin: 'colored-man-pages', desc: 'Colorful man pages.' },
  { id: 'omz-copypath', group: 'Oh My Zsh', kind: 'omz', plugin: 'copypath', desc: 'copypath copies the current path.' },
  // --- Tools (Homebrew binaries with a shell hook)
  { id: 'zoxide', group: 'Tools', kind: 'tool', bin: 'zoxide', brew: 'zoxide', init: 'eval "$(zoxide init zsh)"', desc: 'Smarter cd: z, zi.', popular: true },
  { id: 'fzf', group: 'Tools', kind: 'tool', bin: 'fzf', brew: 'fzf', init: 'source <(fzf --zsh)', desc: 'Fuzzy finder: Ctrl-R history, Ctrl-T files.', popular: true },
  { id: 'atuin', group: 'Tools', kind: 'tool', bin: 'atuin', brew: 'atuin', init: 'eval "$(atuin init zsh)"', desc: 'Searchable, synced shell history.' },
  { id: 'direnv', group: 'Tools', kind: 'tool', bin: 'direnv', brew: 'direnv', init: 'eval "$(direnv hook zsh)"', desc: 'Per-folder environment variables.' },
  { id: 'mise', group: 'Tools', kind: 'tool', bin: 'mise', brew: 'mise', init: 'eval "$(mise activate zsh)"', desc: 'Node, Python, Go… versions per project.' },
  { id: 'thefuck', group: 'Tools', kind: 'tool', bin: 'thefuck', brew: 'thefuck', init: 'eval "$(thefuck --alias)"', desc: 'Type fuck to fix the last command.' }
]

export const PROMPTS = [
  { id: 'powerlevel10k', name: 'Powerlevel10k', kind: 'git', repo: 'romkatv/powerlevel10k', desc: 'Fast, beautiful, endlessly configurable.', presets: ['lean', 'classic', 'rainbow', 'pure', 'robbyrussell'] },
  { id: 'starship', name: 'Starship', kind: 'tool', bin: 'starship', brew: 'starship', desc: 'Cross-shell prompt written in Rust.', presets: ['default', 'nerd-font-symbols', 'tokyo-night', 'gruvbox-rainbow', 'pastel-powerline', 'pure-preset', 'plain-text-symbols'] },
  { id: 'pure', name: 'Pure', kind: 'git', repo: 'sindresorhus/pure', desc: 'Minimal, pretty and fast.' },
  { id: 'spaceship', name: 'Spaceship', kind: 'git', repo: 'spaceship-prompt/spaceship-prompt', desc: 'Minimal prompt with lots of context sections.' }
]

const OMZ_REPO = 'ohmyzsh/ohmyzsh'
const OMZ_DIR = path.join(PLUGINS_DIR, 'ohmyzsh')

function loadState() {
  try {
    return { enabled: [], prompt: null, otherTerminals: false, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
  } catch {
    return { enabled: [], prompt: null, otherTerminals: false }
  }
}

function saveState(state) {
  fs.mkdirSync(ZSH_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

const dirFor = (repo) => path.join(PLUGINS_DIR, repo.split('/')[1])
const q = (p) => `"${p.replace(/"/g, '\\"')}"`

async function clone(repo) {
  const dir = dirFor(repo)
  if (fs.existsSync(path.join(dir, '.git'))) return { ok: true }
  fs.mkdirSync(PLUGINS_DIR, { recursive: true })
  const r = await run('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, dir], { timeout: 300000 })
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.error || '').trim().split('\n').pop() }
}

function generate(state) {
  const lines = [
    '# Generated by 117Terminal — manage it in 117Terminal › Extensions (/plugins).',
    '# Safe to source from ~/.zshrc. Edits here are overwritten.',
    '[[ -n "$ETERM_PLUGINS_LOADED" ]] && return',
    'export ETERM_PLUGINS_LOADED=1',
    ''
  ]
  const enabled = CATALOG.filter((p) => state.enabled.includes(p.id))
  const usesOmz = enabled.some((p) => p.kind === 'omz')

  // fpath additions must come before compinit.
  for (const p of enabled.filter((x) => x.fpath)) lines.push(`fpath=(${q(path.join(dirFor(p.repo), p.fpath))} $fpath)`)
  for (const p of enabled.filter((x) => x.early)) {
    if (p.init) lines.push(p.init)
    lines.push(`source ${q(path.join(dirFor(p.repo), p.file))}`)
  }
  lines.push('if (( ! $+functions[compdef] )); then autoload -Uz compinit && compinit -C; fi', '')

  if (usesOmz) {
    lines.push(`ZSH=${q(OMZ_DIR)}`, 'ZSH_CACHE_DIR="$HOME/.cache/eterm-omz"; mkdir -p "$ZSH_CACHE_DIR/completions"')
    for (const lib of ['functions', 'git', 'clipboard']) lines.push(`source ${q(path.join(OMZ_DIR, 'lib', `${lib}.zsh`))}`)
    for (const p of enabled.filter((x) => x.kind === 'omz')) {
      lines.push(`source ${q(path.join(OMZ_DIR, 'plugins', p.plugin, `${p.plugin}.plugin.zsh`))}`)
    }
    lines.push('')
  }

  for (const p of enabled.filter((x) => x.kind === 'git' && x.file && !x.early && x.load !== 'last')) {
    lines.push(`source ${q(path.join(dirFor(p.repo), p.file))}`)
    if (p.init) lines.push(p.init)
  }
  for (const p of enabled.filter((x) => x.kind === 'tool')) lines.push(`(( $+commands[${p.bin}] )) && ${p.init}`)

  const prompt = PROMPTS.find((x) => x.id === state.prompt)
  if (prompt) {
    lines.push('', `# Prompt: ${prompt.name}`)
    if (prompt.id === 'powerlevel10k') {
      lines.push(
        'typeset -g POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true',
        `source ${q(path.join(dirFor(prompt.repo), 'powerlevel10k.zsh-theme'))}`,
        '[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh'
      )
    } else if (prompt.id === 'starship') {
      lines.push('(( $+commands[starship] )) && eval "$(starship init zsh)"')
    } else if (prompt.id === 'pure') {
      lines.push(`fpath+=(${q(dirFor(prompt.repo))})`, 'autoload -U promptinit; promptinit', 'prompt pure')
    } else if (prompt.id === 'spaceship') {
      lines.push(`source ${q(path.join(dirFor(prompt.repo), 'spaceship.zsh'))}`)
    }
  }

  // Syntax highlighters wrap every widget, so they go last.
  for (const p of enabled.filter((x) => x.load === 'last')) lines.push(`source ${q(path.join(dirFor(p.repo), p.file))}`)

  fs.mkdirSync(ZSH_DIR, { recursive: true })
  fs.writeFileSync(PLUGINS_FILE, lines.join('\n') + '\n')
}

function zshrcHasLine() {
  try {
    return fs.readFileSync(ZSHRC, 'utf8').includes('# 117Terminal plugins')
  } catch {
    return false
  }
}

function setOtherTerminals(on) {
  let text = ''
  try {
    text = fs.readFileSync(ZSHRC, 'utf8')
  } catch {
    /* no .zshrc yet */
  }
  const has = text.includes('# 117Terminal plugins')
  if (on === has) return
  if (text) fs.writeFileSync(`${ZSHRC}.117terminal-backup`, text)
  const next = on
    ? `${text}${text && !text.endsWith('\n') ? '\n' : ''}${ZSHRC_LINE}\n`
    : text
        .split('\n')
        .filter((l) => !l.includes('# 117Terminal plugins'))
        .join('\n')
  fs.writeFileSync(ZSHRC, next)
}

async function status() {
  const state = loadState()
  const bins = {}
  await Promise.all(
    [...CATALOG, ...PROMPTS].filter((p) => p.bin).map(async (p) => (bins[p.bin] = !!(await which(p.bin))))
  )
  const installed = (p) => {
    if (p.kind === 'tool') return bins[p.bin]
    if (p.kind === 'omz') return fs.existsSync(path.join(OMZ_DIR, 'plugins', p.plugin))
    return fs.existsSync(path.join(dirFor(p.repo), '.git'))
  }
  return {
    pluginsFile: PLUGINS_FILE,
    otherTerminals: zshrcHasLine(),
    prompt: state.prompt,
    p10kConfig: fs.existsSync(path.join(HOME, '.p10k.zsh')),
    plugins: CATALOG.map((p) => ({ ...p, enabled: state.enabled.includes(p.id), installed: installed(p) })),
    prompts: PROMPTS.map((p) => ({ ...p, active: state.prompt === p.id, installed: installed(p) }))
  }
}

async function setPlugin(id, on) {
  const p = CATALOG.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown plugin ${id}`)
  const state = loadState()
  if (on) {
    if (p.kind === 'git') {
      const r = await clone(p.repo)
      if (!r.ok) return { ok: false, error: `Could not download ${p.repo}: ${r.error}` }
    } else if (p.kind === 'omz') {
      const r = await clone(OMZ_REPO)
      if (!r.ok) return { ok: false, error: `Could not download Oh My Zsh: ${r.error}` }
    }
    state.enabled = [...new Set([...state.enabled.filter((x) => !(p.conflicts || []).includes(x)), id])]
  } else {
    state.enabled = state.enabled.filter((x) => x !== id)
  }
  saveState(state)
  generate(state)
  return { ok: true }
}

async function setPrompt(id, preset) {
  const state = loadState()
  const p = PROMPTS.find((x) => x.id === id)
  if (id && !p) throw new Error(`Unknown prompt ${id}`)
  if (p?.kind === 'git') {
    const r = await clone(p.repo)
    if (!r.ok) return { ok: false, error: `Could not download ${p.repo}: ${r.error}` }
  }
  if (id === 'powerlevel10k') {
    const target = path.join(HOME, '.p10k.zsh')
    // p10k opens its interactive wizard when no config exists; ship a preset instead.
    if (preset || !fs.existsSync(target)) {
      const src = path.join(dirFor(p.repo), 'config', `p10k-${preset || 'lean'}.zsh`)
      if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.117terminal-backup`)
      fs.copyFileSync(src, target)
    }
  }
  if (id === 'starship' && preset) {
    const out = path.join(HOME, '.config', 'starship.toml')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    if (fs.existsSync(out)) fs.copyFileSync(out, `${out}.117terminal-backup`)
    const r = await run('starship', ['preset', preset, '-o', out])
    if (!r.ok) return { ok: false, error: r.stderr || r.error }
  }
  state.prompt = id || null
  saveState(state)
  generate(state)
  return { ok: true }
}

async function updateAll() {
  const dirs = fs.existsSync(PLUGINS_DIR) ? fs.readdirSync(PLUGINS_DIR).map((d) => path.join(PLUGINS_DIR, d)) : []
  const results = await Promise.all(
    dirs
      .filter((d) => fs.existsSync(path.join(d, '.git')))
      .map(async (d) => ({ name: path.basename(d), ...(await run('git', ['-C', d, 'pull', '--ff-only'], { timeout: 180000 })) }))
  )
  return results.map((r) => ({ name: r.name, ok: r.ok, out: (r.stdout || r.stderr).trim().split('\n').pop() }))
}

export function registerZshIpc() {
  // Make sure the file exists so the shim's `source` never fails.
  if (!fs.existsSync(PLUGINS_FILE)) generate(loadState())

  ipcMain.handle('zsh:status', () => status())
  ipcMain.handle('zsh:plugin', (_e, id, on) => setPlugin(id, on))
  ipcMain.handle('zsh:prompt', (_e, id, preset) => setPrompt(id, preset))
  ipcMain.handle('zsh:update', () => updateAll())
  ipcMain.handle('zsh:otherTerminals', (_e, on) => {
    setOtherTerminals(on)
    return { ok: true }
  })
}
