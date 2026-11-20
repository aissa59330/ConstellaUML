// Renders every demo diagram to docs/screenshots/diagrams/<type>.svg|png
// (PNG through rsvg-convert when available). Usage: npx tsx scripts/render-demos.ts [dark]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { Repository } from "../src/core/repository";
import { newProject, serializeMdj } from "../src/io/mdj";
import { approxMeasurer } from "../src/render/graphics";
import { exportSvg } from "../src/render/diagram";
import { buildAllDemos } from "../src/dev/demos";

const theme = process.argv.includes("dark") ? "dark" : "light";
const repo = new Repository();
repo.load(newProject());
const model = repo.root!.ownedElements[0];
const diagrams = buildAllDemos(repo, model);
const out = theme === "dark" ? "docs/screenshots/diagrams/sombre" : "docs/screenshots/diagrams";
mkdirSync(out, { recursive: true });
for (const [type, d] of Object.entries(diagrams)) {
  const svg = exportSvg(d, { repo, measure: approxMeasurer }, { theme, margin: 16, background: true }, approxMeasurer);
  const base = `${out}/${type.replace(/^UML/, "")}`;
  writeFileSync(`${base}.svg`, svg);
  try {
    execFileSync("rsvg-convert", ["-z", "1.6", "-o", `${base}.png`, `${base}.svg`]);
  } catch {
    /* PNG optional */
  }
  console.log(`${type} → ${base}.svg`);
}
writeFileSync("examples/tous-les-diagrammes.mdj", serializeMdj(repo.root!));
console.log("examples/tous-les-diagrammes.mdj");
