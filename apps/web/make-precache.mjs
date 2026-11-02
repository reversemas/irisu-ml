#!/usr/bin/env node
// Writes precache.json (file list + content-hash version) into a built site dir.
import {createHash} from "node:crypto";
import {readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: make-precache.mjs SITE_DIR"); process.exit(1); }

const files = [];
(function walk(current) {
  for (const name of readdirSync(current).sort()) {
    const path = join(current, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    const rel = relative(dir, path).split("\\").join("/");
    if (rel === "sw.js" || rel === "precache.json" || rel === "CNAME" || rel.startsWith(".")) continue;
    if (rel.startsWith("exact-runtime/") && rel !== "exact-runtime/libv86.js") continue;
    files.push(rel);
  }
})(dir);

const hash = createHash("sha256");
for (const file of files) hash.update(file).update(readFileSync(join(dir, file)));
const version = hash.digest("hex").slice(0, 16);
writeFileSync(join(dir, "precache.json"),
  JSON.stringify({version, files: ["./", ...files.map(file => `./${file}`)]}, null, 2) + "\n");
console.log(`precache.json: ${files.length + 1} entries, version ${version}`);
