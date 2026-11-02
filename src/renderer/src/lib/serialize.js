// Turns an xterm.js buffer into styled HTML. Soft-wrapped rows are joined
// back into one logical line so finished blocks reflow with CSS on resize.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ESC[c])

function color256(n) {
  if (n < 16) return `var(--ansi-${n})`
  if (n < 232) {
    const i = n - 16
    const steps = [0, 95, 135, 175, 215, 255]
    const r = steps[Math.floor(i / 36)]
    const g = steps[Math.floor(i / 6) % 6]
    const b = steps[i % 6]
    return `rgb(${r},${g},${b})`
  }
  const v = 8 + (n - 232) * 10
  return `rgb(${v},${v},${v})`
}

function rgb(n) {
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`
}

function fg(cell) {
  if (cell.isFgDefault()) return null
  if (cell.isFgRGB()) return rgb(cell.getFgColor())
  let n = cell.getFgColor()
  if (cell.isBold() && n < 8) n += 8 // bright-on-bold, like most terminals
  return color256(n)
}

function bg(cell) {
  if (cell.isBgDefault()) return null
  if (cell.isBgRGB()) return rgb(cell.getBgColor())
  return color256(cell.getBgColor())
}

function styleOf(cell) {
  let f = fg(cell)
  let b = bg(cell)
  if (cell.isInverse()) {
    ;[f, b] = [b || 'var(--bg)', f || 'var(--fg)']
  }
  const parts = []
  if (f) parts.push(`color:${f}`)
  if (b) parts.push(`background:${b}`)
  if (cell.isBold()) parts.push('font-weight:700')
  if (cell.isDim()) parts.push('opacity:.6')
  if (cell.isItalic()) parts.push('font-style:italic')
  const deco = []
  if (cell.isUnderline()) deco.push('underline')
  if (cell.isStrikethrough()) deco.push('line-through')
  if (deco.length) parts.push(`text-decoration:${deco.join(' ')}`)
  if (cell.isInvisible()) parts.push('visibility:hidden')
  return parts.join(';')
}

function rowToHtml(line, cell, cols) {
  // Find last meaningful cell so we don't emit trailing padding.
  let last = -1
  for (let x = 0; x < cols; x++) {
    line.getCell(x, cell)
    if (cell.getChars() || !cell.isBgDefault()) last = x
  }
  let html = ''
  let run = ''
  let runStyle = ''
  for (let x = 0; x <= last; x++) {
    line.getCell(x, cell)
    if (cell.getWidth() === 0) continue
    const ch = cell.getChars() || ' '
    const st = styleOf(cell)
    if (st !== runStyle) {
      if (run) html += runStyle ? `<span style="${runStyle}">${escapeHtml(run)}</span>` : escapeHtml(run)
      run = ''
      runStyle = st
    }
    run += ch
  }
  if (run) html += runStyle ? `<span style="${runStyle}">${escapeHtml(run)}</span>` : escapeHtml(run)
  return { html, empty: last < 0 }
}

export class BufferSerializer {
  constructor(term) {
    this.term = term
    this.cache = new Map() // row index -> html (only for scrollback rows, which are immutable)
  }

  reset() {
    this.cache.clear()
  }

  toHtml() {
    const term = this.term
    const buf = term.buffer.normal
    const cell = buf.getNullCell()
    const cols = term.cols
    const stable = buf.baseY // rows above the viewport no longer change
    const logical = []
    let lastNonEmpty = -1

    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y)
      if (!line) continue
      let row = y < stable ? this.cache.get(y) : undefined
      if (row === undefined) {
        row = rowToHtml(line, cell, cols)
        if (y < stable) this.cache.set(y, row)
      }
      if (line.isWrapped && logical.length) {
        logical[logical.length - 1] += row.html
      } else {
        logical.push(row.html)
      }
      if (!row.empty) lastNonEmpty = logical.length - 1
    }
    return logical.slice(0, lastNonEmpty + 1).join('\n')
  }

  toText() {
    const buf = this.term.buffer.normal
    const out = []
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y)
      if (!line) continue
      const text = line.translateToString(true)
      if (line.isWrapped && out.length) out[out.length - 1] += text
      else out.push(text)
    }
    while (out.length && !out[out.length - 1].trim()) out.pop()
    return out.join('\n')
  }
}
