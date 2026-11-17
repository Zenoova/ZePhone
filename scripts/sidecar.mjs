// Cross-platform entry point of the Baresip sidecar scripts (`npm run sidecar`, `npm run sidecar:hd`).
//
//   node scripts/sidecar.mjs prepare [args]   stage the sidecar (macOS: from an installed Baresip,
//                                             Windows: build it on first use)
//   node scripts/sidecar.mjs build [args]     build Baresip from source with Opus/G.722, then stage it
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [action = 'prepare', ...args] = process.argv.slice(2)
if (!['prepare', 'build'].includes(action)) {
  console.error(`unknown action "${action}" (expected "prepare" or "build")`)
  process.exit(2)
}

let command
let commandArgs
if (process.platform === 'win32') {
  // On Windows the sidecar is always built from source: there is no Homebrew-like install to copy from.
  const script = join(here, 'build-baresip.ps1')
  const forced = args.includes('--force') ? ['-Force'] : []
  command = 'powershell.exe'
  commandArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...forced]
} else {
  command = 'bash'
  commandArgs = [join(here, action === 'build' ? 'build-baresip.sh' : 'prepare-baresip.sh'), ...args]
}

const result = spawnSync(command, commandArgs, { stdio: 'inherit' })
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
