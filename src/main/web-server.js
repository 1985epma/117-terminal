// 117terminal --serve: the full UI in any browser (HarmonyOS, tablets, other
// computers). Serves the renderer build and bridges IPC over a WebSocket.
// It is a shell, so access needs the secret token printed at startup.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import { handlers, listeners, addSink } from './ipc.js'
import { killOwner } from './core.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
}
const COOKIE = 't117'

function cookieToken(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  return m ? decodeURIComponent(m[1]) : ''
}

export function startWebServer({ root, port = 7117, host = '127.0.0.1', token }) {
  token ||= crypto.randomBytes(24).toString('base64url')
  const valid = (t) => {
    if (!t || t.length !== token.length) return false
    return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token))
  }
  const local = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  // On loopback, only accept our own host names (blocks DNS-rebinding pages).
  const hostOk = (req) => {
    if (!local) return true
    const h = (req.headers.host || '').replace(/:\d+$/, '')
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
  }
  const authed = (req, url) => hostOk(req) && (valid(url.searchParams.get('token')) || valid(cookieToken(req)))

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local')
    if (!authed(req, url)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('117Terminal: open the URL printed by `117terminal --serve` (it includes the access token).\n')
    }
    // First visit with ?token=…: keep it in a cookie and drop it from the URL.
    if (url.searchParams.has('token')) {
      res.writeHead(302, {
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
        Location: '/'
      })
      return res.end()
    }
    const rel = url.pathname === '/' ? 'web.html' : decodeURIComponent(url.pathname.slice(1))
    const file = path.resolve(root, rel)
    if (!file.startsWith(path.resolve(root) + path.sep)) {
      res.writeHead(403)
      return res.end()
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404)
        return res.end('Not found')
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': file.endsWith('.html') ? 'no-store' : 'max-age=3600',
        'X-Content-Type-Options': 'nosniff'
      })
      res.end(data)
    })
  })

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 32 * 1024 * 1024,
    verifyClient: ({ req, origin }) => {
      const url = new URL(req.url, 'http://local')
      if (!authed(req, url)) return false
      // The page and the socket must come from the same origin.
      return !origin || new URL(origin).host === req.headers.host
    }
  })

  wss.on('connection', (ws) => {
    const owner = `web:${crypto.randomUUID()}`
    const event = { owner, sender: { id: owner } }
    const off = addSink((ch, ...args) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'event', ch, args }))
    })
    ws.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      if (msg.t === 'send') return listeners.get(msg.ch)?.(event, ...(msg.args || []))
      if (msg.t !== 'invoke') return
      const h = handlers.get(msg.ch)
      try {
        if (!h) throw new Error(`No handler for ${msg.ch}`)
        const value = await h(event, ...(msg.args || []))
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: true, value }))
      } catch (err) {
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: false, error: err.message || String(err) }))
      }
    })
    ws.on('close', () => {
      off()
      killOwner(owner)
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host
      resolve({ url: `http://${shown}:${port}/?token=${token}`, token, server })
    })
  })
}
