// Shell integration: tiny rc shims that load the user's own config and then
// emit private OSC 6973 markers so the UI can split output into blocks.
//   ESC ] 6973 ; C BEL          -> command started (preexec)
//   ESC ] 6973 ; D ; <code> BEL -> command finished / prompt ready (precmd)
//   ESC ] 6973 ; P ; <cwd> BEL  -> current directory
//   ESC ] 6973 ; G ; <branch>   -> current git branch (empty if none)
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const ZSHENV = `ETERM_INTEGRATION_DIR="$ZDOTDIR"
ZDOTDIR="\${ETERM_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
ETERM_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$ETERM_INTEGRATION_DIR"
`

const ZPROFILE = `ZDOTDIR="$ETERM_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zprofile" ]] && source "$ZDOTDIR/.zprofile"
ETERM_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$ETERM_INTEGRATION_DIR"
`

const ZSHRC = `ZDOTDIR="$ETERM_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"
# Plugins and prompt managed in 117Terminal › Extensions (no-op if already sourced).
[[ -f "$HOME/.117terminal/zsh/plugins.zsh" ]] && source "$HOME/.117terminal/zsh/plugins.zsh"
# From here on zsh reads the user's own .zlogin / history from their ZDOTDIR.

__eterm_precmd() {
  local ec=$?
  local branch
  branch=$(command git symbolic-ref --short HEAD 2>/dev/null || command git rev-parse --short HEAD 2>/dev/null)
  builtin printf '\\e]6973;D;%s\\a\\e]6973;P;%s\\a\\e]6973;G;%s\\a' "$ec" "$PWD" "$branch"
}
__eterm_preexec() { builtin printf '\\e]6973;C\\a' }

# Run first so $? is still the command's exit status.
precmd_functions=(__eterm_precmd \${precmd_functions[@]})
preexec_functions+=(__eterm_preexec)
unsetopt PROMPT_SP 2>/dev/null
`

const BASHRC = `[[ -f /etc/profile ]] && source /etc/profile
if [[ -f ~/.bash_profile ]]; then source ~/.bash_profile
elif [[ -f ~/.bash_login ]]; then source ~/.bash_login
elif [[ -f ~/.profile ]]; then source ~/.profile
fi
[[ -f ~/.bashrc && ! -f ~/.bash_profile ]] && source ~/.bashrc

__eterm_armed=0
__eterm_preexec() {
  if [[ "$__eterm_armed" == 1 ]]; then
    __eterm_armed=0
    builtin printf '\\e]6973;C\\a'
  fi
}
__eterm_precmd() {
  local branch
  branch=$(command git symbolic-ref --short HEAD 2>/dev/null || command git rev-parse --short HEAD 2>/dev/null)
  builtin printf '\\e]6973;D;%s\\a\\e]6973;P;%s\\a\\e]6973;G;%s\\a' "$__eterm_ec" "$PWD" "$branch"
  __eterm_armed=1
}
trap '__eterm_preexec' DEBUG
PROMPT_COMMAND="__eterm_ec=\\$?;\${PROMPT_COMMAND:+$PROMPT_COMMAND;}__eterm_precmd"
`

const FISH = `function __t117_postexec --on-event fish_postexec
  set -g __t117_status $status
end
function __t117_prompt --on-event fish_prompt
  set -q __t117_status; or set -g __t117_status 0
  printf '\\e]6973;D;%s\\a\\e]6973;P;%s\\a\\e]6973;G;%s\\a' $__t117_status $PWD (command git symbolic-ref --short HEAD 2>/dev/null)
end
function __t117_preexec --on-event fish_preexec
  printf '\\e]6973;C\\a'
end
`

// PowerShell (Windows): wrap prompt for D/P/G and PSReadLine's line reader for C.
const POWERSHELL = `$__t117e = [char]27; $__t117b = [char]7
$Global:__T117OrigPrompt = $function:prompt
function Global:prompt {
  $ok = $?
  $code = if ($ok) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }
  $branch = ''
  if (Get-Command git -ErrorAction SilentlyContinue) { $branch = (git symbolic-ref --short HEAD 2>$null) }
  [Console]::Write("$__t117e]6973;D;$code$__t117b$__t117e]6973;P;$($PWD.ProviderPath)$__t117b$__t117e]6973;G;$branch$__t117b")
  & $Global:__T117OrigPrompt
}
if (Get-Module -ListAvailable PSReadLine) {
  function Global:PSConsoleHostReadLine {
    $line = [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($Host.Runspace, $ExecutionContext)
    [Console]::Write("$__t117e]6973;C$__t117b")
    $line
  }
}
`

function findOnPath(names) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const n of names) {
      const full = path.join(dir, n)
      if (fs.existsSync(full)) return full
    }
  }
  return null
}

// bracketedPaste: whether the shell's line editor accepts ESC[200~ pastes.
export function prepareShell(userDataDir) {
  const base = path.join(userDataDir, 'shell-integration')
  if (process.platform === 'win32') {
    const shell = findOnPath(['pwsh.exe']) || 'powershell.exe'
    fs.mkdirSync(base, { recursive: true })
    const script = path.join(base, 'integration.ps1')
    fs.writeFileSync(script, POWERSHELL)
    return {
      shell,
      args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `. '${script.replace(/'/g, "''")}'`],
      env: { ...process.env, TERM_PROGRAM: '117Terminal', TERM_PROGRAM_VERSION: app.getVersion() },
      bracketedPaste: false
    }
  }

  const shell = process.env.SHELL || (fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash')
  const name = path.basename(shell)
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: '117Terminal',
    TERM_PROGRAM_VERSION: app.getVersion(),
    LANG: process.env.LANG || 'en_US.UTF-8'
  }

  if (name === 'zsh') {
    const dir = path.join(base, 'zsh')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.zshenv'), ZSHENV)
    fs.writeFileSync(path.join(dir, '.zprofile'), ZPROFILE)
    fs.writeFileSync(path.join(dir, '.zshrc'), ZSHRC)
    env.ETERM_USER_ZDOTDIR = process.env.ZDOTDIR || process.env.HOME
    env.ZDOTDIR = dir
    return { shell, args: ['-l'], env, bracketedPaste: true }
  }

  if (name === 'fish') {
    fs.mkdirSync(base, { recursive: true })
    const rc = path.join(base, 'integration.fish')
    fs.writeFileSync(rc, FISH)
    return { shell, args: ['-l', '-C', `source '${rc}'`], env, bracketedPaste: true }
  }

  if (name === 'bash') {
    fs.mkdirSync(base, { recursive: true })
    const rc = path.join(base, 'bashrc')
    fs.writeFileSync(rc, BASHRC)
    return { shell, args: ['--rcfile', rc, '-i'], env, bracketedPaste: true }
  }

  // Unknown shell: works, but without blocks metadata.
  return { shell, args: ['-l'], env, bracketedPaste: true }
}
