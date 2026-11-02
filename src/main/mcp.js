// MCP client for Agent Mode. Servers live in ~/.117terminal/mcp.json using the same
// "mcpServers" shape as Claude, so configs can be imported from other tools.
import { app } from 'electron'
import { ipcMain } from './ipc.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { shellEnv } from './shellenv.js'
import { ETERM_DIR } from './zsh-plugins.js'

const HOME = os.homedir()
const CONFIG = path.join(ETERM_DIR, 'mcp.json')
const CONNECT_TIMEOUT = 60000
const CALL_TIMEOUT = 60000

export const PRESETS = [
  { name: 'filesystem', label: 'Filesystem', desc: 'Read and write files in folders you choose.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2.1.0', HOME] },
  { name: 'memory', label: 'Memory', desc: 'A knowledge graph the agent remembers across chats.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory@2.0.1'] },
  { name: 'fetch', label: 'Fetch', desc: 'Fetch web pages as Markdown.', command: 'uvx', args: ['mcp-server-fetch==2026.10.28'] },
  { name: 'git', label: 'Git', desc: 'Inspect and operate on git repositories.', command: 'uvx', args: ['mcp-server-git==2026.10.28'] },
  { name: 'time', label: 'Time', desc: 'Current time and timezone conversion.', command: 'uvx', args: ['mcp-server-time==2026.10.28'] },
  { name: 'sequential-thinking', label: 'Sequential Thinking', desc: 'Structured step-by-step problem solving.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking@2.0.0'] },
  { name: 'context7', label: 'Context7', desc: 'Up-to-date library docs for coding.', command: 'npx', args: ['-y', '@upstash/context7-mcp@4.4.4'] },
  { name: 'playwright', label: 'Playwright', desc: 'Drive a real browser.', command: 'npx', args: ['-y', '@playwright/mcp@0.0.84'] },
  { name: 'github', label: 'GitHub', desc: 'Issues, PRs and repos (needs a token).', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' }, needs: ['GITHUB_TOKEN'] },
  { name: 'brave-search', label: 'Brave Search', desc: 'Web search (needs an API key).', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server@2.1.4'], env: { BRAVE_API_KEY: '' }, needs: ['BRAVE_API_KEY'] },
  { name: 'aws-docs', label: 'AWS Documentation', desc: 'Search and read AWS docs.', command: 'uvx', args: ['awslabs.aws-documentation-mcp-server==1.2.4'] }
]

// Where other tools keep their MCP servers (brewcat writes to the first three).
const SOURCES = [
  { id: 'claude-code', label: 'Claude Code', file: path.join(HOME, '.claude.json'), key: 'mcpServers' },
  { id: 'kiro', label: 'Kiro', file: path.join(HOME, '.kiro', 'settings', 'mcp.json'), key: 'mcpServers' },
  { id: 'vscode', label: 'VS Code', file: path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'), key: 'servers' },
  { id: 'claude-desktop', label: 'Claude Desktop', file: path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), key: 'mcpServers' },
  { id: 'cursor', label: 'Cursor', file: path.join(HOME, '.cursor', 'mcp.json'), key: 'mcpServers' }
]

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
    c.mcpServers ||= {}
    return c
  } catch {
    return { mcpServers: {} }
  }
}

function saveConfig(c) {
  fs.mkdirSync(ETERM_DIR, { recursive: true })
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2), { mode: 0o600 })
}

function readSource(src) {
  try {
    const servers = JSON.parse(fs.readFileSync(src.file, 'utf8'))[src.key] || {}
    return Object.fromEntries(
      Object.entries(servers).filter(([, s]) => s && (s.command || s.url))
    )
  } catch {
    return {}
  }
}

// ---- tool review --------------------------------------------------------------
// Tool descriptions go straight into the model prompt, so a server update that
// rewrites them (tool poisoning) must not slip by. We hash the tool list and keep
// the hash the user last reviewed in mcp.json as reviewedToolsHash.

// JSON with sorted object keys, so equal schemas always hash the same.
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

function hashTools(tools) {
  const list = (tools || [])
    .map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || null }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return crypto.createHash('sha256').update(stableJson(list)).digest('hex')
}

