// Tiny shell tokenizer for syntax highlighting in the editor and block headers.

const BUILTINS = new Set(
  'cd echo export source alias unalias exit pwd pushd popd set unset type which eval exec history jobs fg bg kill read printf test true false let local return shift trap ulimit umask wait builtin command hash time if then else elif fi for while until do done case esac function sudo nohup env'.split(
    ' '
  )
)

let executables = new Set()
export function setExecutables(list) {
  executables = new Set(list)
}
export function isKnownCommand(word) {
  return BUILTINS.has(word) || executables.has(word) || word.includes('/')
}

const TOKEN_RE = /(\s+)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?)|(\|\||&&|>>|[|;&<>])|(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$[?#@*0-9])|([^\s'"|;&<>]+)/g

export function tokenize(src) {
  const out = []
  let expectCmd = true
  let m
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(src))) {
    const [text, ws, str, op, variable, word] = m
    if (ws) {
      out.push({ text, type: 'ws' })
    } else if (str) {
      out.push({ text, type: 'str' })
      expectCmd = false
    } else if (op) {
      out.push({ text, type: 'op' })
      if (op !== '>' && op !== '<' && op !== '>>') expectCmd = true
    } else if (variable) {
      out.push({ text, type: 'var' })
    } else if (word) {
      if (expectCmd && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
        out.push({ text, type: 'var' })
      } else if (expectCmd) {
        out.push({ text, type: isKnownCommand(word) ? 'cmd' : 'cmd-unknown' })
        expectCmd = word === 'sudo' || word === 'time' || word === 'nohup' || word === 'env'
      } else if (word.startsWith('-')) {
        out.push({ text, type: 'flag' })
      } else {
        out.push({ text, type: 'arg' })
      }
    }
  }
  return out
}

export function Highlighted({ text }) {
  return tokenize(text).map((t, i) =>
    t.type === 'ws' ? (
      t.text
    ) : (
      <span key={i} className={`tok-${t.type}`}>
        {t.text}
      </span>
    )
  )
}
