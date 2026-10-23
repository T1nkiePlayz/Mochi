// Writes a release version (from a tag such as v1.2.3) into every manifest.
// Usage: node scripts/sync-version.mjs 1.2.3
import { readFileSync, writeFileSync } from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid release version: ${process.argv[2]}`);
  process.exit(1);
}

const updateJson = (path) => {
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
};
updateJson("package.json");
updateJson("src-tauri/tauri.conf.json");

const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8");
const updated = cargo.replace(/(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
if (updated === cargo && !cargo.includes(`version = "${version}"`)) {
  console.error("Could not find the [package] version in src-tauri/Cargo.toml");
  process.exit(1);
}
writeFileSync(cargoPath, updated);

// Keep Cargo.lock in step so release builds can use `cargo build --locked`.
const lockPath = "src-tauri/Cargo.lock";
const lock = readFileSync(lockPath, "utf8");
const lockUpdated = lock.replace(/(^name = "mochi"\nversion = ")[^"]+(")/m, `$1${version}$2`);
if (!/^name = "mochi"\nversion = "/m.test(lock)) {
  console.error("Could not find the mochi package in src-tauri/Cargo.lock");
  process.exit(1);
}
writeFileSync(lockPath, lockUpdated);
