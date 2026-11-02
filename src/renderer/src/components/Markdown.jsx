// Small, safe Markdown renderer (no raw HTML) for agent replies.
import { Fragment } from 'react'
import { Highlighted } from '../lib/highlight.jsx'

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g

function inline(text, keyBase) {
  const out = []
  let last = 0
  let m
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${m.index}`
    if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('[')) {
      const label = tok.slice(1, tok.indexOf(']'))
      out.push(
        <a key={key} href={m[2]} target="_blank" rel="noreferrer">
          {label}
        </a>
      )
    } else out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function CodeBlock({ lang, code, onRun, onInsert }) {
  const shell = !lang || /^(bash|sh|zsh|shell|console)$/.test(lang)
  const clean = code.replace(/^\$ /gm, '')
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || 'shell'}</span>
        <div>
          <button onClick={() => window.eterm.clipboard.write(clean)}>Copy</button>
          {shell && onInsert && <button onClick={() => onInsert(clean)}>Insert</button>}
          {shell && onRun && <button onClick={() => onRun(clean)}>▶ Run</button>}
        </div>
      </div>
      <pre className="mono">{shell ? <Highlighted text={clean} /> : clean}</pre>
    </div>
  )
}

export default function Markdown({ text, onRun, onInsert }) {
  const parts = text.split(/```([\w-]*)\n?([\s\S]*?)(?:```|$)/g)
  const nodes = []
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i]
    if (prose && prose.trim()) nodes.push(...prosed(prose, i))
    if (i + 2 < parts.length) {
      nodes.push(
        <CodeBlock key={`c${i}`} lang={parts[i + 1]} code={parts[i + 2].replace(/\n$/, '')} onRun={onRun} onInsert={onInsert} />
      )
    }
  }
  return <div className="md">{nodes}</div>
}

function prosed(text, base) {
  const out = []
  const lines = text.replace(/^\n+|\n+$/g, '').split('\n')
  let list = null
  let para = []
  const flushPara = () => {
    if (para.length) {
      out.push(
        <p key={`p${base}-${out.length}`}>
          {para.map((l, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {inline(l, `${base}-${out.length}-${j}`)}
            </Fragment>
          ))}
        </p>
      )
      para = []
    }
  }
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? 'ol' : 'ul'
      out.push(
        <Tag key={`l${base}-${out.length}`}>
          {list.items.map((it, j) => (
            <li key={j}>{inline(it, `${base}-li-${out.length}-${j}`)}</li>
          ))}
        </Tag>
      )
      list = null
    }
  }
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const head = line.match(/^(#{1,4})\s+(.*)$/)
    if (bullet || num) {
      flushPara()
      const ordered = !!num
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((bullet || num)[1])
    } else if (head) {
      flushPara()
      flushList()
      out.push(
        <div key={`h${base}-${out.length}`} className={`md-h md-h${head[1].length}`}>
          {inline(head[2], `${base}-h${out.length}`)}
        </div>
      )
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return out
}
