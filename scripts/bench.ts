// Performance benchmark (DG-014): builds a 500-class diagram, then times
// layout + drawing (no-op graphics) and a drag step. Usage: npx tsx scripts/bench.ts
import { Repository } from "../src/core/repository";
import { newProject } from "../src/io/mdj";
import { addDiagram, addFeature, createEdge, createNode, findTool, moveViews, type EdgeTool, type NodeTool } from "../src/notation/uml";
import { arrangeDiagram, drawDiagram } from "../src/render/diagram";
import { approxMeasurer, type Graphics } from "../src/render/graphics";

const N = Number(process.argv[2] ?? 500);
const repo = new Repository();
repo.load(newProject());
const model = repo.root!.ownedElements[0];
const d = addDiagram(repo, model, "UMLClassDiagram");
const time = (label: string, fn: () => void) => {
  const t = performance.now();
  fn();
  const ms = performance.now() - t;
  console.log(`${label.padEnd(28)} ${ms.toFixed(1)} ms`);
  return ms;
};
const views: any[] = [];
time(`create ${N} classes + attrs`, () => {
  for (let i = 0; i < N; i++) {
    const v = createNode(repo, d, findTool("class") as NodeTool, { x: (i % 25) * 180, y: Math.floor(i / 25) * 150, w: 140, h: 80 });
    const m = repo.deref(v.model)!;
    for (let k = 0; k < 3; k++) addFeature(repo, m, "attributes", `-a${k}: String`);
    views.push(v);
  }
});
time(`create ${N} associations`, () => {
  for (let i = 0; i < N; i++) createEdge(repo, d, findTool("association") as EdgeTool, views[i], views[(i + 1) % N]);
});
const ctx = { repo, theme: "light" as const, measure: approxMeasurer };
const noop = new Proxy({}, { get: (_t, p) => (p === "width" ? (s: string) => s.length * 7 : () => {}) }) as unknown as Graphics;
time("first arrange", () => arrangeDiagram(d, ctx));
const frames: number[] = [];
for (let i = 0; i < 10; i++) frames.push(time(`frame ${i} (arrange+draw)`, () => {
  arrangeDiagram(d, ctx);
  drawDiagram(d, { ...ctx, g: noop });
}));
// A drag: one move + one frame per mouse event.
const steps: number[] = [];
for (let i = 0; i < 20; i++)
  steps.push(
    time(`drag step ${i}`, () => {
      moveViews(repo, [views[i % 50]], 5, 5, "drag");
      arrangeDiagram(d, ctx);
      drawDiagram(d, { ...ctx, g: noop });
    }),
  );
steps.sort((a, b) => a - b);
console.log(`drag median ${steps[10].toFixed(1)} ms, worst ${steps[19].toFixed(1)} ms`);
const a: number[] = [], dr: number[] = [];
for (let i = 0; i < 10; i++) {
  moveViews(repo, [views[i]], 3, 0, "drag");
  let t = performance.now();
  arrangeDiagram(d, ctx);
  a.push(performance.now() - t);
  t = performance.now();
  drawDiagram(d, { ...ctx, g: noop });
  dr.push(performance.now() - t);
}
a.sort((x, y) => x - y);
dr.sort((x, y) => x - y);
console.log(`arrange median ${a[5].toFixed(1)} ms · draw median ${dr[5].toFixed(1)} ms`);
// Opening: serialize the project, then parse + load + first layout.
import { parseMdj, serializeMdj } from "../src/io/mdj";
const text = serializeMdj(repo.root!);
const fresh = new Repository();
const elements = [...repo.all()].length;
const openMs = time(`open (${elements} elements, ${(text.length / 1e6).toFixed(1)} MB)`, () => {
  fresh.load(parseMdj(text));
  const dd = fresh.get(d._id)!;
  arrangeDiagram(dd, { repo: fresh, theme: "light", measure: approxMeasurer });
});
void openMs;
