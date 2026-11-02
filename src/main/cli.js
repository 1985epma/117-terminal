// The `117terminal` command line: argument parsing, help, version, doctor and shell
// completions. Everything here runs before Electron starts a window, so commands that only
// print (help, version, doctor, completions) exit without opening anything.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Exit codes (documented in --help).
export const EXIT = { OK: 0, ERROR: 1, USAGE: 2, PORT_IN_USE: 3 }

const COMMANDS = ['open', 'run', 'theme', 'serve', 'doctor', 'completions', 'help', 'version']
const BOOL_FLAGS = ['serve', 'open', 'json', 'new-tab', 'settings', 'wait', 'no-color', 'help', 'version']
const VALUE_FLAGS = ['port', 'host', 'token', 'token-file']
const SHORT = { h: 'help', v: 'version' }

// Chromium/Electron switches and macOS launch arguments pass through untouched.
const PASSTHROUGH = /^--(no-sandbox|ozone-platform(-hint)?|enable-features|disable-features|disable-gpu(-sandbox)?|in-process-gpu|use-gl|use-angle|gtk-version|enable-wayland-ime|wayland-text-input-version|remote-debugging-port|remote-debugging-pipe|inspect(-brk)?|enable-logging|log-file|v|vmodule|lang|force-device-scale-factor|user-data-dir|js-flags|force-renderer-accessibility|high-dpi-support|ignore-gpu-blocklist|disable-dev-shm-usage)(=|$)|^-psn_/

// Keep in sync with src/renderer/src/lib/themes.js.
export const THEME_NAMES = ['ninja', 'midnight', 'aurora', 'ember', 'daylight']

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length]
}
const suggest = (word, list) => {
  const best = list.map((w) => [w, distance(word, w)]).sort((x, y) => x[1] - y[1])[0]
  return best && best[1] <= 2 ? best[0] : null
}

// argv: the user's arguments only (no executable, no app path).
// cwd: where relative folders resolve (the invoking shell's folder).
// lenient: skip what it does not know instead of failing. Used for the argv a second
// launch hands to the running app, where Electron adds switches of its own.
export function parseArgs(argv, cwd = process.cwd(), { lenient = false } = {}) {
  const o = { command: 'gui', dirs: [], passthrough: [], flags: {}, rest: [] }
  const fail = (msg) => ({ ...o, error: msg })
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (PASSTHROUGH.test(a)) {
      o.passthrough.push(a)
      continue
    }
    if (/^-[a-zA-Z]$/.test(a)) {
      const name = SHORT[a[1]]
      if (!name) {
        if (lenient) continue
        return fail(`unknown option: ${a}`)
      }
      o.flags[name] = true
      continue
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = a.slice(2, eq === -1 ? undefined : eq)
      if (BOOL_FLAGS.includes(name)) {
        if (eq !== -1) return fail(`--${name} takes no value`)
        o.flags[name] = true
      } else if (VALUE_FLAGS.includes(name)) {
        const value = eq !== -1 ? a.slice(eq + 1) : argv[++i]
        if (value === undefined || value === '' || (eq === -1 && value.startsWith('--'))) return fail(`--${name} needs a value`)
        o.flags[name] = value
      } else if (lenient) {
        continue
      } else {
        const hint = suggest(name, [...BOOL_FLAGS, ...VALUE_FLAGS])
        return fail(`unknown option: --${name}${hint ? ` (did you mean --${hint}?)` : ''}`)
      }
      continue
    }
    positional.push(a)
  }

  // The first word picks a subcommand; anything else is a folder.
  // (A folder named like a subcommand: `117terminal open doctor` or `117terminal ./doctor`.)
  if (positional.length && COMMANDS.includes(positional[0])) o.command = positional.shift()
  if (o.flags.help) o.command = 'help'
  else if (o.flags.version) o.command = 'version'
  else if (o.flags.serve) o.command = 'serve'

  if (o.command !== 'serve') {
    const serveOnly = ['port', 'host', 'token', 'token-file', 'json'].filter(
      (f) => o.flags[f] !== undefined && !(f === 'json' && o.command === 'doctor')
    )
    if (serveOnly.length) return fail(`--${serveOnly[0]} only works with --serve`)
  }

  switch (o.command) {
    case 'run':
      if (!positional.length) return fail('run needs a command, e.g. 117terminal run "npm test"')
      o.run = positional.join(' ')
      o.cwd = cwd
      return o
    case 'theme':
      if (positional.length !== 1) return fail(`theme needs one name: ${THEME_NAMES.join(', ')}`)
      if (!THEME_NAMES.includes(positional[0])) {
        const hint = suggest(positional[0], THEME_NAMES)
        return fail(`unknown theme: ${positional[0]}${hint ? ` (did you mean ${hint}?)` : ''}. Themes: ${THEME_NAMES.join(', ')}`)
      }
      o.theme = positional[0]
      return o
    case 'completions':
      if (!['bash', 'zsh', 'fish'].includes(positional[0])) return fail('completions needs a shell: bash, zsh or fish')
      o.shell = positional[0]
      return o
    case 'gui':
    case 'open': {
      for (const p of positional) {
        let full = ''
        try {
          // Linux file managers pass file:// URLs (the .desktop entry uses %U).
          full = p.startsWith('file://') ? fileURLToPath(p) : path.resolve(cwd, p)
        } catch {
          /* bad URL */
        }
        if (!full || !fs.existsSync(full)) {
          if (lenient) continue
          const hint = o.command === 'gui' ? suggest(p, COMMANDS) : null
          return fail(hint ? `unknown command: ${p} (did you mean ${hint}?)` : `no such folder: ${p}`)
        }
        o.dirs.push(fs.statSync(full).isDirectory() ? full : path.dirname(full))
      }
      if (o.command === 'open' && !o.dirs.length) return fail('open needs a folder, e.g. 117terminal open ~/projects')
      o.command = 'gui'
      return o
    }
    default:
      if (positional.length) return fail(`unexpected argument: ${positional[0]}`)
  }

  if (o.command === 'serve') {
    if (o.flags.port !== undefined) {
      const port = Number(o.flags.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(`invalid --port: ${o.flags.port} (use 1-65535)`)
      o.port = port
    }
    if (o.flags.token && o.flags['token-file']) return fail('use --token or --token-file, not both')
  }
  return o
}

