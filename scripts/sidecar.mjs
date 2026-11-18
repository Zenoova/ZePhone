// Cross-platform entry point of the Baresip scripts (`npm run sidecar`, `npm run sidecar:hd`, `npm run sidecar:android`).
//
//   node scripts/sidecar.mjs prepare [args]   stage the sidecar (macOS: from an installed Baresip,
//                                             Windows: build it on first use)
//   node scripts/sidecar.mjs build [args]     build Baresip from source with Opus/G.722, then stage it
//   node scripts/sidecar.mjs android [args]   build Baresip for Android (NDK) into src-tauri/android/jniLibs;
//                                             `--abi arm64-v8a,x86_64` picks the ABIs (default: the one Tauri is
//                                             building for, else arm64-v8a), `--force` rebuilds
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [action = "prepare", ...args] = process.argv.slice(2);
if (!["prepare", "build", "android"].includes(action)) {
  console.error(`unknown action "${action}" (expected "prepare", "build" or "android")`);
  process.exit(2);
}

/** Tauri names the architecture it builds for in TAURI_ENV_ARCH; the NDK names the same thing as an ABI. */
const ABI_OF_ARCH = { aarch64: "arm64-v8a", x86_64: "x86_64" };

function option(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

let command;
let commandArgs;
if (action === "android") {
  const abi = option("abi") ?? ABI_OF_ARCH[process.env.TAURI_ENV_ARCH ?? ""] ?? "arm64-v8a";
  const script = join(here, "build-baresip-android.ps1");
  command = process.platform === "win32" ? "powershell.exe" : "pwsh";
  commandArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Abi", abi];
  if (args.includes("--force")) commandArgs.push("-Force");
} else if (process.platform === "win32") {
  // On Windows the sidecar is always built from source: there is no Homebrew-like install to copy from.
  const script = join(here, "build-baresip.ps1");
  const forced = args.includes("--force") ? ["-Force"] : [];
  command = "powershell.exe";
  commandArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...forced];
} else {
  command = "bash";
  commandArgs = [join(here, action === "build" ? "build-baresip.sh" : "prepare-baresip.sh"), ...args];
}

const result = spawnSync(command, commandArgs, { stdio: "inherit" });
if (result.error) {
  console.error(
    result.error.code === "ENOENT" && command === "pwsh"
      ? "PowerShell 7 (pwsh) is required to build Baresip for Android: https://aka.ms/powershell"
      : result.error.message,
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
