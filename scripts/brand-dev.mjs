// In development the app runs inside node_modules/electron/dist/Electron.app,
// so macOS shows "Electron" in the Dock and app switcher. Rename that bundle
// to 117Terminal so dev builds look like the packaged app.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

if (process.platform !== 'darwin') process.exit(0)
const plist = path.resolve('node_modules/electron/dist/Electron.app/Contents/Info.plist')
if (!fs.existsSync(plist)) process.exit(0)
for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  try {
    execFileSync('plutil', ['-replace', key, '-string', '117Terminal', plist])
  } catch {
    execFileSync('plutil', ['-insert', key, '-string', '117Terminal', plist])
  }
}
console.log('Dev Electron bundle renamed to 117Terminal')