const colors = (stream) => !!stream.isTTY && !process.env.NO_COLOR && !process.argv.includes('--no-color')
const paint = (stream) => {
  const on = colors(stream)
  const c = (code) => (s) => (on ? `\x1b[${code}m${s}\x1b[0m` : s)
  return { bold: c('1'), cyan: c('36'), dim: c('2'), red: c('31'), green: c('32'), yellow: c('33') }
}

export function helpText(version) {
  const p = paint(process.stdout)
  return `${p.bold('117Terminal')} ${version} — block-based terminal with Agent Mode

${p.bold('Usage')}
  117terminal [folder...]             open the app (a new tab per folder)
  117terminal open <folder...>        same, explicit
  117terminal run <command>           new tab in this folder, running <command>
  117terminal theme <name>            switch theme: ${THEME_NAMES.join(', ')}
  117terminal serve [options]         serve the UI to a browser (HarmonyOS, tablets)
  117terminal doctor [--json]         check libraries, shell, agent and web mode
  117terminal completions <shell>     print bash, zsh or fish completions
  117terminal help | version

${p.bold('Options')}
  --new-tab            open a new tab in the running app
  --settings           open Settings
  --wait               stay attached to this terminal until the app quits
  --no-color           no colors (also: NO_COLOR=1)
  -h, --help           this help
  -v, --version        print the version

${p.bold('Serve options')}
  --port <n>           port (default 7117)
  --host <addr>        127.0.0.1 (default) or 0.0.0.0 for your network
  --token-file <path>  keep the access token in this file (created 0600 if missing)
  --token <t>          access token (visible in \`ps\`; prefer --token-file or T117_TOKEN)
  --open               open the browser
  --json               print {"url","port","host"} as one JSON line

${p.bold('Examples')}
  117terminal ~/projects/api
  117terminal run "npm test"
  117terminal serve --host 0.0.0.0 --token-file ~/.config/117terminal/token
  URL=$(117terminal serve)          # stdout is only the URL; messages go to stderr

${p.bold('Exit codes')}
  0 ok · 1 error · 2 wrong usage · 3 port already in use
`
}

export function usageError(msg) {
  const p = paint(process.stderr)
  process.stderr.write(`${p.red('117terminal:')} ${msg}\nTry '117terminal --help'.\n`)
  return EXIT.USAGE
}

