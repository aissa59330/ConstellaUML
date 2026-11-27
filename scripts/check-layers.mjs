// Enforces the layer rules of ARCHITECTURE.md: core ← notation ← render ← editor ← ui;
// io and codegen depend on core only; ai (tools offered to Claude) sits beside editor.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const ALLOWED = {
  core: ["core"],
  io: ["core", "io"],
  codegen: ["core", "codegen"],
  notation: ["core", "notation", "render"],
  render: ["core", "notation", "render"],
  editor: ["core", "notation", "render", "editor"],
  ai: ["core", "notation", "render", "ai"],
  ui: ["core", "io", "codegen", "notation", "render", "editor", "ai", "ui"],
};

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) files.push(p);
  }
};
walk("src");

let errors = 0;
for (const file of files) {
  const layer = relative("src", file).split("/")[0];
  const allowed = ALLOWED[layer];
  if (!allowed) continue;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
    const target = relative("src", resolve(dirname(file), m[1])).split("/")[0];
    if (!allowed.includes(target)) {
      console.error(`${file}: la couche "${layer}" ne doit pas importer "${target}" (${m[1]})`);
      errors++;
    }
  }
  if (layer === "core" && /from\s+["'](solid-js|@tauri-apps)/.test(src)) {
    console.error(`${file}: core ne doit dépendre ni de l'UI ni de Tauri`);
    errors++;
  }
}
if (errors) process.exit(1);
console.log(`Couches OK (${files.length} fichiers)`);