// First connect of a new server: remember its tools as reviewed (the Extensions
// panel lists every tool and description). Later connects only compare.
function recordToolsHash(name, hash) {
  const c = loadConfig()
  const def = c.mcpServers[name]
  if (!def || def.reviewedToolsHash) return
  def.reviewedToolsHash = hash
  saveConfig(c)
}

// True when the server's current tools differ from the ones the user reviewed.
function toolsChanged(name, def) {
  const hash = conns.get(name)?.hash
  return !!(hash && def?.reviewedToolsHash && hash !== def.reviewedToolsHash)
}

// ---- connections ------------------------------------------------------------

const conns = new Map() // name -> { client, tools, hash, error, connecting }

function expand(str, env) {
  return String(str).replace(/\$\{(\w+)\}/g, (_, k) => env[k] ?? '')
}

async function connect(name) {
  const existing = conns.get(name)
  if (existing?.client) return existing
  if (existing?.connecting) return existing.connecting
  const def = loadConfig().mcpServers[name]
  if (!def) throw new Error(`Unknown MCP server ${name}`)

  const promise = (async () => {
    const baseEnv = await shellEnv()
    const env = { ...baseEnv, ...(def.env || {}) }
    let transport
    if (def.url) {
      const headers = Object.fromEntries(Object.entries(def.headers || {}).map(([k, v]) => [k, expand(v, env)]))
      const url = new URL(def.url)
      transport = def.type === 'sse' ? new SSEClientTransport(url, { requestInit: { headers } }) : new StreamableHTTPClientTransport(url, { requestInit: { headers } })
    } else {
      transport = new StdioClientTransport({ command: def.command, args: (def.args || []).map((a) => expand(a, env)), env, stderr: 'pipe' })
    }
    const client = new Client({ name: '117Terminal', version: app.getVersion() })
    let timer
    let tools
    try {
      await Promise.race([
        (async () => {
          await client.connect(transport)
          tools = (await client.listTools(undefined, { timeout: CONNECT_TIMEOUT })).tools
        })(),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error(`Timed out after ${CONNECT_TIMEOUT / 1000} s`)), CONNECT_TIMEOUT)
        })
      ])
    } catch (err) {
      client.close().catch(() => {})
      throw err
    } finally {
      clearTimeout(timer)
    }
    const hash = hashTools(tools)
    const conn = { client, tools, hash, error: null }
    conns.set(name, conn)
    recordToolsHash(name, hash)
    client.onclose = () => conns.delete(name)
    return conn
  })()

  conns.set(name, { connecting: promise })
  try {
    return await promise
  } catch (err) {
    conns.set(name, { error: err.message || String(err) })
    throw err
  }
}

async function disconnect(name) {
  const c = conns.get(name)
  conns.delete(name)
  try {
    await c?.client?.close()
  } catch {
    /* already closed */
  }
}

