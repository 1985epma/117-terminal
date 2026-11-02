// macOS: drop the permission strings Electron ships by default for features 117Terminal
// never uses (camera, Bluetooth, system audio capture), so macOS never asks for them.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const UNUSED = [
  'NSCameraUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSAudioCaptureUsageDescription'
]

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const plist = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Info.plist')
  for (const key of UNUSED) {
    try {
      execFileSync('plutil', ['-remove', key, plist], { stdio: 'ignore' })
    } catch {
      /* key not present */
    }
  }
}
