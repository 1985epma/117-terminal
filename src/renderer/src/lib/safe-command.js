// Which agent commands may run without a click. Pure module (no DOM) so it can be tested under Node.
// Deny by default: a command is safe only if every pipe stage matches a known read-only form.

// Credential and config locations. Matched as path components, so ~/, $HOME/, /Users/<u>/ and
// relative forms (cat .ssh/id_rsa from the home directory) are all covered.
const SENSITIVE = [
  /(^|[\s/'"=:])\.(ssh|aws|gnupg|kube|netrc|npmrc|pypirc|117terminal)($|[\s/'"])/,
  /(^|[\s/'"=:])\.config\/gh($|[\s/'"])/,
  /(^|[\s/'"=:])\.docker\/config\.json($|[\s'"])/,
  /(^|[\s/'"=:])\.env(\.[^\s/'"]*)?($|[\s'"])/,
  /\.(pem|key|p12|pfx)($|[\s'"])/,
  /\bid_(rsa|dsa|ecdsa|ed25519)/,
  /\bcredentials\b/
]

// Splits a command into pipe stages of words, with quotes removed. Returns null for anything the
// check can't reason about: separators, redirection, substitution, expansion, escapes, globs.
function parse(cmd) {
  const stages = [[]]
  let word = null
  let quote = null
  const end = () => {
    if (word !== null) stages[stages.length - 1].push(word)
    word = null
  }
  for (const ch of cmd) {
    if (quote === "'") {
      if (ch === "'") quote = null
      else word += ch
      continue
    }
    if (quote === '"') {
      if (ch === '"') quote = null
      else if ('$`\\'.includes(ch)) return null
      else word += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      word = word ?? ''
    } else if (ch === ' ' || ch === '\t') {
      end()
    } else if (ch === '|') {
      end()
      stages.push([])
    } else if (';&<>()`$\\\n\r*?[]{}!#'.includes(ch)) {
      return null
    } else {
      word = (word ?? '') + ch
    }
  }
  if (quote) return null
  end()
  return stages.every((s) => s.length) ? stages : null
}

const has = (args, ...flags) => args.some((a) => flags.includes(a) || flags.some((f) => f.startsWith('--') && a.startsWith(f + '=')))
const positional = (args) => args.filter((a) => !a.startsWith('-'))
const anyArgs = () => true

const GIT_DIFFY = (args) => !args.some((a) => /^--(output|ext-diff)/.test(a))
const GIT_BRANCH_FLAGS = ['-a', '-r', '-v', '-vv', '-l', '--all', '--remotes', '--verbose', '--list', '--show-current', '--no-color']

const GIT = {
  status: GIT_DIFFY,
  log: GIT_DIFFY,
  show: GIT_DIFFY,
  diff: GIT_DIFFY,
  blame: GIT_DIFFY,
  'rev-parse': anyArgs,
  'ls-files': anyArgs,
  describe: anyArgs,
  branch: (args) => args.every((a) => GIT_BRANCH_FLAGS.includes(a)),
  remote: (args) =>
    !args.length ||
    (args.length === 1 && ['-v', '--verbose'].includes(args[0])) ||
    (['get-url', 'show'].includes(args[0]) && args.slice(1).every((a) => !a.startsWith('-') || a === '-n' || a === '--all')),
  tag: (args) => !args.length || (['-l', '--list'].includes(args[0]) && positional(args).length === args.length - 1)
}

const only = (...forms) => (args) => forms.some((f) => f.length === args.length && f.every((x, i) => x === args[i]))
const sub = (allowed, check = anyArgs) => (args) => allowed.includes(args[0]) && check(args.slice(1), args[0])

// Each command maps to a check over its arguments (the words after the command name).
const RULES = {
  ls: anyArgs,
  pwd: anyArgs,
  cat: anyArgs,
  head: anyArgs,
  tail: (a) => !has(a, '-f', '-F', '--follow'),
  wc: anyArgs,
  // Recursive grep and rg's hidden/ignored modes would read .env files under the cwd.
  grep: (a) => !a.some((x) => /^--(recursive|dereference-recursive)/.test(x) || /^-[^-]*[rR]/.test(x)),
  rg: (a) => !a.some((x) => /^--(pre|hidden|no-ignore|unrestricted)/.test(x) || /^-[^-]*[u.]/.test(x)),
  fd: (a) => !has(a, '-x', '-X', '--exec', '--exec-batch'),
  find: (a) => !has(a, '-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'),
  tree: (a) => !a.some((x) => x === '-o' || x.startsWith('-o') || x.startsWith('--output')),
  file: (a) => !has(a, '-C', '--compile'),
  stat: anyArgs,
  which: anyArgs,
  type: anyArgs,
  whoami: anyArgs,
  date: (a) => !has(a, '-s', '--set') && positional(a).every((x) => x.startsWith('+')),
  uname: anyArgs,
  df: anyArgs,
  du: anyArgs,
  ps: anyArgs,
  echo: anyArgs,
  printf: anyArgs,
  sort: (a) => !a.some((x) => x.startsWith('--output') || (/^-[^-]/.test(x) && x.includes('o'))),
  uniq: (a) => positional(a).length <= 1,
  cut: anyArgs,
  jq: anyArgs,
  git: (a) => Object.hasOwn(GIT, a[0] || '') && GIT[a[0]](a.slice(1)),
  node: only(['-v'], ['--version']),
  python: only(['-V'], ['--version']),
  python3: only(['-V'], ['--version']),
  npm: (a) => only(['-v'], ['--version'], ['run'])(a) || sub(['ls', 'list', 'view', 'outdated'])(a),
  pnpm: (a) => only(['-v'], ['--version'])(a) || sub(['ls', 'list'])(a),
  yarn: (a) => only(['-v'], ['--version'])(a) || sub(['list', 'info'])(a),
  cargo: (a) => only(['--version'])(a) || sub(['tree', 'metadata'])(a),
  go: sub(['version', 'env', 'list'], (rest) => !has(rest, '-w', '-u', '-toolexec', '-exec')),
  brew: (a) => only(['--version'])(a) || sub(['list', 'info', 'search'])(a)
}

export function touchesSensitivePath(cmd) {
  const text = String(cmd || '')
  // Also test the de-quoted words so '.e''nv' can't slip past.
  const words = (parse(text) || []).flat().join(' ')
  return SENSITIVE.some((re) => re.test(text) || re.test(words))
}

// True when an argument points outside the working directory: absolute, ~ or a .. component.
export function readsOutsideCwd(cmd) {
  const stages = parse(String(cmd || ''))
  if (!stages) return true
  return stages.flat().some((w) => /(^|=)[~/]/.test(w) || /(^|[/=])\.\.(\/|$)/.test(w))
}

export function isSafeCommand(cmd) {
  const stages = parse(String(cmd || '').trim())
  if (!stages || touchesSensitivePath(cmd)) return false
  return stages.every(([name, ...args]) => Object.hasOwn(RULES, name) && RULES[name](args))
}