// Tool names must match ^[a-zA-Z0-9_-]{1,64}$ for every provider.
const toolName = (server, tool) => `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)

function cleanSchema(schema) {
  const s = JSON.parse(JSON.stringify(schema || { type: 'object', properties: {} }))
  delete s.$schema
  if (s.type !== 'object') return { type: 'object', properties: {} }
  s.properties ||= {}
  return s
}

// Tools from every enabled server, connecting lazily. Failures are skipped.
export async function agentTools() {
  const servers = Object.entries(loadConfig().mcpServers).filter(([, s]) => !s.disabled)
  const out = []
  await Promise.all(
    servers.map(async ([name, def]) => {
      try {
        const { tools } = await connect(name)
        // Changed tools need approval for every call until the user accepts them.
        const trusted = !!def.trusted && !toolsChanged(name, def)
        for (const t of tools) {
          out.push({
            name: toolName(name, t.name),
            server: name,
            tool: t.name,
            trusted,
            description: `[${name}] ${t.description || t.name}`.slice(0, 1024),
            schema: cleanSchema(t.inputSchema)
          })
        }
      } catch {
        /* surfaced in the Extensions panel */
      }
    })
  )
  // Servers connect in parallel; a fixed order keeps the prompt cache valid between requests.
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

async function callTool(name, args) {
  for (const t of await agentTools()) {
    if (t.name !== name) continue
    const { client } = await connect(t.server)
    let res
    try {
      res = await client.callTool({ name: t.tool, arguments: args || {} }, undefined, { timeout: CALL_TIMEOUT })
    } catch (err) {
      if (err?.code === ErrorCode.RequestTimeout) {
        return { ok: false, content: `MCP tool ${t.tool} timed out after ${CALL_TIMEOUT / 1000} s.` }
      }
      return { ok: false, content: `MCP tool ${t.tool} failed: ${err?.message || err}` }
    }
    const text = (res.content || [])
      .map((c) => (c.type === 'text' ? c.text : c.type === 'resource' ? c.resource?.text || c.resource?.uri : `[${c.type}]`))
      .join('\n')
    return { ok: !res.isError, content: text.slice(0, 20000) || '(empty result)' }
  }
  return { ok: false, content: `Tool ${name} is not available.` }
}

function listing() {
  const c = loadConfig()
  return {
    configFile: CONFIG,
    servers: Object.entries(c.mcpServers).map(([name, def]) => {
      const conn = conns.get(name)
      return {
        name,
        ...def,
        status: conn?.client ? 'connected' : conn?.connecting ? 'connecting' : conn?.error ? 'error' : 'idle',
        error: conn?.error || '',
        toolsHash: conn?.hash || '',
        toolsChanged: toolsChanged(name, def),
        tools: conn?.tools?.map((t) => ({ name: t.name, description: t.description || '' })) || []
      }
    }),
    presets: PRESETS.map((p) => ({ ...p, added: !!c.mcpServers[p.name] })),
    sources: SOURCES.map((s) => {
      const servers = readSource(s)
      return { id: s.id, label: s.label, file: s.file, count: Object.keys(servers).length, names: Object.keys(servers) }
    }).filter((s) => s.count)
  }
}

export function registerMcpIpc() {
  ipcMain.handle('mcp:list', () => listing())

  ipcMain.handle('mcp:save', async (_e, name, def) => {
    const c = loadConfig()
    const clean = Object.fromEntries(Object.entries(def).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)))
    // The review hash is only changed by mcp:acceptTools, never by editing.
    delete clean.reviewedToolsHash
    const reviewed = c.mcpServers[name]?.reviewedToolsHash
    if (reviewed) clean.reviewedToolsHash = reviewed
    c.mcpServers[name] = clean
    saveConfig(c)
    await disconnect(name)
    return listing()
  })

  ipcMain.handle('mcp:remove', async (_e, name) => {
    const c = loadConfig()
    delete c.mcpServers[name]
    saveConfig(c)
    await disconnect(name)
    return listing()
  })

  ipcMain.handle('mcp:test', async (_e, name) => {
    await disconnect(name)
    try {
      const { tools } = await connect(name)
      return { ok: true, tools: tools.length, listing: listing() }
    } catch (err) {
      return { ok: false, error: err.message || String(err), listing: listing() }
    }
  })

  // Accept a server's current tools as reviewed. Pass the toolsHash the UI showed,
  // so tools that changed again in the meantime aren't accepted unseen.
  ipcMain.handle('mcp:acceptTools', async (_e, name, hash) => {
    const { hash: current } = await connect(name)
    if (hash && hash !== current) {
      return { ok: false, error: 'The tools changed again. Review them and accept once more.', listing: listing() }
    }
    const c = loadConfig()
    if (!c.mcpServers[name]) return { ok: false, error: `Unknown MCP server ${name}`, listing: listing() }
    c.mcpServers[name].reviewedToolsHash = current
    saveConfig(c)
    return { ok: true, listing: listing() }
  })

  ipcMain.handle('mcp:import', (_e, sourceId) => {
    const src = SOURCES.find((s) => s.id === sourceId)
    const c = loadConfig()
    let added = 0
    for (const [name, def] of Object.entries(readSource(src))) {
      if (c.mcpServers[name]) continue
      const { type, command, args, env, url, headers } = def
      c.mcpServers[name] = Object.fromEntries(
        Object.entries({ type: type === 'stdio' ? undefined : type, command, args, env, url, headers }).filter(([, v]) => v !== undefined)
      )
      added++
    }
    saveConfig(c)
    return { added, listing: listing() }
  })

  ipcMain.handle('mcp:call', (_e, name, args) => callTool(name, args))
}
