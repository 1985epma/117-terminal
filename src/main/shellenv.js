// Apps started from Finder/Dock get a minimal PATH. Ask the user's login shell
// once for its real environment so brew, git, npx, uvx, brewcat… are found.
import { execFile } from 'node:child_process'

let envPromise = null

export function shellEnv() {
  if (envPromise) return envPromise
  envPromise = new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    const marker = '__ETERM_ENV__'
    execFile(
      shell,
      ['-ilc', `printf '${marker}'; /usr/bin/env -0`],
      { timeout: 8000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ETERM_ENV_PROBE: '1' } },
      (err, stdout) => {
        const env = { ...process.env }
        if (!err && stdout.includes(marker)) {
          for (const entry of stdout.slice(stdout.indexOf(marker) + marker.length).split('\0')) {
            const i = entry.indexOf('=')
            if (i > 0) env[entry.slice(0, i)] = entry.slice(i + 1)
          }
        }
        // Common install locations, in case the probe failed.
        const extra = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', `${env.HOME}/.local/bin`]
        const parts = (env.PATH || '').split(':')
        env.PATH = [...parts, ...extra.filter((p) => !parts.includes(p))].join(':')
        resolve(env)
      }
    )
  })
  return envPromise
}

// Promise-based execFile using the login-shell environment.
export async function run(cmd, args, opts = {}) {
  const env = await shellEnv()
  return new Promise((resolve) => {
    execFile(cmd, args, { env, maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout ?? 120000, cwd: opts.cwd }, (err, stdout, stderr) =>
      resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr), error: err?.message })
    )
  })
}

export async function which(bin) {
  const r = await run('/usr/bin/which', [bin], { timeout: 5000 })
  return r.ok ? r.stdout.trim() : ''
}
