// One-time move from the app's old name ("ETerm") to 117Terminal.
// macOS ties safeStorage to the app name, so saved API keys are decrypted by a
// short-lived helper process running under the old name and handed back over
// a pipe (never written to disk in plain text), then re-encrypted here.
import { app, safeStorage } from 'electron'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const OLD_NAME = 'ETerm'
const EXPORT_FLAG = 'T117_KEY_EXPORT'

export const isKeyExport = () => process.env[EXPORT_FLAG] === '1'
export const appName = () => (isKeyExport() ? OLD_NAME : '117Terminal')

const oldDir = () => path.join(app.getPath('appData'), OLD_NAME)

// Runs inside the helper process: print decrypted keys as JSON and quit.
export function runKeyExport() {
  app.whenReady().then(() => {
    const out = {}
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(oldDir(), 'ai.json'), 'utf8'))
      for (const [id, entry] of Object.entries(cfg.providers || {})) {
        if (entry.key?.enc) out[id] = safeStorage.decryptString(Buffer.from(entry.key.enc, 'base64'))
        else if (entry.key?.plain) out[id] = entry.key.plain
      }
    } catch {
      /* nothing to export */
    }
    process.stdout.write(`\n${JSON.stringify(out)}\n`)
    app.exit(0)
  })
}

// Copies old app data (history, settings, theme) and fetches old keys.
// Returns the decrypted keys to re-encrypt once the app is ready, or null.
export function migrateBeforeReady() {
  const from = oldDir()
  const to = app.getPath('userData')
  const marker = path.join(to, '.migrated-from-eterm')
  if (!fs.existsSync(from) || fs.existsSync(marker)) return null

  fs.mkdirSync(to, { recursive: true })
  fs.cpSync(from, to, {
    recursive: true,
    force: false,
    filter: (src) => !/Singleton|shell-integration|\.lock$/.test(path.basename(src))
  })

  let keys = null
  if (fs.existsSync(path.join(from, 'ai.json'))) {
    const args = app.isPackaged ? [] : [app.getAppPath()]
    const res = spawnSync(process.execPath, args, {
      env: { ...process.env, [EXPORT_FLAG]: '1' },
      encoding: 'utf8',
      timeout: 30000
    })
    try {
      keys = JSON.parse((res.stdout || '').trim().split('\n').pop())
    } catch {
      keys = null
    }
  }
  fs.writeFileSync(marker, new Date().toISOString())
  return keys
}
