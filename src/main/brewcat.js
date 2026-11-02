// Bridge to brewcat (github.com/1985epma/homebrew-brewcat): catalog search,
// profiles and kits come from its --json CLI. Installs run as terminal blocks
// in the renderer so the user sees (and can stop) them.
import { ipcMain } from './ipc.js'
import { spawn } from 'node:child_process'
import { run, which, shellEnv } from './shellenv.js'

async function json(args) {
  const r = await run('brewcat', [...args, '--json'], { timeout: 60000 })
  if (!r.stdout.trim()) return { ok: false, error: (r.stderr || r.error || 'brewcat returned nothing').trim() }
  try {
    return { ok: true, data: JSON.parse(r.stdout) }
  } catch {
    return { ok: false, error: r.stderr.trim() || 'Could not read brewcat output' }
  }
}

export function registerBrewcatIpc() {
  ipcMain.handle('brewcat:status', async () => {
    const bin = await which('brewcat')
    if (!bin) return { installed: false, brew: !!(await which('brew')) }
    const [ver, doctor] = await Promise.all([run('brewcat', ['--version'], { timeout: 15000 }), json(['doctor'])])
    return {
      installed: true,
      path: bin,
      version: ver.stdout.split('\n')[0].replace(/^brewcat\s*/, ''),
      doctor: doctor.ok ? doctor.data : null
    }
  })

  ipcMain.handle('brewcat:profiles', async () => {
    const r = await run('brewcat', ['profiles'], { timeout: 30000 })
    return r.stdout
      .split('\n')
      .map((l) => l.trim().match(/^(\S+)\s+(\d+)/))
      .filter(Boolean)
      .map((m) => ({ name: m[1], count: Number(m[2]) }))
  })

  ipcMain.handle('brewcat:search', (_e, { query, profile }) => {
    const args = ['search', query || '']
    if (profile) args.push('-p', profile)
    return json(args)
  })

  ipcMain.handle('brewcat:kits', (_e, profile) => json(profile ? ['kits', '-p', profile] : ['kits']))

  ipcMain.handle('brewcat:open', async () => {
    const env = await shellEnv()
    spawn('brewcat', [], { env, detached: true, stdio: 'ignore' }).unref()
    return true
  })
}
