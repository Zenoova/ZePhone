// Writes one version into the three files that carry it, so that a release tag (`v1.2.3`) decides the version of every
// installer: package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml.
//
//   node scripts/set-version.mjs v1.2.3     (the leading `v` is optional)
//   node scripts/set-version.mjs --check    print the version the files carry and fail if they disagree
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  packageJson: join(root, "package.json"),
  tauriConf: join(root, "src-tauri", "tauri.conf.json"),
  cargoToml: join(root, "src-tauri", "Cargo.toml"),
};

/** A plain `major.minor.patch`: installers (an MSI for one) do not accept anything fancier. */
const SEMVER = /^\d+\.\d+\.\d+$/;

function read() {
  const cargo = readFileSync(files.cargoToml, "utf8");
  const inPackage = cargo.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  return {
    packageJson: JSON.parse(readFileSync(files.packageJson, "utf8")).version,
    tauriConf: JSON.parse(readFileSync(files.tauriConf, "utf8")).version,
    cargoToml: inPackage?.[1],
  };
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/set-version.mjs <vX.Y.Z> | --check");
  process.exit(2);
}

if (arg === "--check") {
  const found = read();
  const versions = new Set(Object.values(found));
  console.log(JSON.stringify(found));
  process.exit(versions.size === 1 && SEMVER.test([...versions][0] ?? "") ? 0 : 1);
}

const version = arg.replace(/^v/, "");
if (!SEMVER.test(version)) {
  console.error(`"${arg}" is not a version like 1.2.3 (or v1.2.3)`);
  process.exit(2);
}

const replaceJsonVersion = (path) => {
  const text = readFileSync(path, "utf8");
  // Replace the first top-level "version" only, keeping the file's formatting untouched.
  writeFileSync(path, text.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`));
};
replaceJsonVersion(files.packageJson);
replaceJsonVersion(files.tauriConf);

const cargo = readFileSync(files.cargoToml, "utf8");
const updated = cargo.replace(/(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m, `$1"${version}"`);
if (updated === cargo && read().cargoToml !== version) {
  console.error("could not find the version of [package] in src-tauri/Cargo.toml");
  process.exit(1);
}
writeFileSync(files.cargoToml, updated);

const found = read();
console.log(`version set to ${version}: ${JSON.stringify(found)}`);
process.exit(Object.values(found).every((v) => v === version) ? 0 : 1);