// Token for --serve: --token, else T117_TOKEN, else --token-file (created on first use).
export function resolveToken(o) {
  if (o.flags.token) return o.flags.token
  if (process.env.T117_TOKEN) return process.env.T117_TOKEN
  const file = o.flags['token-file']
  if (!file) return undefined
  const full = path.resolve(file.replace(/^~(?=$|\/)/, os.homedir()))
  if (fs.existsSync(full)) {
    const t = fs.readFileSync(full, 'utf8').trim()
    if (t.length < 16) throw new Error(`token in ${full} is too short (16+ characters)`)
    return t
  }
  const t = crypto.randomBytes(24).toString('base64url')
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, `${t}\n`, { mode: 0o600 })
  return t
}

// ---- completions -----------------------------------------------------------

const ALL_FLAGS = [...BOOL_FLAGS, ...VALUE_FLAGS].map((f) => `--${f}`)

export function completions(shell) {
  const cmds = COMMANDS.join(' ')
  const flags = ALL_FLAGS.join(' ')
  const themes = THEME_NAMES.join(' ')
  if (shell === 'bash') {
    return `# 117terminal completions for bash: eval "$(117terminal completions bash)"
_117terminal() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "$prev" in
    theme) mapfile -t COMPREPLY < <(compgen -W "${themes}" -- "$cur"); return ;;
    completions) mapfile -t COMPREPLY < <(compgen -W "bash zsh fish" -- "$cur"); return ;;
    --token-file) mapfile -t COMPREPLY < <(compgen -f -- "$cur"); return ;;
    --port|--host|--token) return ;;
  esac
  if [[ "$cur" == -* ]]; then
    mapfile -t COMPREPLY < <(compgen -W "${flags} -h -v" -- "$cur")
  elif [[ $COMP_CWORD -eq 1 ]]; then
    mapfile -t COMPREPLY < <(compgen -W "${cmds}" -- "$cur"; compgen -d -- "$cur")
  else
    mapfile -t COMPREPLY < <(compgen -d -- "$cur")
  fi
}
complete -o filenames -F _117terminal 117terminal
`
  }
  if (shell === 'zsh') {
    return `#compdef 117terminal
# 117terminal completions for zsh: 117terminal completions zsh > "\${fpath[1]}/_117terminal"
_117terminal() {
  local -a cmds
  cmds=(${COMMANDS.map((c) => `'${c}'`).join(' ')})
  _arguments -C \\
    '(-h --help)'{-h,--help}'[show help]' \\
    '(-v --version)'{-v,--version}'[print the version]' \\
    '--serve[serve the UI to a browser]' \\
    '--port[port]:port' \\
    '--host[address]:host:(127.0.0.1 0.0.0.0)' \\
    '--token-file[token file]:file:_files' \\
    '--token[access token]:token' \\
    '--open[open the browser]' \\
    '--json[JSON output]' \\
    '--new-tab[new tab in the running app]' \\
    '--settings[open Settings]' \\
    '--wait[stay attached until the app quits]' \\
    '--no-color[no colors]' \\
    '1: :->first' \\
    '*:folder:_files -/'
  case $state in
    first)
      case $words[2] in
        *) _alternative 'commands:command:(${COMMANDS.join(' ')})' 'folders:folder:_files -/' ;;
      esac ;;
  esac
  case $words[2] in
    theme) _values 'theme' ${themes} ;;
    completions) _values 'shell' bash zsh fish ;;
  esac
}
_117terminal "$@"
`
  }
  return `# 117terminal completions for fish: 117terminal completions fish > ~/.config/fish/completions/117terminal.fish
complete -c 117terminal -f
complete -c 117terminal -n __fish_use_subcommand -a '${cmds}'
complete -c 117terminal -n __fish_use_subcommand -a '(__fish_complete_directories)'
complete -c 117terminal -n '__fish_seen_subcommand_from theme' -a '${themes}'
complete -c 117terminal -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish'
complete -c 117terminal -n '__fish_seen_subcommand_from open' -a '(__fish_complete_directories)'
complete -c 117terminal -s h -l help -d 'Show help'
complete -c 117terminal -s v -l version -d 'Print the version'
complete -c 117terminal -l serve -d 'Serve the UI to a browser'
complete -c 117terminal -l port -r -d 'Port'
complete -c 117terminal -l host -r -a '127.0.0.1 0.0.0.0' -d 'Address'
complete -c 117terminal -l token-file -r -F -d 'Token file'
complete -c 117terminal -l token -r -d 'Access token'
complete -c 117terminal -l open -d 'Open the browser'
complete -c 117terminal -l json -d 'JSON output'
complete -c 117terminal -l new-tab -d 'New tab in the running app'
complete -c 117terminal -l settings -d 'Open Settings'
complete -c 117terminal -l wait -d 'Stay attached until the app quits'
complete -c 117terminal -l no-color -d 'No colors'
`
}

// ---- doctor ----------------------------------------------------------------

function which(cmd) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(dir, cmd)
    try {
      fs.accessSync(full, fs.constants.X_OK)
      return full
    } catch {
      /* keep looking */
    }
  }
  return null
}

const portFree = (port) =>
  import('node:net').then(
    ({ default: net }) =>
      new Promise((resolve) => {
        const s = net.createServer()
        s.once('error', () => resolve(false))
        s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
      })
  )

// Checks the things that most often go wrong. Reads config files directly and never
// decrypts keys, so it never touches the Keychain.
export async function doctor({ version, userData, json }) {
  const checks = []
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, ...(fix && !ok ? { fix } : {}) })

  add('117Terminal', true, `${version} · ${process.platform} ${process.arch}`)

  const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell' : '')
  add('Shell', process.platform === 'win32' || (!!shell && fs.existsSync(shell)), shell || 'not set', 'Set $SHELL to your shell (zsh, bash or fish)')

  if (process.platform === 'linux') {
    let missing = []
    try {
      const out = execFileSync('ldd', [process.execPath], { encoding: 'utf8' })
      missing = out.split('\n').filter((l) => l.includes('not found')).map((l) => l.trim().split(' ')[0])
    } catch {
      /* ldd unavailable */
    }
    add('System libraries', !missing.length, missing.length ? `missing: ${missing.join(', ')}` : 'all found',
      'Run install.sh again, or: sudo apt install libgbm1 libasound2t64 libgtk-3-0t64 libnss3')
    add('Display', !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY), process.env.WAYLAND_DISPLAY ? 'Wayland' : process.env.DISPLAY ? `X11 ${process.env.DISPLAY}` : 'none (web mode still works: 117terminal serve)')
  }

  const zshFile = path.join(os.homedir(), '.117terminal', 'zsh', 'plugins.zsh')
  add('Zsh plugins', true, fs.existsSync(zshFile) ? zshFile : 'none set up (Settings › Zsh & Prompt)')

  let ai = null
  try {
    ai = JSON.parse(fs.readFileSync(path.join(userData, 'ai.json'), 'utf8'))
  } catch {
    /* not set up */
  }
  const active = ai?.active
  const local = ['ollama', 'lmstudio'].includes(active)
  const hasKey = !!(active && (local || ai.providers?.[active]?.key))
  add('Agent', hasKey, active ? `${active}${local ? ' (local, no key needed)' : hasKey ? ', key saved' : ', no key'}` : 'no provider', 'Open Settings › AI Agent (⌘, then AI Agent)')

  let mcpCount = 0
  let mcpOk = true
  const mcpFile = path.join(os.homedir(), '.117terminal', 'mcp.json')
  if (fs.existsSync(mcpFile)) {
    try {
      mcpCount = Object.keys(JSON.parse(fs.readFileSync(mcpFile, 'utf8')).mcpServers || {}).length
    } catch {
      mcpOk = false
    }
  }
  add('MCP servers', mcpOk, mcpOk ? `${mcpCount} configured` : `${mcpFile} is not valid JSON`, `Fix or remove ${mcpFile}`)

  add('brewcat', true, which('brewcat') || 'not installed (optional)')
  const free = await portFree(7117)
  add('Web mode port 7117', true, free ? 'free' : 'in use (pass --port to serve on another)')

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: checks.every((c) => c.ok), checks })}\n`)
  } else {
    const p = paint(process.stdout)
    for (const c of checks) {
      process.stdout.write(`${c.ok ? p.green('✓') : p.red('✗')} ${p.bold(c.name.padEnd(20))} ${c.detail}\n`)
      if (c.fix) process.stdout.write(`  ${p.yellow('→')} ${c.fix}\n`)
    }
  }
  return checks.every((c) => c.ok) ? EXIT.OK : EXIT.ERROR
}
